import { describe, expect, it, vi } from "vitest";

import {
  APP_DUMP_DEFAULT_RETAIN_DAYS,
  appDumpOutputDir,
  appDumpScriptPath,
  appDumpSkippedByFlags,
  buildAppDumpInstallScript,
  buildAppDumpScript,
  buildAppDumpSystemdUnits,
  ensureAppDumpSchedule,
  postgresqlDumpCommands,
  vaultwardenDumpCommands,
} from "./app-dump-schedule.mjs";

const SPEC = {
  systemId: "vm-postgres-a",
  name: "postgresql",
  dumpCommands: postgresqlDumpCommands(),
};

describe("appDumpSkippedByFlags", () => {
  it("skips only when --skip-app-dump is present", () => {
    expect(appDumpSkippedByFlags({})).toBe(false);
    expect(appDumpSkippedByFlags({ "skip-app-dump": "1" })).toBe(true);
    expect(appDumpSkippedByFlags(undefined)).toBe(false);
  });
});

describe("buildAppDumpScript", () => {
  it("writes to /var/backups/hdc/<name> and prunes with default retention", () => {
    const script = buildAppDumpScript(SPEC);
    expect(script).toContain(`OUT='${appDumpOutputDir("postgresql")}'`);
    expect(script).toContain("pg_dumpall");
    expect(script).toContain(`-mtime +${APP_DUMP_DEFAULT_RETAIN_DAYS - 1} -delete`);
    expect(script).toContain("set -euo pipefail");
  });

  it("honors custom retainDays", () => {
    const script = buildAppDumpScript({ ...SPEC, retainDays: 14 });
    expect(script).toContain("-mtime +13 -delete");
  });
});

describe("buildAppDumpSystemdUnits", () => {
  it("builds staggered daily timer + oneshot service", () => {
    const units = buildAppDumpSystemdUnits(SPEC);
    expect(units.name).toBe("hdc-dump-postgresql");
    expect(units.scriptPath).toBe(appDumpScriptPath("postgresql"));
    expect(units.serviceUnit).toContain(`ExecStart=${units.scriptPath}`);
    expect(units.serviceUnit).toContain("Type=oneshot");
    expect(units.timerUnit).toContain(`OnCalendar=${units.onCalendar}`);
    expect(units.timerUnit).toContain("Persistent=true");
    expect(units.onCalendar).toMatch(/^\*-\*-\* \d{2}:\d{2}:00$/);
  });

  it("staggers differently than the ClamAV scan for the same system", () => {
    const a = buildAppDumpSystemdUnits(SPEC);
    const b = buildAppDumpSystemdUnits({ ...SPEC, systemId: "vaultwarden-a" });
    // deterministic per system id
    expect(buildAppDumpSystemdUnits(SPEC).onCalendar).toBe(a.onCalendar);
    expect(a.onCalendar).not.toBe(b.onCalendar);
  });
});

describe("buildAppDumpInstallScript", () => {
  it("writes script + units and enables the timer", () => {
    const script = buildAppDumpInstallScript(SPEC);
    expect(script).toContain("cat > '/usr/local/sbin/hdc-dump-postgresql'");
    expect(script).toContain("chmod 750 '/usr/local/sbin/hdc-dump-postgresql'");
    expect(script).toContain("cat > '/etc/systemd/system/hdc-dump-postgresql.service'");
    expect(script).toContain("cat > '/etc/systemd/system/hdc-dump-postgresql.timer'");
    expect(script).toContain("systemctl enable --now 'hdc-dump-postgresql.timer'");
  });
});

describe("dump command builders", () => {
  it("postgresql uses pg_dumpall as postgres with gzip", () => {
    const cmds = postgresqlDumpCommands();
    expect(cmds.join("\n")).toContain("sudo -u postgres pg_dumpall | gzip");
  });

  it("vaultwarden backs up sqlite read-only and tars data without live db files", () => {
    const joined = vaultwardenDumpCommands().join("\n");
    expect(joined).toContain("docker volume inspect");
    expect(joined).toContain("vaultwarden_vaultwarden-data");
    expect(joined).toContain('mode=ro');
    expect(joined).toContain(".backup");
    expect(joined).toContain("--exclude=./db.sqlite3-wal");
    expect(vaultwardenDumpCommands("custom-vol").join("\n")).toContain("custom-vol");
  });
});

describe("ensureAppDumpSchedule", () => {
  const log = { info: vi.fn(), warn: vi.fn() };

  it("skips with --skip-app-dump without exec", () => {
    const exec = { label: "test", run: vi.fn() };
    const r = ensureAppDumpSchedule({ exec, log, flags: { "skip-app-dump": "1" }, spec: SPEC });
    expect(r).toEqual({ ok: true, skipped: true, message: "skipped by flag" });
    expect(exec.run).not.toHaveBeenCalled();
  });

  it("pushes install script and reports schedule on success", () => {
    const exec = {
      label: "test",
      run: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
    };
    const r = ensureAppDumpSchedule({ exec, log, flags: {}, spec: SPEC });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(false);
    expect(r.output_dir).toBe("/var/backups/hdc/postgresql");
    expect(r.on_calendar).toMatch(/^\*-\*-\* \d{2}:\d{2}:00$/);
    expect(exec.run).toHaveBeenCalledOnce();
    const script = /** @type {string} */ (exec.run.mock.calls[0][0]);
    expect(script).toContain("hdc-dump-postgresql.timer");
  });

  it("reports failure when the guest script fails", () => {
    const exec = {
      label: "test",
      run: vi.fn(() => ({ status: 1, stdout: "", stderr: "boom" })),
    };
    const r = ensureAppDumpSchedule({ exec, log, flags: {}, spec: SPEC });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("boom");
  });
});
