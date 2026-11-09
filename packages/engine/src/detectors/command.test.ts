import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildContext } from "../context.js";
import { command } from "./command.js";

const repo = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "fixtures",
  "empty",
);
const ctx = () => buildContext(repo, { runCommands: true });

describe("command", () => {
  it("passes when the command exits 0", async () => {
    const result = await command(ctx(), {
      type: "command",
      run: "node -e process.exit(0)",
    });
    expect(result.status).toBe("pass");
  });

  it("fails on an unexpected exit code", async () => {
    const result = await command(ctx(), {
      type: "command",
      run: "node -e process.exit(2)",
    });
    expect(result.status).toBe("fail");
  });

  it("passes when the exit code matches expectExitCode", async () => {
    const result = await command(ctx(), {
      type: "command",
      run: "node -e process.exit(3)",
      expectExitCode: 3,
    });
    expect(result.status).toBe("pass");
  });

  it("checks a jsonPath in stdout", async () => {
    const result = await command(ctx(), {
      type: "command",
      run: "node -e console.log(JSON.stringify({a:{b:5}}))",
      jsonPath: "a.b",
      equals: 5,
    });
    expect(result.status).toBe("pass");
  });

  it("skips when the tool is not installed", async () => {
    const result = await command(ctx(), {
      type: "command",
      run: "definitely-not-a-real-binary-xyz --version",
    });
    expect(result.status).toBe("skip");
  });
});
