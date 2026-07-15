import { describe, expect, it } from "vitest";
import { computeCliInvocationForHelp, createNodeCliDeps } from "./lib/node-cli-deps.mjs";

describe("createNodeCliDeps", () => {
  it("returns production-shaped dependencies", () => {
    const d = createNodeCliDeps();
    expect(typeof d.repoRoot()).toBe("string");
    expect(d.repoRoot().length).toBeGreaterThan(0);
    expect(typeof d.spawnSync).toBe("function");
    expect(typeof d.readLineQuestion).toBe("function");
    expect(typeof d.readStdinUtf8).toBe("function");
    expect(typeof d.defaultVaultPath()).toBe("string");
    expect(typeof d.cliInvocationForHelp()).toBe("string");
    expect(d.cliInvocationForHelp().length).toBeGreaterThan(3);
    expect(d.cliInvocationForHelp()).toBe("hdc");
    expect(typeof d.stdoutWrite).toBe("function");
    expect(typeof d.hostProbe()).toBe("object");
    expect(typeof d.hostProbe().hostname).toBe("string");
  });

  it("computeCliInvocationForHelp normalizes HDC_CLI_INVOCATION wrappers to hdc", () => {
    const prev = process.env.HDC_CLI_INVOCATION;
    process.env.HDC_CLI_INVOCATION = "./hdc";
    try {
      expect(computeCliInvocationForHelp()).toBe("hdc");
    } finally {
      if (prev === undefined) delete process.env.HDC_CLI_INVOCATION;
      else process.env.HDC_CLI_INVOCATION = prev;
    }
  });

  it("computeCliInvocationForHelp normalizes hdc.cmd to hdc", () => {
    const prev = process.env.HDC_CLI_INVOCATION;
    process.env.HDC_CLI_INVOCATION = "hdc.cmd";
    try {
      expect(computeCliInvocationForHelp()).toBe("hdc");
    } finally {
      if (prev === undefined) delete process.env.HDC_CLI_INVOCATION;
      else process.env.HDC_CLI_INVOCATION = prev;
    }
  });
});
