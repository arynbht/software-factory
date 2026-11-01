import { describe, expect, it } from "vitest";

import { exitCodeForCi } from "./ci.js";

describe("exitCodeForCi", () => {
  it("fails only on a pull request with a red gate", () => {
    expect(exitCodeForCi(true, "red")).toBe(1);
    expect(exitCodeForCi(true, "amber")).toBe(0);
    expect(exitCodeForCi(true, "green")).toBe(0);
  });

  it("never fails a non-PR (scheduled/push) run", () => {
    expect(exitCodeForCi(false, "red")).toBe(0);
    expect(exitCodeForCi(false, "amber")).toBe(0);
    expect(exitCodeForCi(false, "green")).toBe(0);
  });
});
