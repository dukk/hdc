import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDotenvFile,
  parseDotenvText,
} from "../env.mjs";
import {
  buildClumpRunEnv,
  bootstrapGlobalEnv,
  clearRootEnvFallbackWarnings,
  configUsesProxmox,
  isGlobalEnvKey,
  loadMergedRepoDotenv,
  loadPackageDotenvById,
  resolveEnvIncludes,
} from "./clump-env.mjs";
import { clearBwSessionProcessCache, ensureBwUnlocked, getProcessBwSession } from "./vaultwarden-cli.mjs";

describe("parseDotenvText / applyDotenvFile", () => {
  it("parses quoted values and applies to target env", () => {
    const target = { EXISTING: "keep" };
    const f = join(tmpdir(), `hdc-dotenv-target-${Date.now()}.env`);
    writeFileSync(f, 'HDC_A=plain\nHDC_B="dq"\nEXISTING=overwrite\n', "utf8");
    applyDotenvFile(f, target, false);
    expect(target.HDC_A).toBe("plain");
    expect(target.HDC_B).toBe("dq");
    expect(target.EXISTING).toBe("keep");
    applyDotenvFile(f, target, true);
    expect(target.EXISTING).toBe("overwrite");
  });
});

describe("loadMergedRepoDotenv", () => {
  it("merges public then private (private fills unset keys)", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-pub-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hdc-priv-"));
    const rel = "clumps/infrastructure/proxmox/.env";
    mkdirSync(join(publicRoot, "clumps/infrastructure/proxmox"), { recursive: true });
    mkdirSync(join(privateRoot, "clumps/infrastructure/proxmox"), { recursive: true });
    writeFileSync(join(publicRoot, rel), "HDC_PROXMOX_SSH_USER=root\nHDC_PROXMOX_API_TOKEN=public\n", "utf8");
    writeFileSync(join(privateRoot, rel), "HDC_PROXMOX_API_TOKEN=private\n", "utf8");

    /** @type {NodeJS.ProcessEnv} */
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    loadMergedRepoDotenv(publicRoot, rel, env);
    expect(env.HDC_PROXMOX_SSH_USER).toBe("root");
    expect(env.HDC_PROXMOX_API_TOKEN).toBe("public");
  });
});

describe("loadPackageDotenvById", () => {
  it("loads private package .env when clump lives under external clumps root", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-ext-pub-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hdc-ext-priv-"));
    const clumpsRoot = mkdtempSync(join(tmpdir(), "hdc-ext-clumps-"));
    mkdirSync(join(clumpsRoot, "infrastructure/proxmox"), { recursive: true });
    mkdirSync(join(privateRoot, "clumps/infrastructure/proxmox"), { recursive: true });
    writeFileSync(
      join(privateRoot, "clumps/infrastructure/proxmox/.env"),
      "HDC_PROXMOX_API_TOKEN=from-private\nHDC_PROXMOX_SSH_USER=root\n",
      "utf8",
    );

    /** @type {NodeJS.ProcessEnv} */
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    const deps = {
      clumpsDir: () => clumpsRoot,
      join,
    };
    const rel = loadPackageDotenvById(publicRoot, "proxmox", env, deps);
    expect(rel).toBe("clumps/infrastructure/proxmox/.env");
    expect(env.HDC_PROXMOX_API_TOKEN).toBe("from-private");
    expect(env.HDC_PROXMOX_SSH_USER).toBe("root");
  });
});

describe("buildClumpRunEnv", () => {
  afterEach(() => {
    clearRootEnvFallbackWarnings();
  });

  it("loads package env without polluting parent process.env", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-run-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hdc-run-priv-"));
    mkdirSync(join(publicRoot, "hdc/clump/services/demo"), { recursive: true });
    writeFileSync(
      join(publicRoot, "hdc/clump/services/demo/.env"),
      "HDC_DEMO_TOKEN=from-package\n",
      "utf8",
    );
    writeFileSync(
      join(publicRoot, "hdc/clump/services/demo/manifest.json"),
      JSON.stringify({ id: "demo", verbs: { query: { script: "run.mjs" } } }),
      "utf8",
    );

    /** @type {NodeJS.ProcessEnv} */
    const parent = { HDC_PRIVATE_ROOT: privateRoot, HDC_VAULT_PASSPHRASE: "global" };
    const manifest = {
      path: join(publicRoot, "hdc/clump/services/demo/manifest.json"),
      dir: join(publicRoot, "hdc/clump/services/demo"),
      raw: { id: "demo", verbs: { query: { script: "run.mjs" } } },
    };
    const deps = {
      env: parent,
      clumpsDir: (root) => join(root, "clumps"),
      join,
      warn: () => {},
      existsSync: (p) => {
        try {
          readFileSync(p);
          return true;
        } catch {
          return false;
        }
      },
    };

    const runEnv = buildClumpRunEnv(deps, publicRoot, manifest);
    expect(runEnv.HDC_DEMO_TOKEN).toBe("from-package");
    expect(runEnv.HDC_VAULT_PASSPHRASE).toBe("global");
    expect(parent.HDC_DEMO_TOKEN).toBeUndefined();
  });

  it("loads hdc-private package .env when clump lives under external clumps root", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-run-ext-pub-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hdc-run-ext-priv-"));
    const clumpsRoot = mkdtempSync(join(tmpdir(), "hdc-run-ext-clumps-"));
    mkdirSync(join(clumpsRoot, "services/uptime-kuma"), { recursive: true });
    mkdirSync(join(privateRoot, "clumps/services/uptime-kuma"), { recursive: true });
    writeFileSync(
      join(clumpsRoot, "services/uptime-kuma/manifest.json"),
      JSON.stringify({ id: "uptime-kuma", verbs: { maintain: { script: "run.mjs" } } }),
      "utf8",
    );
    writeFileSync(
      join(privateRoot, "clumps/services/uptime-kuma/.env"),
      "HDC_UPTIME_KUMA_USERNAME=admin\n",
      "utf8",
    );

    /** @type {NodeJS.ProcessEnv} */
    const parent = { HDC_PRIVATE_ROOT: privateRoot };
    const manifest = {
      path: join(clumpsRoot, "services/uptime-kuma/manifest.json"),
      dir: join(clumpsRoot, "services/uptime-kuma"),
      raw: { id: "uptime-kuma", verbs: { maintain: { script: "run.mjs" } } },
    };
    const deps = {
      env: parent,
      clumpsDir: () => clumpsRoot,
      join,
      warn: () => {},
    };

    const runEnv = buildClumpRunEnv(deps, publicRoot, manifest);
    expect(runEnv.HDC_UPTIME_KUMA_USERNAME).toBe("admin");
    expect(parent.HDC_UPTIME_KUMA_USERNAME).toBeUndefined();
  });

  it("warns once when falling back to root .env package keys", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-fallback-"));
    mkdirSync(join(publicRoot, "clumps/infrastructure/proxmox"), { recursive: true });
    writeFileSync(
      join(publicRoot, ".env"),
      "HDC_PROXMOX_API_TOKEN=legacy-root\n",
      "utf8",
    );
    writeFileSync(
      join(publicRoot, "clumps/infrastructure/proxmox/manifest.json"),
      JSON.stringify({ id: "proxmox", verbs: { query: { script: "run.mjs" } } }),
      "utf8",
    );

    /** @type {string[]} */
    const warnings = [];
    const manifest = {
      path: join(publicRoot, "clumps/infrastructure/proxmox/manifest.json"),
      dir: join(publicRoot, "clumps/infrastructure/proxmox"),
      raw: { id: "proxmox", verbs: { query: { script: "run.mjs" } } },
    };
    const deps = {
      env: {},
      clumpsDir: (root) => join(root, "clumps"),
      join,
      warn: (...a) => warnings.push(a.join(" ")),
      existsSync: (p) => {
        try {
          readFileSync(p);
          return true;
        } catch {
          return false;
        }
      },
    };

    buildClumpRunEnv(deps, publicRoot, manifest);
    buildClumpRunEnv(deps, publicRoot, manifest);
    expect(warnings.filter((w) => w.includes("HDC_PROXMOX_API_TOKEN")).length).toBe(1);
  });

  it("passes BW_SESSION into package run env when vaultwarden session is active", async () => {
    clearBwSessionProcessCache();
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-bw-session-"));
    mkdirSync(join(publicRoot, "hdc/clump/services/demo"), { recursive: true });
    writeFileSync(
      join(publicRoot, "hdc/clump/services/demo/manifest.json"),
      JSON.stringify({ id: "demo", verbs: { query: { script: "run.mjs" } } }),
      "utf8",
    );
    const ORG_ID = "org-1111-aaaa-bbbb-cccc";
    const COLL_ID = "coll-2222-dddd-eeee-ffff";
    const spawnSync = vi.fn((exe, args) => {
      const key = args.join(" ");
      if (key === "--version") return { status: 0, stdout: "2024.1.0", stderr: "" };
      if (key === "config server https://vault.example.test") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (key === `list items --collectionid ${COLL_ID}`) {
        return { status: 0, stdout: "[]", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${key}` };
    });
    /** @type {NodeJS.ProcessEnv} */
    const parent = {
      HDC_SECRET_BACKEND: "vaultwarden",
      HDC_VAULTWARDEN_URL: "https://vault.example.test",
      HDC_VAULTWARDEN_EMAIL: "ops@example.test",
      HDC_VAULTWARDEN_ORGANIZATION_ID: ORG_ID,
      HDC_VAULTWARDEN_COLLECTION_ID: COLL_ID,
      BW_SESSION: "inherited-session-key",
    };
    await ensureBwUnlocked(
      {
        env: parent,
        log: () => {},
        error: () => {},
        warn: () => {},
        readLineQuestion: async () => "",
        spawnSync,
      },
      async () => null,
      async () => {},
    );
    expect(getProcessBwSession()).toBe("inherited-session-key");

    const manifest = {
      path: join(publicRoot, "hdc/clump/services/demo/manifest.json"),
      dir: join(publicRoot, "hdc/clump/services/demo"),
      raw: { id: "demo", verbs: { query: { script: "run.mjs" } } },
    };
    const runEnv = buildClumpRunEnv(
      {
        env: parent,
        clumpsDir: (root) => join(root, "clumps"),
        join,
        warn: () => {},
        existsSync: (p) => {
          try {
            readFileSync(p);
            return true;
          } catch {
            return false;
          }
        },
      },
      publicRoot,
      manifest,
    );
    expect(runEnv.BW_SESSION).toBe("inherited-session-key");
    clearBwSessionProcessCache();
  });
});

describe("configUsesProxmox / resolveEnvIncludes", () => {
  it("detects proxmox modes in config", () => {
    expect(
      configUsesProxmox({
        defaults: { mode: "proxmox-lxc" },
        deployments: [{ mode: "configure-only" }],
      }),
    ).toBe(true);
    expect(configUsesProxmox({ defaults: { mode: "synology-docker" } })).toBe(false);
  });

  it("auto-includes proxmox env for proxmox-backed packages", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-inc-"));
    const pkgDir = join(publicRoot, "clumps/services/pi-hole");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "config.json"),
      JSON.stringify({ defaults: { mode: "proxmox-lxc" }, deployments: [] }),
      "utf8",
    );
    const manifest = {
      path: join(pkgDir, "manifest.json"),
      dir: pkgDir,
      raw: { id: "pi-hole", env_includes: ["bind"], verbs: {} },
    };
    const includes = resolveEnvIncludes(manifest, publicRoot, {});
    expect(includes).toContain("proxmox");
    expect(includes).toContain("bind");
  });
});

describe("isGlobalEnvKey", () => {
  it("classifies vault keys as global", () => {
    expect(isGlobalEnvKey("HDC_VAULT_PASSPHRASE")).toBe(true);
    expect(isGlobalEnvKey("HDC_PROXMOX_API_TOKEN")).toBe(false);
  });
});

describe("bootstrapGlobalEnv", () => {
  it("loads root .env into process env", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-boot-"));
    writeFileSync(join(publicRoot, ".env"), "HDC_VAULT_PASSPHRASE=from-file\n", "utf8");
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    bootstrapGlobalEnv(
      {
        env,
        join,
        loadDotenv: () => {},
      },
      publicRoot,
    );
    expect(env.HDC_VAULT_PASSPHRASE).toBe("from-file");
  });

  it("workspace .env overrides platform .env", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-boot-pub-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hdc-boot-priv-"));
    writeFileSync(join(publicRoot, ".env"), "HDC_VAULT_PASSPHRASE=from-platform\nHDC_ONLY_PUBLIC=1\n", "utf8");
    writeFileSync(
      join(privateRoot, ".env"),
      "HDC_VAULT_PASSPHRASE=from-workspace\nHDC_ONLY_PRIVATE=1\n",
      "utf8",
    );
    /** @type {NodeJS.ProcessEnv} */
    const env = { HDC_PRIVATE_ROOT: privateRoot };
    bootstrapGlobalEnv({ env, join }, publicRoot);
    expect(env.HDC_VAULT_PASSPHRASE).toBe("from-workspace");
    expect(env.HDC_ONLY_PUBLIC).toBe("1");
    expect(env.HDC_ONLY_PRIVATE).toBe("1");
  });
});
