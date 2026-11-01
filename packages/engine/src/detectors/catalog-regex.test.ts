import { loadBundledCatalog } from "@arynbht/factory-catalog";
import { describe, expect, it } from "vitest";

import { compileRegex } from "./util.js";

// Guards against a class of silent failure: a malformed file-matches pattern does
// not fail the audit — it throws inside the detector and is reported as `skip`, so
// the control quietly vanishes from results. Compile every shipped pattern here so
// a bad one fails CI instead.
describe("bundled catalog patterns", () => {
  it("loads with no validation errors", async () => {
    const { controls, errors } = await loadBundledCatalog();
    expect(errors).toEqual([]);
    expect(controls.length).toBeGreaterThan(0);
  });

  it("every file-matches pattern compiles", async () => {
    const { controls } = await loadBundledCatalog();
    const broken: string[] = [];
    for (const control of controls) {
      for (const detector of control.detect) {
        if (detector.type === "file-matches") {
          try {
            compileRegex(detector.pattern);
          } catch {
            broken.push(`${control.id}: ${detector.pattern}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
