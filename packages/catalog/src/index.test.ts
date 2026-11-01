import { describe, expect, it } from "vitest";

import { PACKAGE } from "./index.js";

describe("@arynbht/factory-catalog", () => {
  it("exposes its package identifier", () => {
    expect(PACKAGE).toBe("@arynbht/factory-catalog");
  });
});
