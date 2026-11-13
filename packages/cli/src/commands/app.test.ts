import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APP_PERMISSIONS } from "@arynbht/factory-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAppRegister } from "./app.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

let config: string;
const saved = process.env.FACTORY_CONFIG_DIR;
let out: string[];
beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), "factory-app-cli-"));
  process.env.FACTORY_CONFIG_DIR = config;
  out = [];
  vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    out.push(String(s));
    return true;
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.FACTORY_CONFIG_DIR;
  else process.env.FACTORY_CONFIG_DIR = saved;
  await rm(config, { recursive: true, force: true });
});

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

describe("factory app register", () => {
  it("posts the manifest to GitHub, takes the code back, and keeps the credentials", async () => {
    const conversions: string[] = [];
    const github = (async (url: string) => {
      conversions.push(url);
      return Response.json({
        id: 77,
        slug: "software-factory-acme",
        client_id: "Iv1.abc",
        client_secret: "shh",
        webhook_secret: null,
        pem: privateKey,
        html_url: "https://github.com/apps/software-factory-acme",
        owner: { login: "acme" },
      });
    }) as typeof fetch;

    let start = "";
    const done = runAppRegister(
      ".",
      { org: "acme" },
      { fetch: github, open: (url) => (start = url) },
    );
    await vi.waitFor(() => expect(start).not.toBe(""));

    // A page that rebinds its own DNS name to this machine gets nothing.
    const rebound = await new Promise<number>((done) =>
      get(start, { headers: { host: "evil.example" } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      }),
    );
    expect(rebound).toBe(421);

    // The page posts the manifest to the org's registration URL.
    const html = await (await fetch(start)).text();
    const action = decode(/action="([^"]+)"/.exec(html)?.[1] ?? "");
    expect(action).toMatch(
      /^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=[0-9a-f]{32}$/,
    );
    const manifest = JSON.parse(
      decode(/name="manifest" value="([^"]+)"/.exec(html)?.[1] ?? "{}"),
    );
    expect(manifest).toMatchObject({
      name: "software-factory-acme",
      redirect_url: `${start}callback`,
      default_permissions: APP_PERMISSIONS,
    });

    // A callback without the right state is refused; GitHub's is accepted.
    expect((await fetch(`${start}callback?code=x&state=wrong`)).status).toBe(
      400,
    );
    const state = new URL(action).searchParams.get("state");
    const back = await fetch(`${start}callback?code=one-time&state=${state}`);
    expect(back.status).toBe(200);
    expect(await done).toBe(0);

    expect(conversions).toEqual([
      "https://api.github.com/app-manifests/one-time/conversions",
    ]);
    expect(
      JSON.parse(await readFile(join(config, "app.json"), "utf8")),
    ).toEqual({
      id: 77,
      slug: "software-factory-acme",
      clientId: "Iv1.abc",
      owner: "acme",
      htmlUrl: "https://github.com/apps/software-factory-acme",
    });
    expect(out.join("")).toContain(
      "https://github.com/apps/software-factory-acme/installations/new",
    );
    expect(out.join("")).toContain("FACTORY_APP_ID = 77");

    // One App per machine: a second register is refused.
    expect(await runAppRegister(".", {}, { open: () => undefined })).toBe(1);
  });
});
