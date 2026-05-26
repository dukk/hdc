import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createOperationReportContext,
  defaultNextSteps,
  defaultOperationReportPath,
  manifestOperationReportNextSteps,
  parseOperationReportArgv,
  pushWarning,
  recordStep,
  redactSecretsForReport,
  renderOperationReportMarkdown,
  setStdoutPayload,
  writeOperationReportFile,
} from "../../../packages/lib/operation-report.mjs";
import {
  loadManualSystemSidecar,
  primaryIpFromSystem,
} from "../../../packages/lib/inventory-sidecar.mjs";

describe("operation-report", () => {
  it("parseOperationReportArgv handles --no-report and --report", () => {
    const p = parseOperationReportArgv(["--dry-run", "--no-report", "--report", "/tmp/x.md", "--instance", "a"]);
    expect(p.noReport).toBe(true);
    expect(p.dryRun).toBe(true);
    expect(p.reportPathArg).toBe("/tmp/x.md");
    expect(p.argvFlags).toContain("--dry-run");
    expect(p.argvFlags).toContain("--instance");
    expect(p.argvFlags).not.toContain("--report");
  });

  it("defaultOperationReportPath uses verb and timestamp under reports/", () => {
    const p = defaultOperationReportPath("/pkg/root", "deploy");
    expect(p).toMatch(/[/\\]pkg[/\\]root[/\\]reports[/\\]deploy-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/);
  });

  it("writeOperationReportFile returns null when --no-report", () => {
    const ctx = createOperationReportContext({
      packageId: "pi-hole",
      packageTitle: "Pi-hole",
      verb: "deploy",
      argv: ["--no-report"],
    });
    const written = writeOperationReportFile({
      packageRoot: "/tmp/pkg",
      ctx,
    });
    expect(written).toBeNull();
  });

  it("redactSecretsForReport masks secret keys", () => {
    const out = redactSecretsForReport({
      ok: true,
      webpassword: "secret123",
      nested: { api_token: "tok" },
    });
    expect(/** @type {Record<string, unknown>} */ (out).webpassword).toBe("[redacted]");
    expect(/** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (out).nested).api_token).toBe(
      "[redacted]",
    );
  });

  it("renderOperationReportMarkdown includes systems, access, and next steps", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hdc-op-report-"));
    try {
      const systemsDir = join(tmp, "inventory", "manual", "systems");
      const servicesDir = join(tmp, "inventory", "manual", "services");
      mkdirSync(systemsDir, { recursive: true });
      mkdirSync(servicesDir, { recursive: true });
      writeFileSync(
        join(systemsDir, "pi-hole-a.json"),
        JSON.stringify({
          id: "pi-hole-a",
          kind: "system",
          access: { nodes: [{ name: "pi-hole-a" }] },
          services: [{ id: "pi-hole" }],
        }),
      );
      writeFileSync(
        join(servicesDir, "pi-hole.json"),
        JSON.stringify({ id: "pi-hole", kind: "services", notes: "Point DHCP DNS here." }),
      );

      const ctx = createOperationReportContext({
        packageId: "pi-hole",
        packageTitle: "Pi-hole DNS filtering",
        verb: "deploy",
        argv: ["--instance", "a"],
        manifestNextSteps: ["Custom manifest step."],
      });
      ctx.ok = true;
      setStdoutPayload(ctx, {
        ok: true,
        target: "pi-hole",
        verb: "deploy",
        results: [{ ok: true, system_id: "pi-hole-a", ip: "192.0.2.53" }],
      });
      const pkgRoot = join(tmp, "packages", "services", "pi-hole");
      mkdirSync(join(pkgRoot, "reports"), { recursive: true });
      const written = writeOperationReportFile({
        packageRoot: pkgRoot,
        ctx,
        repoRoot: tmp,
      });
      expect(written).toBeTruthy();
      const md = readFileSync(/** @type {string} */ (written), "utf8");
      expect(md).toContain("# Pi-hole DNS filtering deploy report");
      expect(md).toContain("### pi-hole-a");
      expect(md).toContain("192.0.2.53");
      expect(md).toContain("http://192.0.2.53/admin/");
      expect(md).toContain("Point DHCP DNS here.");
      expect(md).toContain("Custom manifest step.");
      expect(md).not.toContain("[redacted]");
      expect(md).not.toContain("secret123");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("defaultNextSteps for deploy mentions query and inventory", () => {
    const ctx = createOperationReportContext({
      packageId: "bind",
      packageTitle: "BIND",
      verb: "deploy",
    });
    setStdoutPayload(ctx, {
      results: [{ ok: true, system_id: "vm-dns-a", ip: "192.0.2.10" }],
    });
    const steps = defaultNextSteps(ctx);
    expect(steps.some((s) => s.includes("run bind query"))).toBe(true);
    expect(steps.some((s) => s.includes("vm-dns-a.json"))).toBe(true);
  });

  it("manifestOperationReportNextSteps reads operation_report.next_steps", () => {
    const steps = manifestOperationReportNextSteps({
      operation_report: { next_steps: ["Step A", "  ", 1] },
    });
    expect(steps).toEqual(["Step A"]);
  });

  it("inventory-sidecar loads system and primary IP", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hdc-inv-"));
    try {
      const dir = join(tmp, "inventory", "manual", "systems");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "vm-test-a.json"),
        JSON.stringify({ access: { nodes: [{ ip: "192.0.2.5" }] } }),
      );
      const sys = loadManualSystemSidecar(tmp, "vm-test-a");
      expect(primaryIpFromSystem(sys)).toBe("192.0.2.5");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
