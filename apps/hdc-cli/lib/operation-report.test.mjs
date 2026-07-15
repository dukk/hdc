import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
} from "hdc/package/operation-report.mjs";
import {
  loadManualSystemSidecar,
  primaryIpFromSystem,
} from "hdc/package/inventory-sidecar.mjs";

describe("operation-report", () => {
  it("parseOperationReportArgv handles --no-report and --report", () => {
    const p = parseOperationReportArgv([
      "--dry-run",
      "--no-report",
      "--no-discord-notify",
      "--report",
      "/tmp/x.md",
      "--instance",
      "a",
    ]);
    expect(p.noReport).toBe(true);
    expect(p.noDiscordNotify).toBe(true);
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

  describe("with hdc-private", () => {
    /** @type {string} */
    let publicRoot;
    /** @type {string} */
    let privateRoot;
    /** @type {string | undefined} */
    let prevPrivateRoot;

    beforeEach(() => {
      publicRoot = mkdtempSync(join(tmpdir(), "hdc-op-pub-"));
      privateRoot = mkdtempSync(join(tmpdir(), "hdc-op-priv-"));
      prevPrivateRoot = process.env.HDC_PRIVATE_ROOT;
      process.env.HDC_PRIVATE_ROOT = privateRoot;
    });

    afterEach(() => {
      if (prevPrivateRoot === undefined) delete process.env.HDC_PRIVATE_ROOT;
      else process.env.HDC_PRIVATE_ROOT = prevPrivateRoot;
      rmSync(publicRoot, { recursive: true, force: true });
      rmSync(privateRoot, { recursive: true, force: true });
    });

    it("defaultOperationReportPath prefers hdc-private when publicRoot is set", () => {
      const packageRoot = join(publicRoot, "clumps", "services", "bind");
      mkdirSync(packageRoot, { recursive: true });
      const p = defaultOperationReportPath(packageRoot, "maintain", undefined, publicRoot);
      expect(p).toMatch(
        new RegExp(
          `${privateRoot.replace(/\\/g, "\\\\")}[/\\\\]clumps[/\\\\]services[/\\\\]bind[/\\\\]reports[/\\\\]maintain-\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.md$`,
        ),
      );
    });

    it("writeOperationReportFile writes under hdc-private when repoRoot is set", () => {
      const packageRoot = join(publicRoot, "clumps", "services", "bind");
      mkdirSync(packageRoot, { recursive: true });
      const ctx = createOperationReportContext({
        clumpId: "bind",
        clumpTitle: "BIND",
        verb: "maintain",
      });
      ctx.ok = true;
      setStdoutPayload(ctx, { ok: true, results: [] });
      const written = writeOperationReportFile({
        clumpRoot: packageRoot,
        ctx,
        repoRoot: publicRoot,
      });
      expect(written).toBeTruthy();
      expect(String(written).startsWith(privateRoot)).toBe(true);
      expect(existsSync(/** @type {string} */ (written))).toBe(true);
      expect(existsSync(join(packageRoot, "reports"))).toBe(false);
    });
  });

  it("writeOperationReportFile returns null when --no-report", () => {
    const ctx = createOperationReportContext({
      clumpId: "pi-hole",
      clumpTitle: "Pi-hole",
      verb: "deploy",
      argv: ["--no-report"],
    });
    const written = writeOperationReportFile({
      clumpRoot: "/tmp/pkg",
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
        clumpId: "pi-hole",
        clumpTitle: "Pi-hole DNS filtering",
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
      const pkgRoot = join(tmp, "clumps", "services", "pi-hole");
      mkdirSync(join(pkgRoot, "reports"), { recursive: true });
      const written = writeOperationReportFile({
        clumpRoot: pkgRoot,
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
      clumpId: "bind",
      clumpTitle: "BIND",
      verb: "deploy",
    });
    setStdoutPayload(ctx, {
      results: [{ ok: true, system_id: "vm-bind-a", ip: "192.0.2.10" }],
    });
    const steps = defaultNextSteps(ctx);
    expect(steps.some((s) => s.includes("run bind query"))).toBe(true);
    expect(steps.some((s) => s.includes("vm-bind-a.json"))).toBe(true);
  });

  it("manifestOperationReportNextSteps reads operation_report.next_steps", () => {
    const steps = manifestOperationReportNextSteps({
      operation_report: { next_steps: ["Step A", "  ", 1] },
    });
    expect(steps).toEqual(["Step A"]);
  });

  it("renderOperationReportMarkdown includes Guest baseline on maintain when payload has admin_user", () => {
    const ctx = createOperationReportContext({
      clumpId: "bind",
      clumpTitle: "BIND",
      verb: "maintain",
    });
    setStdoutPayload(ctx, {
      ok: true,
      results: [
        {
          ok: true,
          system_id: "vm-bind-a",
          role: "primary",
          hdc_user: { ok: true, username: "hdc", message: "ensured" },
          admin_user: { ok: true, username: "dukk", message: "ensured" },
          clamav: { ok: true, skipped: true, message: "skipped by flag" },
          root_login_disabled: { ok: true, message: "root locked; PermitRootLogin no" },
        },
      ],
    });
    ctx.ok = true;
    const md = renderOperationReportMarkdown(ctx);
    expect(md).toContain("## Guest baseline");
    expect(md).toContain("**hdc_user:** hdc — ensured");
    expect(md).toContain("**admin_user:** dukk — ensured");
    expect(md).toContain("**clamav:** skipped");
    expect(md).toContain("**root_login_disabled:** root locked");
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
