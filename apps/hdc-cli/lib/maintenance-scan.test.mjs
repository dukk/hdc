import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  formatMaintenanceSummaryMarkdown,
  maintenanceScanFingerprint,
  requirementsFromClientQuery,
  requirementsFromProxmoxPendingOsQuery,
  requirementsFromProxmoxRebootQuery,
  upgradeRequirementFromServiceProbe,
  versionLessThan,
  weeklyRoutineOverdueRequirements,
  runMaintenanceScan,
} from "../../hdc-agent-server/lib/maintenance-scan.mjs";

const HDC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("maintenance-scan", () => {
  it("maintenanceScanFingerprint is stable for same keys", () => {
    const reqs = [
      { key: "reboot:client:ubuntu:ws-1", kind: "client", label: "a", details: {} },
      { key: "upgrade:solidtime:1.2.3", kind: "service", label: "b", details: {} },
    ];
    expect(maintenanceScanFingerprint(reqs)).toBe(maintenanceScanFingerprint([...reqs].reverse()));
  });

  it("versionLessThan compares semver-ish tags", () => {
    expect(versionLessThan("1.0.0", "1.1.0")).toBe(true);
    expect(versionLessThan("v2.0.0", "2.0.0")).toBe(false);
    expect(versionLessThan("2.0.0", "1.9.9")).toBe(false);
  });

  it("maps client query reboot and pending updates", () => {
    const reqs = requirementsFromClientQuery(
      {
        hosts: [
          { host_id: "ws-1", reboot_required: true },
          { host_id: "pi-1", upgradable_count: 12 },
        ],
      },
      "ubuntu",
    );
    expect(reqs.some((r) => r.key.startsWith("reboot:client:"))).toBe(true);
    expect(reqs.some((r) => r.key.startsWith("pending:client:"))).toBe(true);
  });

  it("maps proxmox reboot and hypervisor pending OS", () => {
    const guest = requirementsFromProxmoxRebootQuery({
      reboot_required: [{ system_id: "pi-hole-a", vmid: 101 }],
    });
    expect(guest[0].key).toMatch(/^reboot:guest:/);

    const hyper = requirementsFromProxmoxPendingOsQuery({
      hypervisors: [{ id: "hypervisor-a", pending_updates: 5, reboot_required: false }],
    });
    expect(hyper[0].key).toMatch(/^hypervisor-os:/);
  });

  it("detects service upgrade when config is behind latest", () => {
    const req = upgradeRequirementFromServiceProbe(
      { deployments: [{ version: "v1.0.0" }] },
      {
        service: "gatus",
        latest: "v2.0.0",
        configVersionPath: ["deployments", "0", "version"],
      },
    );
    expect(req?.key).toMatch(/^upgrade:gatus:/);
  });

  it("weeklyRoutineOverdueRequirements flags missing log", () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-maint-weekly-"));
    try {
      const reqs = weeklyRoutineOverdueRequirements(root, ["client-maintain-weekly-windows"], Date.now());
      expect(reqs.length).toBe(1);
      expect(reqs[0].kind).toBe("routine");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips LLM when same fingerprint persists", async () => {
    const mockCapture = (_root, args) => {
      const cmd = args.join(" ");
      if (cmd.includes("client windows")) {
        return {
          ok: true,
          stdout: JSON.stringify({
            hosts: [{ host_id: "lan-1", reboot_required: true }],
          }),
          stderr: "",
        };
      }
      return { ok: true, stdout: JSON.stringify({ ok: true, hosts: [] }), stderr: "" };
    };

    const root = mkdtempSync(join(tmpdir(), "hdc-maint-scan-"));
    try {
      mkdirSync(join(root, "operations"), { recursive: true });
      const first = await runMaintenanceScan({
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now(),
        runHdcCliCapture: mockCapture,
        metaRoot: join(root, "meta"),
      });
      expect(first.should_invoke_llm).toBe(true);

      const second = await runMaintenanceScan({
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        nowMs: Date.now() + 1000,
        runHdcCliCapture: mockCapture,
        metaRoot: join(root, "meta"),
      });
      expect(second.same_as_last_cycle).toBe(true);
      expect(second.should_invoke_llm).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("formatMaintenanceSummaryMarkdown lists requirements", () => {
    const md = formatMaintenanceSummaryMarkdown([
      { key: "upgrade:gatus:2", kind: "service", label: "gatus upgrade", details: { service: "gatus" } },
    ]);
    expect(md).toContain("gatus upgrade");
    expect(md).toContain("service");
  });
});
