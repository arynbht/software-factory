import { describe, expect, it } from "vitest";

import {
  gatherGitChangelogContext,
  type GitRunner,
  renderGitChangelogSection,
} from "./git-context.js";

// A fake runner so the assembly is tested without a real repository.
function fakeRunner(overrides: Partial<GitRunner> = {}): GitRunner {
  return {
    lastTag: async () => "v1.2.0",
    tags: async () => ["v1.2.0", "v1.1.0", "v1.0.0"],
    log: async () => [
      { hash: "aaaaaaaa1111", subject: "feat: add export", body: "" },
      {
        hash: "bbbbbbbb2222",
        subject: "fix: crash on open",
        body: "Closes #42\nThe parser mishandled empty files.",
      },
    ],
    ...overrides,
  };
}

describe("gatherGitChangelogContext", () => {
  it("ranges from the last tag to HEAD and returns commits + tags", async () => {
    let seenRange = "";
    const runner = fakeRunner({
      log: async (range) => {
        seenRange = range;
        return [{ hash: "deadbeef0000", subject: "feat: x", body: "" }];
      },
    });

    const ctx = await gatherGitChangelogContext(runner);

    expect(seenRange).toBe("v1.2.0..HEAD");
    expect(ctx.lastTag).toBe("v1.2.0");
    expect(ctx.commits).toHaveLength(1);
    expect(ctx.tags).toEqual(["v1.2.0", "v1.1.0", "v1.0.0"]);
  });

  it("falls back to the full history when there is no prior tag", async () => {
    let seenRange = "";
    const runner = fakeRunner({
      lastTag: async () => null,
      tags: async () => [],
      log: async (range) => {
        seenRange = range;
        return [{ hash: "c0ffee000000", subject: "feat: initial", body: "" }];
      },
    });

    const ctx = await gatherGitChangelogContext(runner);

    expect(seenRange).toBe("HEAD");
    expect(ctx.lastTag).toBeNull();
    expect(ctx.commits).toHaveLength(1);
  });
});

describe("renderGitChangelogSection", () => {
  it("renders commits, bodies, and tags as Markdown", async () => {
    const ctx = await gatherGitChangelogContext(fakeRunner());
    const section = renderGitChangelogSection(ctx);

    expect(section).toContain("## Git history");
    expect(section).toContain("Commits since the last tag `v1.2.0`");
    expect(section).toContain("aaaaaaaa feat: add export");
    expect(section).toContain("bbbbbbbb fix: crash on open");
    // The multi-line body is indented under its commit.
    expect(section).toContain("  Closes #42");
    expect(section).toContain("  The parser mishandled empty files.");
    expect(section).toContain("### Tags");
    expect(section).toContain("v1.2.0, v1.1.0, v1.0.0");
  });

  it("notes the full history and empty states cleanly", async () => {
    const ctx = await gatherGitChangelogContext(
      fakeRunner({
        lastTag: async () => null,
        tags: async () => [],
        log: async () => [],
      }),
    );
    const section = renderGitChangelogSection(ctx);

    expect(section).toContain("No prior release tag");
    expect(section).toContain("(no commits in range)");
    expect(section).toContain("(no tags)");
  });
});
