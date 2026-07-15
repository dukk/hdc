import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli-app.mjs";
import { createMemoryCliDeps } from "../test/memory-cli-deps.mjs";

describe("cli run client platform packages", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("runs clumps/clients/windows query script", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-cli-windows-"));
    const pkgDir = join(root, "clumps", "clients", "windows");
    const scriptDir = join(pkgDir, "query");
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "manifest.json"),
      JSON.stringify({ id: "windows", verbs: { query: { script: "run.mjs" } } }),
      "utf8",
    );
    writeFileSync(
      join(scriptDir, "run.mjs"),
      `process.stdout.write(JSON.stringify({ ok: true, probe: "windows-query" }));`,
      "utf8",
    );

    const capture = { logLines: [], errorLines: [], warnLines: [], stdoutChunks: [] };
    const code = await runCli(
      ["run", "client", "windows", "query", "--"],
      createMemoryCliDeps({
        root,
        capture,
      }),
    );
    expect(code).toBe(0);
    expect(JSON.parse(capture.stdoutChunks.join("")).probe).toBe("windows-query");
  });
});
