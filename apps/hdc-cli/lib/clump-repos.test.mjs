import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkoutClumpRepoRef,
  isRemoteBranchRef,
  loadClumpsReposConfig,
  persistClumpRepoRef,
  readClumpRepoResolved,
  syncClumpRepo,
} from "./clump-repos.mjs";

/** @type {string[]} */
const temps = [];

afterEach(() => {
  while (temps.length) {
    const p = temps.pop();
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), "hdc-clump-repos-"));
  temps.push(d);
  return d;
}

/**
 * @param {Record<string, { status?: number; stdout?: string; stderr?: string }>} script
 */
function scriptedGit(script) {
  /** @type {string[][]} */
  const calls = [];
  /**
   * @param {string[]} args
   */
  function git(args) {
    calls.push(args);
    const key = args.join(" ");
    for (const [pattern, result] of Object.entries(script)) {
      if (key.includes(pattern) || key === pattern) {
        return {
          status: result.status ?? 0,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
        };
      }
    }
    // Default success for unlisted commands
    return { status: 0, stdout: "", stderr: "" };
  }
  return { git, calls };
}

describe("isRemoteBranchRef", () => {
  it("is true when origin/<ref> resolves", () => {
    const { git } = scriptedGit({
      "rev-parse --verify --quiet refs/remotes/origin/main": { status: 0, stdout: "abc\n" },
    });
    expect(isRemoteBranchRef("/repo", "main", git)).toBe(true);
  });

  it("is false when origin/<ref> is missing", () => {
    const { git } = scriptedGit({
      "rev-parse --verify --quiet refs/remotes/origin/v1.0.0": { status: 1 },
    });
    expect(isRemoteBranchRef("/repo", "v1.0.0", git)).toBe(false);
  });
});

describe("checkoutClumpRepoRef", () => {
  it("checks out a remote branch with -B", () => {
    const { git, calls } = scriptedGit({
      "rev-parse --verify --quiet refs/remotes/origin/main": { status: 0 },
    });
    const r = checkoutClumpRepoRef("/repo", "main", git);
    expect(r).toEqual({ ok: true, action: "pulled" });
    expect(calls.some((c) => c.includes("-B") && c.includes("main") && c.includes("origin/main"))).toBe(
      true,
    );
  });

  it("detaches for a tag/sha when not a remote branch", () => {
    const { git, calls } = scriptedGit({
      "rev-parse --verify --quiet refs/remotes/origin/abc1234": { status: 1 },
    });
    const r = checkoutClumpRepoRef("/repo", "abc1234", git);
    expect(r.ok).toBe(true);
    expect(r.action).toBe("checked-out");
    expect(calls.some((c) => c.includes("--detach") && c.includes("abc1234"))).toBe(true);
  });

  it("returns fetch-failed when fetch --tags fails", () => {
    const { git } = scriptedGit({
      "fetch origin --tags": { status: 1 },
    });
    expect(checkoutClumpRepoRef("/repo", "main", git)).toEqual({
      ok: false,
      action: "fetch-failed",
    });
  });
});

describe("syncClumpRepo", () => {
  it("dry-run does not invoke git", () => {
    const { git, calls } = scriptedGit({});
    const r = syncClumpRepo(
      { version: 1, cache_dir: "/cache", repos: [] },
      { id: "hdc-clumps", url: "https://example.invalid/hdc-clumps.git", ref: "main", mode: "active" },
      { dryRun: true, git },
    );
    expect(r).toMatchObject({ ok: true, action: "dry-run", ref: "main", resolved: null });
    expect(calls).toHaveLength(0);
  });

  it("clones then checks out and returns resolved HEAD", () => {
    const root = tempDir();
    const cache = join(root, "cache");
    mkdirSync(cache, { recursive: true });

    const { git } = scriptedGit({
      "rev-parse --verify --quiet refs/remotes/origin/main": { status: 0 },
      "rev-parse HEAD": { status: 0, stdout: "deadbeefcafebabe\n" },
    });
    // Simulate clone creating the dest directory
    const origGit = git;
    /**
     * @param {string[]} args
     * @param {{ stdio?: string }} [opts]
     */
    function gitWithClone(args, opts) {
      if (args[0] === "clone") {
        mkdirSync(join(cache, "hdc-clumps"), { recursive: true });
        return { status: 0, stdout: "", stderr: "" };
      }
      return origGit(args, opts);
    }

    const r = syncClumpRepo(
      { version: 1, cache_dir: cache, repos: [] },
      {
        id: "hdc-clumps",
        url: "https://example.invalid/hdc-clumps.git",
        ref: "main",
        mode: "active",
      },
      { git: gitWithClone },
    );
    expect(r.ok).toBe(true);
    expect(r.action).toBe("cloned");
    expect(r.resolved).toBe("deadbeefcafebabe");
    expect(r.path).toBe(join(cache, "hdc-clumps"));
  });

  it("returns clone-failed when clone exits non-zero", () => {
    const root = tempDir();
    const cache = join(root, "cache");
    mkdirSync(cache, { recursive: true });
    const { git } = scriptedGit({
      clone: { status: 128 },
    });
    // Override: only clone fails
    /**
     * @param {string[]} args
     */
    function gitFailClone(args) {
      if (args[0] === "clone") return { status: 128, stdout: "", stderr: "fail" };
      return git(args);
    }
    const r = syncClumpRepo(
      { version: 1, cache_dir: cache, repos: [] },
      {
        id: "hdc-clumps",
        url: "https://example.invalid/hdc-clumps.git",
        ref: "main",
        mode: "active",
      },
      { git: gitFailClone },
    );
    expect(r).toMatchObject({ ok: false, action: "clone-failed", ref: "main", resolved: null });
  });
});

describe("persistClumpRepoRef", () => {
  it("writes ref into hdc-private clumps-repos.json", () => {
    const root = tempDir();
    const pub = join(root, "hdc");
    const priv = join(root, "hdc-private");
    mkdirSync(join(pub, ".hdc"), { recursive: true });
    mkdirSync(priv, { recursive: true });
    writeFileSync(
      join(pub, ".hdc/clumps-repos.json"),
      JSON.stringify({
        version: 1,
        cache_dir: "~/.hdc/clump-repos",
        repos: [
          {
            id: "hdc-clumps",
            url: "https://github.com/dukk/hdc-clumps.git",
            ref: "main",
            mode: "active",
          },
        ],
        precedence: ["hdc-clumps"],
        overrides: {},
      }),
      "utf8",
    );

    const written = persistClumpRepoRef(pub, "hdc-clumps", "v1.2.3", {
      HDC_PRIVATE_ROOT: priv,
    });
    expect(written.path).toBe(join(priv, ".hdc/clumps-repos.json"));
    const data = JSON.parse(readFileSync(written.path, "utf8"));
    expect(data.repos[0].ref).toBe("v1.2.3");

    const loaded = loadClumpsReposConfig(pub, { HDC_PRIVATE_ROOT: priv });
    expect(loaded.repos.find((r) => r.id === "hdc-clumps")?.ref).toBe("v1.2.3");
  });

  it("throws when hdc-private is missing", () => {
    const root = tempDir();
    const pub = join(root, "hdc");
    mkdirSync(pub, { recursive: true });
    expect(() =>
      persistClumpRepoRef(pub, "hdc-clumps", "main", { HDC_PRIVATE_ROOT: "" }),
    ).toThrow(/hdc-private not configured/);
  });
});

describe("readClumpRepoResolved", () => {
  it("returns null when path missing", () => {
    expect(readClumpRepoResolved(join(tempDir(), "nope"))).toBeNull();
  });
});
