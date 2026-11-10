import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Control } from "@arynbht/factory-catalog";
import { afterEach, describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { packContext } from "./context.js";
import { isSensitivePath, looksBinary, looksLikeSecret } from "./redact.js";

const made: string[] = [];
afterEach(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
  made.length = 0;
});

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "factory-ctx-"));
  made.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}

describe("redact guards", () => {
  it("flags sensitive paths by name", () => {
    for (const p of [
      ".env",
      ".env.local",
      "config/.env.production",
      "deploy/key.pem",
      "id_rsa",
      ".npmrc",
      "secrets.json",
    ]) {
      expect(isSensitivePath(p)).toBe(true);
    }
    expect(isSensitivePath("src/index.ts")).toBe(false);
    expect(isSensitivePath("docs/environment.md")).toBe(false);
  });

  it("flags the broadened path denylist (certs, stores, secret dirs)", () => {
    for (const p of [
      "ca.crt",
      "server.cer",
      "key.der",
      "sa.p8",
      "chain.p7b",
      "vault.kdbx",
      "client.ovpn",
      "deploy/kubeconfig",
      ".aws/credentials",
      "home/.ssh/id_ed25519",
      ".gnupg/secring.gpg",
      ".docker/config.json",
      "id_rsa.bak",
    ]) {
      expect(isSensitivePath(p)).toBe(true);
    }
  });

  it("flags secret-looking content", () => {
    expect(looksLikeSecret("AWS=AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(looksLikeSecret('api_key = "abcdef1234567890"')).toBe(true); // gitleaks:allow
    expect(looksLikeSecret("-----BEGIN RSA PRIVATE KEY-----\nMII...\n")).toBe(
      true,
    );
    expect(looksLikeSecret("const total = sum(items);")).toBe(false);
  });

  it("flags the broadened content shapes", () => {
    // Stripe keys (the old sk-[..] rule needed a hyphen after sk).
    expect(looksLikeSecret("sk_live_51Habcdefg0123456789")).toBe(true); // gitleaks:allow
    expect(looksLikeSecret("rk_test_abcdefghij0123456789")).toBe(true); // gitleaks:allow
    // JWT bearer token.
    expect(
      looksLikeSecret(
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123signature",
      ),
    ).toBe(true);
    // DB URL with an inline password.
    expect(
      looksLikeSecret("postgres://admin:hunter2pass@db.internal:5432/app"),
    ).toBe(true); // gitleaks:allow
    // Unquoted assignment (the old rule required quotes).
    expect(looksLikeSecret("DB_PASSWORD=sup3rs3cretvalue")).toBe(true); // gitleaks:allow
    // GCP service-account JSON marker.
    expect(
      looksLikeSecret('{"type": "service_account", "project_id": "x"}'),
    ).toBe(true);
    // A benign assignment doesn't trip it.
    expect(looksLikeSecret("const name = getUser();")).toBe(false);
    // Nor does code that passes a token around.
    expect(looksLikeSecret("const token = resolveToken(flags.token);")).toBe(
      false,
    );
    // A dotted unquoted value is still a secret.
    expect(looksLikeSecret("password: correct.horse.battery")).toBe(true); // gitleaks:allow
  });

  it("detects binary content by a NUL byte", () => {
    expect(looksBinary("plain text file\nwith lines\n")).toBe(false);
    expect(looksBinary("PNG\x00\x00IHDR binary blob")).toBe(true);
  });
});

describe("packContext", () => {
  it("never includes a .env or secret-content file, even when glob-matched", async () => {
    const dir = await repo({
      ".env": "SECRET_TOKEN=supersecretvalue12345",
      "config.json": 'api_key = "live_abcdef1234567890"', // gitleaks:allow
      "src/app.ts": "export const x = 1;\n",
    });
    const ctx = buildContext(dir);

    const packed = await packContext(ctx, {
      task: "threat-model",
      globs: ["**/*"], // deliberately greedy
    });

    expect(packed.includedFiles).toContain("src/app.ts");
    expect(packed.includedFiles).not.toContain(".env");
    expect(packed.includedFiles).not.toContain("config.json");
    expect(packed.skippedSensitive).toEqual(
      expect.arrayContaining([".env", "config.json"]),
    );
    // And the secret value must not appear anywhere in the packed text.
    expect(packed.text).not.toContain("supersecretvalue12345");
    expect(packed.text).not.toContain("live_abcdef1234567890");
    expect(packed.text).toContain("export const x = 1;");
  });

  it("enforces the byte cap and reports truncation", async () => {
    const big = "x".repeat(5000);
    const dir = await repo({
      "a.txt": big,
      "b.txt": big,
      "c.txt": "small",
    });
    const ctx = buildContext(dir);

    const packed = await packContext(ctx, {
      task: "explain-gaps",
      globs: ["*.txt"],
      maxBytes: 6000, // room for one big file, not two
    });

    expect(packed.truncated).toBe(true);
    // The small file still fits after a big one is skipped.
    expect(packed.includedFiles).toContain("c.txt");
    expect(packed.includedFiles.length).toBeLessThan(3);
  });

  it("includes profile, control rationale, and gaps", async () => {
    const dir = await repo({
      ".factory/profile.yml": "version: 1\nname: Demo\ntype: api\n",
    });
    const ctx = buildContext(dir);
    const control = {
      id: "sec.threat-model",
      title: "Threat model documented",
      rationale: "A threat model surfaces attack surface early.",
      references: [{ name: "STRIDE", url: "https://example.com" }],
    } as Control;

    const packed = await packContext(ctx, {
      task: "threat-model",
      control,
      results: [
        {
          controlId: "sec.threat-model",
          title: "Threat model documented",
          status: "needs-evidence",
        } as ControlResultLike,
      ] as never,
    });

    expect(packed.text).toContain("name: Demo");
    expect(packed.text).toContain("sec.threat-model");
    expect(packed.text).toContain("attack surface");
    expect(packed.text).toContain("Current gaps");
  });
});

interface ControlResultLike {
  controlId: string;
  title: string;
  status: string;
}
