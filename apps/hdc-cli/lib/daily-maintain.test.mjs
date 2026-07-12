import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDailyStepArgs,
  dailyRecipeSteps,
  filterDailyRecipeSteps,
  GUEST_BASELINE_SAFE_ARGS,
  packageRefKey,
  parseDailyMaintainArgv,
  parsePackageRef,
} from "./daily-maintain-recipe.mjs";
import { runDailyMaintain } from "./daily-maintain.mjs";
import { createMemoryCliDeps } from "../test/memory-cli-deps.mjs";
import { writeVault } from "../vault.mjs";
import { clearVaultPassphraseProcessCache } from "./vault-access.mjs";

function writeTree(root, /** @type {Record<string, string>} */ files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
}

describe("daily-maintain-recipe", () => {
  it("parses tier/id package refs", () => {
    expect(parsePackageRef("service/bind")).toEqual({ tier: "service", id: "bind" });
    expect(parsePackageRef("kafka")).toEqual({ tier: "service", id: "kafka" });
    expect(parsePackageRef("")).toBeNull();
  });

  it("kafka uses query and proxmox uses safe maintain args", () => {
    const steps = dailyRecipeSteps();
    const kafka = steps.find((s) => s.id === "kafka" && s.tier === "service");
    const proxmox = steps.find((s) => s.id === "proxmox" && s.tier === "infrastructure");
    expect(kafka?.verb).toBe("query");
    expect(proxmox?.verb).toBe("maintain");
    expect(proxmox?.args).toContain("--no-prune");
    expect(proxmox?.args).toContain("--skip-os-updates");
  });

  it("clients use query only", () => {
    const steps = dailyRecipeSteps().filter((s) => s.tier === "client");
    expect(steps.length).toBe(3);
    expect(steps.every((s) => s.verb === "query")).toBe(true);
  });

  it("service maintain steps include guest baseline safety flags", () => {
    const bind = dailyRecipeSteps().find((s) => s.id === "bind" && s.verb === "maintain");
    expect(bind?.args).toEqual(expect.arrayContaining(GUEST_BASELINE_SAFE_ARGS));
  });

  it("buildDailyStepArgs appends skip-upgrade flags when requested", () => {
    const plex = dailyRecipeSteps().find((s) => s.id === "plex");
    expect(buildDailyStepArgs(/** @type {import("./daily-maintain-recipe.mjs").DailyRecipeStep} */ (plex), {
      skipUpgrades: true,
    })).toContain("--skip-upgrade");

    const bind = dailyRecipeSteps().find((s) => s.id === "bind" && s.verb === "maintain");
    expect(buildDailyStepArgs(/** @type {import("./daily-maintain-recipe.mjs").DailyRecipeStep} */ (bind), {
      skipUpgrades: true,
    })).toContain("--skip-apt");
  });

  it("filterDailyRecipeSteps honors only, skip, and skipClients", () => {
    const steps = dailyRecipeSteps();
    const only = filterDailyRecipeSteps(steps, {
      only: new Set([packageRefKey("service", "kafka")]),
    });
    expect(only.every((s) => s.id === "kafka")).toBe(true);

    const noClients = filterDailyRecipeSteps(steps, { skipClients: true });
    expect(noClients.some((s) => s.tier === "client")).toBe(false);

    const skipped = filterDailyRecipeSteps(steps, {
      skip: new Set([packageRefKey("infrastructure", "proxmox")]),
    });
    expect(skipped.some((s) => s.id === "proxmox")).toBe(false);
  });

  it("parseDailyMaintainArgv collects flags", () => {
    const f = parseDailyMaintainArgv([
      "--dry-run",
      "--skip-clients",
      "--only",
      "service/kafka",
      "--skip",
      "infrastructure/proxmox",
      "--report",
      "/tmp/report.md",
    ]);
    expect(f.dryRun).toBe(true);
    expect(f.skipClients).toBe(true);
    expect(f.only.has("service/kafka")).toBe(true);
    expect(f.skip.has("infrastructure/proxmox")).toBe(true);
    expect(f.reportPath).toBe("/tmp/report.md");
  });
});

describe("runDailyMaintain", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
    clearVaultPassphraseProcessCache();
    vi.restoreAllMocks();
  });

  function miniManifest(id, tierDir) {
    return JSON.stringify({
      id,
      title: id,
      verbs: {
        query: { script: "run.mjs" },
        maintain: { script: "run.mjs" },
      },
    });
  }

  it("dry-run plans invocations without spawning", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-daily-"));
    writeTree(root, {
      "clumps/services/kafka/manifest.json": miniManifest("kafka", "services"),
      "clumps/services/kafka/config.json": JSON.stringify({ schema_version: 1 }),
      "clumps/services/kafka/query/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const spawnMock = vi.fn();
    const deps = createMemoryCliDeps({ root, capture, spawnSync: spawnMock });

    const code = await runDailyMaintain(deps, root, ["--dry-run", "--only", "service/kafka"]);
    expect(code).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(capture.logLines.join("\n")).toMatch(/run service kafka query/);
  });

  it("skips packages without config.json", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-daily-"));
    writeTree(root, {
      "clumps/services/kafka/manifest.json": miniManifest("kafka", "services"),
      "clumps/services/kafka/query/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });

    const code = await runDailyMaintain(deps, root, ["--dry-run", "--only", "service/kafka"]);
    expect(code).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/no config\.json/);
  });

  it("client steps use per-package config.json not parent clients dir", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-daily-"));
    writeTree(root, {
      "clumps/clients/windows/manifest.json": miniManifest("windows", "clients"),
      "clumps/clients/windows/config.json": JSON.stringify({ schema_version: 1, hosts: [] }),
      "clumps/clients/windows/query/run.mjs": "process.exit(0)\n",
      "clumps/clients/config.json": JSON.stringify({ schema_version: 1, hosts: [] }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });

    const code = await runDailyMaintain(deps, root, ["--dry-run", "--only", "client/windows"]);
    expect(code).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/run client windows query/);
    expect(capture.logLines.join("\n")).not.toMatch(/no config\.json/);
  });

  it("skips client package when only parent clients config exists", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-daily-"));
    writeTree(root, {
      "clumps/clients/windows/manifest.json": miniManifest("windows", "clients"),
      "clumps/clients/windows/query/run.mjs": "process.exit(0)\n",
      "clumps/clients/config.json": JSON.stringify({ schema_version: 1, hosts: [] }),
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });

    const code = await runDailyMaintain(deps, root, ["--dry-run", "--only", "client/windows"]);
    expect(code).toBe(0);
    expect(capture.logLines.join("\n")).toMatch(/no config\.json/);
  });

  it("continues after a failure and exits non-zero", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-daily-"));
    const vaultPath = join(root, "vault.enc");
    writeVault(vaultPath, "pw", {});
    writeTree(root, {
      "clumps/services/kafka/manifest.json": miniManifest("kafka", "services"),
      "clumps/services/kafka/config.json": JSON.stringify({ schema_version: 1 }),
      "clumps/services/kafka/query/run.mjs": "process.stdout.write(JSON.stringify({ok:false})+'\\n'); process.exit(1)\n",
      "clumps/services/homeassistant/manifest.json": miniManifest("homeassistant", "services"),
      "clumps/services/homeassistant/config.json": JSON.stringify({ schema_version: 1 }),
      "clumps/services/homeassistant/query/run.mjs":
        "process.stdout.write(JSON.stringify({ok:true})+'\\n'); process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({
      root,
      capture,
      envVars: { HDC_VAULT_PASSPHRASE: "pw" },
      defaultVaultPath: () => vaultPath,
    });

    const code = await runDailyMaintain(deps, root, [
      "--only",
      "service/kafka",
      "--only",
      "service/homeassistant",
      "--no-report",
    ]);
    expect(code).toBe(1);
    expect(capture.logLines.join("\n")).toMatch(/homeassistant.*ok/);
    expect(capture.errorLines.join("\n")).toMatch(/kafka.*failed/);
  });

  it("writes aggregated report by default", async () => {
    root = mkdtempSync(join(tmpdir(), "hdc-daily-"));
    writeTree(root, {
      "clumps/services/kafka/manifest.json": miniManifest("kafka", "services"),
      "clumps/services/kafka/config.json": JSON.stringify({ schema_version: 1 }),
      "clumps/services/kafka/query/run.mjs": "process.exit(0)\n",
    });
    const capture = { logLines: [], errorLines: [], warnLines: [] };
    const deps = createMemoryCliDeps({ root, capture });

    const code = await runDailyMaintain(deps, root, ["--dry-run", "--only", "service/kafka"]);
    expect(code).toBe(0);
    const reportLine = capture.logLines.find((l) => l.includes("daily-maintain-") && l.includes(".md"));
    expect(reportLine).toBeTruthy();
    const reportPath = reportLine?.split("report ").pop();
    expect(reportPath && existsSync(reportPath)).toBe(true);
    const body = readFileSync(/** @type {string} */ (reportPath), "utf8");
    expect(body).toContain("# HDC daily maintain report");
    expect(body).toContain("service/kafka/query");
  });
});
