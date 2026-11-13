// The factory's GitHub App (ADR-0007, spec v2.1 §14): registered once from a
// manifest, then the factory's identity in every repo it's installed on: the
// judge's reviews, evidence uploads, the status issue, task pushes.
// Uninstalling it revokes all of that at once.
//
// Its credentials live outside every repo, in the factory's config directory
// (beside the ledger key), and never in a repo or the agent's environment:
//
//   <config>/app.json          id, slug, client id, owner, URLs (no secrets)
//   <config>/app.pem           the private key (mode 0600)
//   <config>/app-secrets.json  client and webhook secrets (mode 0600)
import { createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** What the App may do (ADR-0007), and nothing else. */
export const APP_PERMISSIONS = {
  metadata: "read",
  // Files, generator and task branches, the evidence branch.
  contents: "write",
  // fix --pr, the judge's reviews, sticky comments.
  pull_requests: "write",
  // A push that touches .github/workflows/* is refused without it.
  workflows: "write",
  // The status issue.
  issues: "write",
  // Branch protection, rulesets, security settings the detectors read.
  administration: "read",
  vulnerability_alerts: "read",
  secret_scanning_alerts: "read",
  // CI duration and DORA metrics.
  actions: "read",
} as const;

export interface ManifestOptions {
  name: string;
  /** Where GitHub sends the person back with the one-time code. */
  redirectUrl: string;
  /** The App's homepage. */
  url: string;
}

/** The manifest GitHub registers the App from (no webhooks: nothing listens). */
export function appManifest(options: ManifestOptions): Record<string, unknown> {
  return {
    name: options.name,
    url: options.url,
    redirect_url: options.redirectUrl,
    description:
      "Software Factory: audits the repo, judges changes, and posts its reviews and evidence.",
    public: false,
    hook_attributes: { url: options.url, active: false },
    default_permissions: APP_PERMISSIONS,
    default_events: [],
  };
}

/** Where a person registers the App from its manifest: their account, or an org. */
export function registrationUrl(state: string, org?: string): string {
  const base = org
    ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new`
    : "https://github.com/settings/apps/new";
  return `${base}?state=${encodeURIComponent(state)}`;
}

/** The fields of GitHub's manifest conversion the factory keeps. */
export interface AppConversion {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string | null;
  pem: string;
  html_url: string;
  owner?: { login?: string } | null;
}

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

type Fetch = typeof fetch;

async function github<T>(
  fetchImpl: Fetch,
  method: string,
  path: string,
  auth?: string,
): Promise<T> {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "software-factory",
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(
      `GitHub ${method} ${path} failed: ${res.status} ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/** Trade the one-time code GitHub hands back for the new App's credentials. */
export function convertManifestCode(
  code: string,
  fetchImpl: Fetch = fetch,
): Promise<AppConversion> {
  return github<AppConversion>(
    fetchImpl,
    "POST",
    `/app-manifests/${encodeURIComponent(code)}/conversions`,
  );
}

/** The factory's config directory (`FACTORY_CONFIG_DIR`, else `~/.config/factory`). */
export function factoryConfigDir(): string {
  return (
    process.env.FACTORY_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "factory")
  );
}

/** The registered App, as `app.json` records it. */
export interface AppRecord {
  id: number;
  slug: string;
  clientId: string;
  owner: string;
  htmlUrl: string;
}

/** Save a new App's credentials; secrets are readable by this user only. */
export async function saveApp(conversion: AppConversion): Promise<AppRecord> {
  const dir = factoryConfigDir();
  await mkdir(dir, { recursive: true });
  const record: AppRecord = {
    id: conversion.id,
    slug: conversion.slug,
    clientId: conversion.client_id,
    owner: conversion.owner?.login ?? "",
    htmlUrl: conversion.html_url,
  };
  const secret = { mode: 0o600 } as const;
  await writeFile(join(dir, "app.pem"), conversion.pem, secret);
  await writeFile(
    join(dir, "app-secrets.json"),
    `${JSON.stringify({ client_secret: conversion.client_secret, webhook_secret: conversion.webhook_secret }, null, 2)}\n`,
    secret,
  );
  await writeFile(
    join(dir, "app.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

/** The registered App and its private key, or null when none is registered. */
export async function loadApp(): Promise<
  (AppRecord & { privateKey: string }) | null
> {
  const dir = factoryConfigDir();
  try {
    const record = JSON.parse(
      await readFile(join(dir, "app.json"), "utf8"),
    ) as AppRecord;
    const privateKey = await readFile(join(dir, "app.pem"), "utf8");
    return { ...record, privateKey };
  } catch {
    return null;
  }
}

const base64url = (data: string | Buffer) =>
  Buffer.from(data).toString("base64url");

/**
 * The short-lived JWT that authenticates as the App itself (RS256, at most
 * ten minutes; backdated a minute for clock drift, as GitHub advises).
 */
export function appJwt(
  appId: number,
  privateKey: string,
  now: Date = new Date(),
): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat, exp: iat + 9 * 60, iss: String(appId) }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
}

/**
 * An installation token for one repo: the App acting there, for an hour.
 * Null when the App isn't installed on the repo.
 */
export async function installationToken(
  app: { id: number; privateKey: string },
  repo: { owner: string; repo: string },
  options: { fetch?: Fetch; now?: Date } = {},
): Promise<{ token: string; expiresAt: string } | null> {
  const fetchImpl = options.fetch ?? fetch;
  const jwt = appJwt(app.id, app.privateKey, options.now);
  let installation: { id: number };
  try {
    installation = await github<{ id: number }>(
      fetchImpl,
      "GET",
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/installation`,
      jwt,
    );
  } catch (err) {
    if (err instanceof AppError && / 404 /.test(err.message)) return null;
    throw err;
  }
  const { token, expires_at } = await github<{
    token: string;
    expires_at: string;
  }>(
    fetchImpl,
    "POST",
    `/app/installations/${installation.id}/access_tokens`,
    jwt,
  );
  return { token, expiresAt: expires_at };
}
