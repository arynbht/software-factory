import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";

import {
  type AppRecord,
  appManifest,
  convertManifestCode,
  factoryConfigDir,
  installationToken,
  loadApp,
  registrationUrl,
  resolveRepoSlug,
  saveApp,
} from "@arynbht/factory-engine";

// `factory app`: the factory's GitHub App (ADR-0007, spec v2.1 §14).
// `register` creates it from a manifest in one click: a page served here posts
// the manifest to GitHub, GitHub sends the person back here with a one-time
// code, and the code is traded for the App's credentials, which stay in the
// factory's config directory.

export interface AppRegisterFlags {
  org?: string;
  name?: string;
  port?: string;
  /** Open the browser (default); `--no-open` only prints the link. */
  open?: boolean;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
  `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem}</style>` +
  `</head><body>${body}</body></html>`;

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args as string[], {
    stdio: "ignore",
    detached: true,
    windowsVerbatimArguments: process.platform === "win32",
  });
  child.on("error", () => undefined);
  child.unref();
}

/** Where the App's settings live, for its owner. */
const settingsUrl = (slug: string, org?: string) =>
  org
    ? `https://github.com/organizations/${org}/settings/apps/${slug}`
    : `https://github.com/settings/apps/${slug}`;

function nextSteps(record: AppRecord, org?: string): string {
  return [
    `Registered ${record.slug} (App ID ${record.id}), owned by ${record.owner || org || "you"}.`,
    `Its private key is in ${join(factoryConfigDir(), "app.pem")}; keep it there.`,
    "",
    "Next:",
    `  1. Install it on the repos the factory works on: ${record.htmlUrl}/installations/new`,
    `  2. Turn on device flow (General → "Enable Device Flow"), so the desktop app can sign in: ${settingsUrl(record.slug, org)}`,
    "  3. For CI, add two repo secrets for actions/create-github-app-token:",
    `       FACTORY_APP_ID = ${record.id}`,
    `       FACTORY_APP_PRIVATE_KEY = the contents of app.pem`,
    "Then `factory app status` in a repo shows whether the factory acts there as the App.",
  ].join("\n");
}

/**
 * `factory app register`: create the factory's GitHub App from its manifest,
 * under your account or `--org`, and keep its credentials here.
 */
export async function runAppRegister(
  path: string,
  flags: AppRegisterFlags,
  deps: { fetch?: typeof fetch; open?: (url: string) => void } = {},
): Promise<number> {
  const existing = await loadApp();
  if (existing) {
    console.error(
      `factory app: ${existing.slug} is already registered (${existing.htmlUrl}). To register another, move ${join(factoryConfigDir(), "app.json")} aside first.`,
    );
    return 1;
  }
  const slug = await resolveRepoSlug(resolve(path));
  // App names are unique across GitHub, and at most 34 characters.
  const name = (
    flags.name ??
    `software-factory-${flags.org ?? slug?.owner ?? randomBytes(3).toString("hex")}`
  ).slice(0, 34);
  const state = randomBytes(16).toString("hex");

  let server: Server | undefined;
  const registered = new Promise<AppRecord>((done, fail) => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const port = (server?.address() as { port: number }).port;
      const base = `http://127.0.0.1:${port}`;
      // Only this machine's own address: a page elsewhere that rebinds a
      // DNS name to 127.0.0.1 mustn't read the state or the manifest.
      if (
        req.headers.host !== `127.0.0.1:${port}` &&
        req.headers.host !== `localhost:${port}`
      ) {
        res.writeHead(421).end();
        return;
      }
      if (url.pathname === "/") {
        const manifest = appManifest({
          name,
          url: slug
            ? `https://github.com/${slug.owner}/${slug.repo}`
            : "https://github.com",
          redirectUrl: `${base}/callback`,
        });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          page(
            "Register the factory's GitHub App",
            `<h1>Register the factory's GitHub App</h1>` +
              `<p>This creates <b>${escapeHtml(name)}</b> under ${escapeHtml(flags.org ? `the ${flags.org} organization` : "your GitHub account")}, with the permissions in ADR-0007. GitHub shows them before you confirm.</p>` +
              `<form method="post" action="${escapeHtml(registrationUrl(state, flags.org))}">` +
              `<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">` +
              `<button type="submit">Create the App on GitHub</button></form>`,
          ),
        );
        return;
      }
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        if (!code || url.searchParams.get("state") !== state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(
            page(
              "Not registered",
              "<p>That link didn't come from this registration. Start again with <code>factory app register</code>.</p>",
            ),
          );
          return;
        }
        convertManifestCode(code, deps.fetch)
          .then((conversion) =>
            saveApp(conversion).catch((err: Error) => {
              // The code is spent: say which App exists, so its owner can
              // generate a new private key for it rather than start over.
              throw new Error(
                `${conversion.slug} (App ID ${conversion.id}) was created, but its credentials couldn't be saved: ${err.message}. Generate a new private key at ${settingsUrl(conversion.slug, flags.org)} and put it in ${join(factoryConfigDir(), "app.pem")}`,
              );
            }),
          )
          .then((record) => {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(
              page(
                "App registered",
                `<h1>${escapeHtml(record.slug)} is registered</h1><p>Next, <a href="${escapeHtml(record.htmlUrl)}/installations/new">install it on your repos</a>. The terminal has the rest.</p>`,
              ),
            );
            done(record);
          })
          .catch((err: Error) => {
            res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
            res.end(
              page("Not registered", `<p>${escapeHtml(err.message)}</p>`),
            );
            fail(err);
          });
        return;
      }
      res.writeHead(404).end();
    });
    server.on("error", fail);
    server.listen(Number(flags.port ?? 0), "127.0.0.1", () => {
      const address = server?.address() as { port: number };
      const start = `http://127.0.0.1:${address.port}/`;
      process.stdout.write(
        `Registering ${name} on GitHub${flags.org ? ` under ${flags.org}` : ""}. Open ${start} and confirm on GitHub${flags.open === false ? "" : " (opening it now)"}.\n`,
      );
      if (flags.open !== false) (deps.open ?? openBrowser)(start);
    });
  });
  // Reject from the timer itself: "close" waits for the browser's keep-alive
  // connections, so it can fire long after the deadline.
  let timeout: NodeJS.Timeout | undefined;
  try {
    const record = await Promise.race([
      registered,
      new Promise<never>((_, fail) => {
        timeout = setTimeout(
          () => fail(new Error("no answer from GitHub within 15 minutes")),
          15 * 60 * 1000,
        );
      }),
    ]);
    process.stdout.write(`${nextSteps(record, flags.org)}\n`);
    return 0;
  } catch (err) {
    console.error(`factory app: ${(err as Error).message}`);
    return 1;
  } finally {
    clearTimeout(timeout);
    server?.close();
    server?.closeAllConnections();
  }
}

/** `factory app status`: the registered App, and whether the factory acts as it here. */
export async function runAppStatus(
  path: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<number> {
  const app = await loadApp();
  if (!app) {
    process.stdout.write(
      "No factory App registered on this machine: `factory app register`.\n",
    );
    return 1;
  }
  process.stdout.write(`${app.slug} (App ID ${app.id}): ${app.htmlUrl}\n`);
  const slug = await resolveRepoSlug(resolve(path));
  if (!slug) {
    process.stdout.write("Not in a repo with a GitHub origin.\n");
    return 0;
  }
  const minted = await installationToken(app, slug, deps).catch(
    (err: Error) => err,
  );
  if (minted instanceof Error) {
    console.error(`factory app: ${minted.message}`);
    return 1;
  }
  process.stdout.write(
    minted
      ? `Installed on ${slug.owner}/${slug.repo}: the factory acts there as ${app.slug}.\n`
      : `Not installed on ${slug.owner}/${slug.repo}: ${app.htmlUrl}/installations/new\n`,
  );
  return minted ? 0 : 1;
}

/** `factory app token`: an installation token for this repo, for scripts and CI. */
export async function runAppToken(
  path: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<number> {
  const app = await loadApp();
  const slug = await resolveRepoSlug(resolve(path));
  if (!app || !slug) {
    console.error(
      app
        ? "factory app: not in a repo with a GitHub origin"
        : "factory app: no App registered: `factory app register`",
    );
    return 1;
  }
  const minted = await installationToken(app, slug, deps).catch(
    (err: Error) => err,
  );
  if (minted instanceof Error) {
    console.error(`factory app: ${minted.message}`);
    return 1;
  }
  if (!minted) {
    console.error(
      `factory app: ${app.slug} isn't installed on ${slug.owner}/${slug.repo}: ${app.htmlUrl}/installations/new`,
    );
    return 1;
  }
  process.stdout.write(`${minted.token}\n`);
  return 0;
}
