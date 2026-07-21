import { describe, expect, it } from "vitest";

import { buildClumpsSyncArgv, clumpRepoRefEnvKey } from "./tools.mjs";

describe("hdc_clumps_sync helpers", () => {
  it("builds clumps sync argv", () => {
    expect(buildClumpsSyncArgv({ action: "sync" })).toEqual(["clumps", "sync"]);
    expect(buildClumpsSyncArgv({ action: "init", repo: "hdc-clumps", dry_run: true })).toEqual([
      "clumps",
      "init",
      "--repo",
      "hdc-clumps",
      "--dry-run",
    ]);
  });

  it("includes --ref and persist flags", () => {
    expect(buildClumpsSyncArgv({ action: "sync", ref: "main", persist: true })).toEqual([
      "clumps",
      "sync",
      "--ref",
      "main",
      "--persist",
    ]);
    expect(buildClumpsSyncArgv({ action: "sync", ref: "abc1234", persist: false })).toEqual([
      "clumps",
      "sync",
      "--ref",
      "abc1234",
      "--no-persist",
    ]);
    expect(buildClumpsSyncArgv({ action: "sync", ref: "v1", no_persist: true })).toEqual([
      "clumps",
      "sync",
      "--ref",
      "v1",
      "--no-persist",
    ]);
  });

  it("rejects invalid action", () => {
    expect(() => buildClumpsSyncArgv({ action: "pull" })).toThrow(/init.*sync/);
  });

  it("maps repo id to ref env key", () => {
    expect(clumpRepoRefEnvKey("hdc-clumps")).toBe("HDC_CLUMPS_REPO_HDC_CLUMPS_REF");
    expect(clumpRepoRefEnvKey("my-repo")).toBe("HDC_CLUMPS_REPO_MY_REPO_REF");
  });
});
