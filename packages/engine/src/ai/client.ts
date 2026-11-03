// A thin, testable wrapper over the Anthropic Messages API. The real SDK is loaded
// lazily (only when a call is actually made) so non-AI commands stay light and tests
// can inject a transport without the SDK on the path. Retry and timeout live at this
// layer (not delegated to the SDK) so they're deterministically testable.

/** The API key is missing or empty. */
export class AiKeyError extends Error {
  constructor(message = "no Anthropic API key; set ANTHROPIC_API_KEY") {
    super(message);
    this.name = "AiKeyError";
  }
}

/** A call failed. `retryable` marks transient failures (429 / 5xx / timeout). */
export class AiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "AiError";
    this.retryable = retryable;
  }
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteParams {
  system?: string | undefined;
  prompt: string;
  model?: string | undefined;
  maxTokens?: number | undefined;
}

export interface CompleteResult {
  text: string;
  usage: AiUsage;
  model: string;
}

export interface TransportRequest {
  model: string;
  system: string | undefined;
  prompt: string;
  maxTokens: number;
}

/** The seam the client calls; tests provide a fake, production uses the SDK. */
export interface AiTransport {
  /**
   * `signal` aborts the in-flight request when the client's timeout fires, so a
   * timed-out call stops consuming tokens server-side instead of running to
   * completion while a retry is billed alongside it.
   */
  create(req: TransportRequest, signal?: AbortSignal): Promise<CompleteResult>;
}

export interface AiClient {
  complete(params: CompleteParams): Promise<CompleteResult>;
}

/** Default model; override via config or per call. */
export const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;

/** Resolve the key from an explicit value, then `ANTHROPIC_API_KEY`. */
export function resolveAnthropicKey(explicit?: string): string | undefined {
  return explicit?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

export interface AiClientOptions {
  apiKey?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  /** Base backoff between retries (ms); grows linearly with the attempt. */
  backoffMs?: number | undefined;
  /** Force the metered API-key transport even when the Claude CLI is available. */
  preferApiKey?: boolean | undefined;
  /** Inject a transport (tests). Omit to pick CLI-then-API automatically. */
  transport?: AiTransport | undefined;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Build an AI client. With no `transport`, calls go through the Anthropic SDK. */
export function createAiClient(options: AiClientOptions = {}): AiClient {
  const defaultModel = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const transport = options.transport ?? defaultTransport(options);

  return {
    async complete(params) {
      const req: TransportRequest = {
        model: params.model ?? defaultModel,
        system: params.system,
        prompt: params.prompt,
        maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      };

      let lastError: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await withTimeout(
            (signal) => transport.create(req, signal),
            timeoutMs,
          );
        } catch (err) {
          lastError = err;
          const retryable = err instanceof AiError && err.retryable;
          if (!retryable || attempt === maxRetries) throw err;
          await sleep(backoffMs * (attempt + 1));
        }
      }
      throw lastError;
    },
  };
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  // Abort the in-flight request when the timeout wins the race, so it stops
  // server-side rather than running (and billing) to completion while a retry
  // fires. `run`'s promise is still referenced by `Promise.race`, so its
  // post-abort rejection stays handled (no unhandledRejection).
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AiError(`request timed out after ${ms}ms`, true)),
      ms,
    );
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}

/**
 * The default transport chooses at first use: prefer the Claude Code CLI (the
 * user's subscription) when it's installed, otherwise fall back to the metered
 * API key. `preferApiKey` forces the API. Chosen lazily (dynamic import avoids a
 * module cycle and keeps both backends out of non-AI paths).
 */
function defaultTransport(options: AiClientOptions): AiTransport {
  let chosen: AiTransport | null = null;
  return {
    async create(req, signal) {
      chosen ??= await chooseTransport(options);
      return chosen.create(req, signal);
    },
  };
}

async function chooseTransport(options: AiClientOptions): Promise<AiTransport> {
  // Forced to the API: use the SDK (which raises AiKeyError if no key is set).
  if (options.preferApiKey) return sdkTransport(options);

  const { claudeCliTransport, claudeCliAvailable } =
    await import("./claude-cli.js");
  if (await claudeCliAvailable()) {
    return claudeCliTransport({ model: options.model });
  }
  if (resolveAnthropicKey(options.apiKey)) return sdkTransport(options);
  throw new AiError(
    "No Claude available: sign in to Claude Code (`claude login`) or set ANTHROPIC_API_KEY.",
    false,
  );
}

/** The real transport: lazy-loads the SDK so it isn't pulled into non-AI paths. */
function sdkTransport(options: AiClientOptions): AiTransport {
  return {
    async create(req, signal) {
      const apiKey = resolveAnthropicKey(options.apiKey);
      if (!apiKey) throw new AiKeyError();

      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      // We own retry/timeout, so disable the SDK's to avoid compounding them.
      const client = new Anthropic({ apiKey, maxRetries: 0 });

      try {
        const res = await client.messages.create(
          {
            model: req.model,
            max_tokens: req.maxTokens,
            ...(req.system ? { system: req.system } : {}),
            messages: [{ role: "user", content: req.prompt }],
          },
          // Pass the timeout's abort signal so a timed-out call is cancelled
          // server-side instead of running to completion unlogged.
          signal ? { signal } : {},
        );
        const text = res.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
        return {
          text,
          usage: {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
          },
          model: res.model,
        };
      } catch (err) {
        const status = (err as { status?: number }).status;
        const retryable =
          status === 429 || (typeof status === "number" && status >= 500);
        throw new AiError((err as Error).message, retryable);
      }
    },
  };
}
