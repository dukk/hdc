import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import * as nodeModule from "node:module";

import { registerPackageHooks } from "./register-package-hooks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "..", "cli.mjs");
const preload = pathToFileURL(join(here, "preload.mjs")).href;

describe("registerPackageHooks", () => {
  it("exports a function", () => {
    expect(typeof registerPackageHooks).toBe("function");
  });

  it("cli entry does not emit DEP0205 when registerHooks is available", () => {
    if (typeof nodeModule.registerHooks !== "function") return;
    const r = spawnSync(process.execPath, [cli, "help"], {
      encoding: "utf8",
      env: { ...process.env },
    });
    expect(r.status).toBe(0);
    expect(String(r.stderr)).not.toMatch(/\[DEP0205\]/);
  });

  it("preload entry does not emit DEP0205 when registerHooks is available", () => {
    if (typeof nodeModule.registerHooks !== "function") return;
    const r = spawnSync(
      process.execPath,
      ["--import", preload, "-e", "console.log('ok')"],
      { encoding: "utf8", env: { ...process.env } },
    );
    expect(r.status).toBe(0);
    expect(String(r.stdout)).toContain("ok");
    expect(String(r.stderr)).not.toMatch(/\[DEP0205\]/);
  });
});
