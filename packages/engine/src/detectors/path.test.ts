import { describe, expect, it } from "vitest";

import { deepEqual, getByPath, tokenizePath } from "./path.js";

describe("tokenizePath", () => {
  it("splits dot and bracket notation", () => {
    expect(tokenizePath("a.b[0].c")).toEqual(["a", "b", "0", "c"]);
    expect(tokenizePath("on[1]")).toEqual(["on", "1"]);
  });
});

describe("getByPath", () => {
  const doc = { a: { b: [{ c: 1 }, { c: 2 }] }, flag: false };

  it("finds nested values including array indices", () => {
    expect(getByPath(doc, "a.b[1].c")).toEqual({ found: true, value: 2 });
  });

  it("distinguishes a falsy value from a missing one", () => {
    expect(getByPath(doc, "flag")).toEqual({ found: true, value: false });
    expect(getByPath(doc, "missing")).toEqual({
      found: false,
      value: undefined,
    });
  });

  it("returns not-found when walking through a non-object", () => {
    expect(getByPath(doc, "flag.nope").found).toBe(false);
  });

  it("does not match inherited/prototype keys", () => {
    expect(getByPath(doc, "constructor").found).toBe(false);
    expect(getByPath(doc, "toString").found).toBe(false);
    expect(getByPath(doc, "a.hasOwnProperty").found).toBe(false);
  });

  it("only matches in-range numeric array indices, not length/methods", () => {
    expect(getByPath(doc, "a.b.length").found).toBe(false);
    expect(getByPath(doc, "a.b.map").found).toBe(false);
    expect(getByPath(doc, "a.b[5]").found).toBe(false);
    expect(getByPath(doc, "a.b[0].c")).toEqual({ found: true, value: 1 });
  });
});

describe("deepEqual", () => {
  it("compares scalars, arrays, and objects", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual([1, 2], [1, 2])).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});
