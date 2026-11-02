import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoSymlinkEscape,
  containedReadPath,
  isInsideRepo,
  PathGuardError,
  resolveInsideRepo,
} from "./paths.js";

describe("resolveInsideRepo", () => {
  const root = resolve("/repo");

  it("resolves a plain repo-relative path", () => {
    expect(resolveInsideRepo(root, "docs/x.md")).toBe(join(root, "docs/x.md"));
  });

  it("rejects a parent-escaping path", () => {
    expect(() => resolveInsideRepo(root, "../outside")).toThrow(PathGuardError);
    expect(() => resolveInsideRepo(root, "docs/../../outside")).toThrow(
      PathGuardError,
    );
  });

  it("rejects an absolute path", () => {
    // An absolute change.path would make resolve() discard the repo root.
    const abs = process.platform === "win32" ? "C:\\windows\\x" : "/etc/x";
    expect(() => resolveInsideRepo(root, abs)).toThrow(PathGuardError);
  });

  it("keeps a sibling-looking name that is actually contained", () => {
    expect(resolveInsideRepo(root, "..foo/bar")).toBe(join(root, "..foo/bar"));
  });
});

describe("isInsideRepo", () => {
  const root = resolve("/repo");
  it("treats the root itself as inside", () => {
    expect(isInsideRepo(root, root)).toBe(true);
  });
  it("rejects a parent", () => {
    expect(isInsideRepo(root, resolve("/"))).toBe(false);
  });
});

// Symlink creation needs privileges on Windows; skip gracefully where it fails.
async function canSymlink(dir: string): Promise<boolean> {
  try {
    await symlink(join(dir, "nope"), join(dir, ".__symtest"));
    await rm(join(dir, ".__symtest"), { force: true });
    return true;
  } catch {
    return false;
  }
}

describe("symlink guards", () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true });
    made.length = 0;
  });

  it("refuses a write whose target is a symlink out of the repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sym-"));
    made.push(root);
    const outside = await mkdtemp(join(tmpdir(), "factory-out-"));
    made.push(outside);
    if (!(await canSymlink(root))) return; // unprivileged Windows → skip

    await writeFile(join(outside, "secret"), "pw", "utf8");
    await symlink(join(outside, "secret"), join(root, "link"));
    await expect(
      assertNoSymlinkEscape(root, join(root, "link")),
    ).rejects.toBeInstanceOf(PathGuardError);
  });

  it("refuses a write through a symlinked intermediate directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sym-"));
    made.push(root);
    const outside = await mkdtemp(join(tmpdir(), "factory-out-"));
    made.push(outside);
    if (!(await canSymlink(root))) return;

    await symlink(outside, join(root, "cfg"), "dir");
    // root/cfg -> outside; a write to root/cfg/app.yml lands in outside.
    await expect(
      assertNoSymlinkEscape(root, join(root, "cfg", "app.yml")),
    ).rejects.toBeInstanceOf(PathGuardError);
  });

  it("allows a normal (non-symlinked) new path", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sym-"));
    made.push(root);
    await mkdir(join(root, "docs"), { recursive: true });
    await expect(
      assertNoSymlinkEscape(root, join(root, "docs", "new.md")),
    ).resolves.toBeUndefined();
  });

  it("containedReadPath returns null for a symlink escaping the repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sym-"));
    made.push(root);
    const outside = await mkdtemp(join(tmpdir(), "factory-out-"));
    made.push(outside);
    if (!(await canSymlink(root))) return;

    await writeFile(join(outside, "creds"), "secret", "utf8");
    await symlink(join(outside, "creds"), join(root, "app.yml"));
    expect(await containedReadPath(root, "app.yml")).toBeNull();
  });

  it("containedReadPath resolves a normal in-repo file", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-sym-"));
    made.push(root);
    await writeFile(join(root, "real.txt"), "hi", "utf8");
    expect(await containedReadPath(root, "real.txt")).toBe(
      await realpath(join(root, "real.txt")),
    );
  });
});
