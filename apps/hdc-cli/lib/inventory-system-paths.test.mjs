import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MANUAL_SYSTEMS,
  SYSTEM_CLASSES,
  manualSidecarLegacyRels,
  manualSystemSidecarCandidateRels,
  manualSystemSidecarRel,
  normalizeSystemClass,
} from "./inventory-paths.mjs";
import { listManualSystemIds, resolveSystemById } from "./inventory-resolve.mjs";

describe("system class inventory paths", () => {
  it("builds class subdirectory paths", () => {
    expect(SYSTEM_CLASSES).toEqual(["physical", "virtual"]);
    expect(normalizeSystemClass("Physical")).toBe("physical");
    expect(normalizeSystemClass("nope")).toBe(null);
    expect(manualSystemSidecarRel("pve-a", "physical")).toBe(
      "operations/inventory/systems/physical/pve-a.json",
    );
    expect(manualSystemSidecarRel("wallos-a", "virtual")).toBe(
      "operations/inventory/systems/virtual/wallos-a.json",
    );
    expect(manualSystemSidecarCandidateRels("x")).toEqual([
      "operations/inventory/systems/physical/x.json",
      "operations/inventory/systems/virtual/x.json",
      "operations/inventory/systems/x.json",
      "operations/manual/systems/x.json",
      "inventory/manual/systems/x.json",
    ]);
    expect(manualSidecarLegacyRels("systems", "x")[0]).toBe(`${MANUAL_SYSTEMS}/x.json`);
  });

  it("resolves class dirs and lists ids; flat is legacy fallback", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-sys-pub-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hdc-sys-priv-"));
    try {
      const sys = join(privateRoot, MANUAL_SYSTEMS);
      mkdirSync(join(sys, "physical"), { recursive: true });
      mkdirSync(join(sys, "virtual"), { recursive: true });
      writeFileSync(
        join(sys, "physical", "pve-a.json"),
        JSON.stringify({ id: "pve-a", kind: "system", system_class: "physical" }),
      );
      writeFileSync(
        join(sys, "virtual", "wallos-a.json"),
        JSON.stringify({ id: "wallos-a", kind: "system", system_class: "virtual" }),
      );
      writeFileSync(
        join(sys, "legacy-flat.json"),
        JSON.stringify({ id: "legacy-flat", kind: "system", system_class: "physical" }),
      );

      const env = { HDC_PRIVATE_ROOT: privateRoot };
      expect(listManualSystemIds(publicRoot, env)).toEqual(["legacy-flat", "pve-a", "wallos-a"]);
      expect(resolveSystemById(publicRoot, "pve-a", env)?.id).toBe("pve-a");
      expect(resolveSystemById(publicRoot, "wallos-a", env)?.system_class).toBe("virtual");
      expect(resolveSystemById(publicRoot, "legacy-flat", env)?.id).toBe("legacy-flat");
      expect(resolveSystemById(publicRoot, "missing", env)).toBe(null);
    } finally {
      rmSync(publicRoot, { recursive: true, force: true });
      rmSync(privateRoot, { recursive: true, force: true });
    }
  });
});
