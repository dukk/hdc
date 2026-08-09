import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  automatedCategoryRel,
  automatedNetworkRel,
  automatedPolicyRel,
  automatedSidecarRel,
  automatedSystemRel,
} from "../inventory-paths.mjs";
import {
  isAutomatedBackendSidecar,
  writeAutomatedInventorySidecars,
} from "./automated-inventory-write.mjs";

describe("automated inventory paths", () => {
  it("builds category sidecars", () => {
    expect(automatedNetworkRel("net-lan")).toBe("operations/automated/networks/net-lan.json");
    expect(automatedPolicyRel("fw-lan")).toBe("operations/automated/policies/fw-lan.json");
    expect(automatedSystemRel("sys-phone")).toBe("operations/automated/systems/sys-phone.json");
    expect(automatedCategoryRel("networks")).toBe("operations/automated/networks");
    expect(automatedSidecarRel("policies", "pf-http")).toBe(
      "operations/automated/policies/pf-http.json",
    );
  });
});

describe("isAutomatedBackendSidecar", () => {
  it("matches unifi tags or _automated_source", () => {
    expect(isAutomatedBackendSidecar({ tags: ["unifi", "automated"] })).toBe(true);
    expect(isAutomatedBackendSidecar({ _automated_source: "unifi-network" })).toBe(true);
    expect(isAutomatedBackendSidecar({ tags: ["example"] })).toBe(false);
    expect(isAutomatedBackendSidecar({ _automated_source: "cloudflare" })).toBe(false);
  });
});

describe("writeAutomatedInventorySidecars", () => {
  /** @type {string} */
  let publicRoot;
  /** @type {string} */
  let privateRoot;
  /** @type {NodeJS.ProcessEnv} */
  let env;

  beforeEach(() => {
    publicRoot = mkdtempSync(join(tmpdir(), "hdc-public-"));
    privateRoot = mkdtempSync(join(tmpdir(), "hdc-private-"));
    env = { HDC_PRIVATE_ROOT: privateRoot };
  });

  afterEach(() => {
    rmSync(publicRoot, { recursive: true, force: true });
    rmSync(privateRoot, { recursive: true, force: true });
  });

  it("upserts records under hdc-private automated networks", () => {
    const result = writeAutomatedInventorySidecars(
      publicRoot,
      [
        {
          schema_version: 1,
          id: "net-lan",
          kind: "network",
          tags: ["unifi", "automated"],
          _automated_source: "unifi-network",
        },
      ],
      { category: "networks", env },
    );
    expect(result.written).toBe(1);
    expect(result.pruned).toBe(0);
    const abs = join(privateRoot, "operations", "automated", "networks", "net-lan.json");
    expect(existsSync(abs)).toBe(true);
    expect(JSON.parse(readFileSync(abs, "utf8")).id).toBe("net-lan");
  });

  it("prunes stale unifi automated sidecars when prune is set", () => {
    const dir = join(privateRoot, "operations", "automated", "systems");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sys-gone.json"),
      JSON.stringify({
        id: "sys-gone",
        kind: "system",
        tags: ["unifi", "automated"],
        _automated_source: "unifi-network",
      }),
      "utf8",
    );
    writeFileSync(
      join(dir, "sys-keep-manual.json"),
      JSON.stringify({ id: "sys-keep-manual", kind: "system", tags: ["other"] }),
      "utf8",
    );

    const result = writeAutomatedInventorySidecars(
      publicRoot,
      [
        {
          schema_version: 1,
          id: "sys-phone",
          kind: "system",
          tags: ["unifi", "automated"],
          _automated_source: "unifi-network",
        },
      ],
      { category: "systems", prune: true, env },
    );

    expect(result.written).toBe(1);
    expect(result.pruned).toBe(1);
    expect(existsSync(join(dir, "sys-gone.json"))).toBe(false);
    expect(existsSync(join(dir, "sys-keep-manual.json"))).toBe(true);
    expect(existsSync(join(dir, "sys-phone.json"))).toBe(true);
  });

  it("does not prune without prune flag", () => {
    const dir = join(privateRoot, "operations", "automated", "policies");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "fw-old.json"),
      JSON.stringify({
        id: "fw-old",
        kind: "policy",
        tags: ["unifi", "automated"],
        _automated_source: "unifi-network",
      }),
      "utf8",
    );

    const result = writeAutomatedInventorySidecars(
      publicRoot,
      [
        {
          schema_version: 1,
          id: "fw-new",
          kind: "policy",
          tags: ["unifi", "automated"],
          _automated_source: "unifi-network",
        },
      ],
      { category: "policies", env },
    );

    expect(result.written).toBe(1);
    expect(result.pruned).toBe(0);
    expect(existsSync(join(dir, "fw-old.json"))).toBe(true);
  });
});
