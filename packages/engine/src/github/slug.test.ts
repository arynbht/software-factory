import { describe, expect, it } from "vitest";

import { parseRepoSlug } from "./slug.js";

describe("parseRepoSlug", () => {
  it("parses HTTPS remotes", () => {
    expect(
      parseRepoSlug("https://github.com/arynbht/software-factory.git"),
    ).toEqual({ owner: "arynbht", repo: "software-factory" });
    expect(
      parseRepoSlug("https://github.com/arynbht/software-factory"),
    ).toEqual({
      owner: "arynbht",
      repo: "software-factory",
    });
  });

  it("parses SSH remotes", () => {
    expect(
      parseRepoSlug("git@github.com:arynbht/software-factory.git"),
    ).toEqual({
      owner: "arynbht",
      repo: "software-factory",
    });
  });

  it("returns null for non-GitHub or empty URLs", () => {
    expect(parseRepoSlug(undefined)).toBeNull();
    expect(parseRepoSlug("https://gitlab.com/a/b.git")).toBeNull();
  });

  it("returns null for a non-bare URL with extra path segments", () => {
    expect(
      parseRepoSlug("https://github.com/arynbht/software-factory/tree/main"),
    ).toBeNull();
  });
});
