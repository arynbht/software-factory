// GitHub device flow (OAuth App or GitHub App). Pure protocol: `fetch`, `sleep`,
// and `now` are injectable so the polling state machine is unit-tested without
// the network or real timers. Per ADR-0007 the client id is a registered App's
// id, supplied by configuration.

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

export class DeviceFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceFlowDeps {
  fetch: typeof globalThis.fetch;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
}

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

/** Step 1: ask GitHub for a device + user code. */
export async function requestDeviceCode(
  clientId: string,
  scope: string,
  deps: DeviceFlowDeps,
): Promise<DeviceCode> {
  const res = await deps.fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || typeof data.device_code !== "string") {
    throw new DeviceFlowError(
      typeof data.error_description === "string"
        ? data.error_description
        : `device code request failed (${res.status})`,
    );
  }
  return {
    deviceCode: data.device_code,
    userCode: String(data.user_code ?? ""),
    verificationUri: String(
      data.verification_uri ?? "https://github.com/login/device",
    ),
    expiresIn: Number(data.expires_in ?? 900),
    interval: Number(data.interval ?? 5),
  };
}

/** Step 2: poll until the user authorizes (or the code expires / is denied). */
export async function pollForToken(
  clientId: string,
  code: DeviceCode,
  deps: DeviceFlowDeps,
  signal?: AbortSignal,
): Promise<string> {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const deadline = now() + code.expiresIn * 1000;
  let intervalMs = code.interval * 1000;

  for (;;) {
    if (signal?.aborted) throw new DeviceFlowError("sign-in cancelled");
    if (now() >= deadline) {
      throw new DeviceFlowError("the code expired before sign-in completed");
    }
    await sleep(intervalMs);

    const res = await deps.fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        client_id: clientId,
        device_code: code.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data.access_token === "string") return data.access_token;

    switch (data.error) {
      case "authorization_pending":
        break; // not yet — keep polling at the same interval
      case "slow_down":
        intervalMs += 5000; // GitHub asks us to back off
        break;
      default:
        throw new DeviceFlowError(
          typeof data.error_description === "string"
            ? data.error_description
            : `sign-in failed: ${String(data.error ?? "unknown error")}`,
        );
    }
  }
}

/** Resolve the login of the signed-in user (also validates the token). */
export async function fetchUserLogin(
  token: string,
  fetchFn: typeof globalThis.fetch,
): Promise<string> {
  const res = await fetchFn(USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "factory-desktop",
    },
  });
  const data = (await res.json()) as { login?: unknown };
  if (!res.ok || typeof data.login !== "string") {
    throw new DeviceFlowError("could not fetch the signed-in user");
  }
  return data.login;
}
