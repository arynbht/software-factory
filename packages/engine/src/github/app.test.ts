import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APP_PERMISSIONS,
  appJwt,
  appManifest,
  installationToken,
  loadApp,
  registrationUrl,
  saveApp,
} from "./app.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

let dir: string;
const saved = process.env.FACTORY_CONFIG_DIR;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "factory-app-"));
  process.env.FACTORY_CONFIG_DIR = dir;
});
afterEach(async () => {
  if (saved === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = saved;
  await rm(dir, { recursive: true, force: true });
});

describe("the factory's GitHub App", () => {
  it("asks for ADR-0007's permissions and no webhook", () => {
    const manifest = appManifest({
      name: "factory",
      url: "https://github.com/arynbht/software-factory",
      redirectUrl: "http://localhost:4567/callback",
    });
    expect(manifest.default_permissions).toEqual(APP_PERMISSIONS);
    expect(manifest).toMatchObject({
      public: false,
      hook_attributes: { active: false },
      default_events: [],
    });
    expect(registrationUrl("s t")).toBe(
      "https://github.com/settings/apps/new?state=s%20t",
    );
    expect(registrationUrl("s", "pilotship")).toBe(
      "https://github.com/organizations/pilotship/settings/apps/new?state=s",
    );
  });

  it("signs a JWT GitHub can verify, backdated a minute and good for nine", () => {
    const now = new Date("2026-11-13T00:00:00Z");
    const jwt = appJwt(1234, privateKey, now);
    const [header, payload, signature] = jwt.split(".") as [
      string,
      string,
      string,
    ];
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const t = now.getTime() / 1000;
    expect(claims).toEqual({ iat: t - 60, exp: t - 60 + 540, iss: "1234" });
  });

  it("mints an installation token, or says the App isn't installed", async () => {
    const calls: string[] = [];
    const fake = (installed: boolean) =>
      (async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method} ${url}`);
        const auth = (init?.headers as Record<string, string>).authorization;
        expect(auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
        if (url.endsWith("/installation"))
          return installed
            ? Response.json({ id: 42 })
            : new Response("Not Found", { status: 404 });
        return Response.json({
          token: "ghs_x",
          expires_at: "2026-11-13T01:00:00Z",
        });
      }) as typeof fetch;
    const app = { id: 1, privateKey };
    const repo = { owner: "arynbht", repo: "demo" };
    expect(await installationToken(app, repo, { fetch: fake(true) })).toEqual({
      token: "ghs_x",
      expiresAt: "2026-11-13T01:00:00Z",
    });
    expect(calls).toEqual([
      "GET https://api.github.com/repos/arynbht/demo/installation",
      "POST https://api.github.com/app/installations/42/access_tokens",
    ]);
    expect(
      await installationToken(app, repo, { fetch: fake(false) }),
    ).toBeNull();
  });

  it("keeps the private key and secrets readable by this user only", async () => {
    expect(await loadApp()).toBeNull();
    const record = await saveApp({
      id: 7,
      slug: "factory-arynbht",
      client_id: "Iv1.abc",
      client_secret: "shh",
      webhook_secret: null,
      pem: privateKey,
      html_url: "https://github.com/apps/factory-arynbht",
      owner: { login: "arynbht" },
    });
    expect(record).toEqual({
      id: 7,
      slug: "factory-arynbht",
      clientId: "Iv1.abc",
      owner: "arynbht",
      htmlUrl: "https://github.com/apps/factory-arynbht",
    });
    expect(await loadApp()).toEqual({ ...record, privateKey });
    // No secret in the record anyone might share.
    expect(await readFile(join(dir, "app.json"), "utf8")).not.toMatch(
      /shh|PRIVATE KEY/,
    );
    if (process.platform !== "win32")
      expect((await stat(join(dir, "app.pem"))).mode & 0o777).toBe(0o600);
  });
});
