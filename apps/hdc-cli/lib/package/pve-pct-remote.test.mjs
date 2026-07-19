import { describe, expect, it } from "vitest";

import {
  parseQmGuestExecStdout,
  resolveSshCommandTimeoutMs,
  SSH_DEFAULT_COMMAND_TIMEOUT_MS,
} from "./pve-pct-remote.mjs";
import {
  PVE_HTTP_DEFAULT_TIMEOUT_MS,
  resolvePveHttpTimeoutMs,
} from "hdc/clump/infrastructure/proxmox/lib/pve-http.mjs";

describe("resolveSshCommandTimeoutMs", () => {
  it("defaults to 30 minutes", () => {
    expect(resolveSshCommandTimeoutMs(undefined, {})).toBe(SSH_DEFAULT_COMMAND_TIMEOUT_MS);
    expect(SSH_DEFAULT_COMMAND_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("prefers opts.timeoutMs over env", () => {
    expect(
      resolveSshCommandTimeoutMs({ timeoutMs: 5000 }, { HDC_SSH_COMMAND_TIMEOUT_MS: "9000" }),
    ).toBe(5000);
  });

  it("uses HDC_SSH_COMMAND_TIMEOUT_MS when opts missing", () => {
    expect(resolveSshCommandTimeoutMs({}, { HDC_SSH_COMMAND_TIMEOUT_MS: "9000" })).toBe(9000);
  });

  it("ignores invalid values", () => {
    expect(resolveSshCommandTimeoutMs({ timeoutMs: -1 }, { HDC_SSH_COMMAND_TIMEOUT_MS: "x" })).toBe(
      SSH_DEFAULT_COMMAND_TIMEOUT_MS,
    );
  });
});

describe("resolvePveHttpTimeoutMs", () => {
  it("defaults to 120 seconds", () => {
    expect(resolvePveHttpTimeoutMs(undefined, {})).toBe(PVE_HTTP_DEFAULT_TIMEOUT_MS);
    expect(PVE_HTTP_DEFAULT_TIMEOUT_MS).toBe(120_000);
  });

  it("prefers opts then env", () => {
    expect(resolvePveHttpTimeoutMs({ timeoutMs: 1500 }, { HDC_PVE_HTTP_TIMEOUT_MS: "2500" })).toBe(1500);
    expect(resolvePveHttpTimeoutMs({}, { HDC_PVE_HTTP_TIMEOUT_MS: "2500" })).toBe(2500);
  });
});

describe("parseQmGuestExecStdout", () => {
  it("parses guest exec JSON", () => {
    const r = parseQmGuestExecStdout('{"exitcode":0,"out-data":"hi"}');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("hi");
  });

  it("passes through non-JSON output", () => {
    const r = parseQmGuestExecStdout("plain");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("plain");
  });
});
