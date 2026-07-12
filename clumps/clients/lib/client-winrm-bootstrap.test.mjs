import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  buildPsExecBootstrapArgv,
  buildWinRmBootstrapRemoteScript,
  resolvePsExecPath,
  winrmBootstrapDefaultsFromConfig,
} from "./client-winrm-bootstrap.mjs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from "node:fs";

describe("client-winrm-bootstrap", () => {
  describe("winrmBootstrapDefaultsFromConfig", () => {
    it("defaults enabled with 90s wait", () => {
      const d = winrmBootstrapDefaultsFromConfig({});
      expect(d.enabled).toBe(true);
      expect(d.waitSeconds).toBe(90);
      expect(d.pollIntervalSeconds).toBe(5);
      expect(d.psexecPath).toBe("");
    });

    it("respects disabled and custom paths", () => {
      const d = winrmBootstrapDefaultsFromConfig({
        winrm_bootstrap: {
          enabled: false,
          psexec_path: "D:\\Tools\\PsExec.exe",
          wait_seconds: 30,
        },
      });
      expect(d.enabled).toBe(false);
      expect(d.psexecPath).toBe("D:\\Tools\\PsExec.exe");
      expect(d.waitSeconds).toBe(30);
    });
  });

  describe("buildWinRmBootstrapRemoteScript", () => {
    it("configures HTTPS listener and port 5986 firewall", () => {
      const s = buildWinRmBootstrapRemoteScript();
      expect(s).toContain("Enable-PSRemoting");
      expect(s).toContain("Transport=HTTPS");
      expect(s).toContain("LocalPort 5986");
      expect(s).toContain("winrm.cmd");
    });
  });

  describe("buildPsExecBootstrapArgv", () => {
    it("targets host with -s and encoded powershell", () => {
      const argv = buildPsExecBootstrapArgv({
        host: "192.0.2.10",
        psexecPath: "C:\\Tools\\PsExec.exe",
      });
      expect(argv[0]).toBe("\\\\192.0.2.10");
      expect(argv).toContain("-accepteula");
      expect(argv).toContain("-s");
      expect(argv).toContain("powershell.exe");
      expect(argv).toContain("-EncodedCommand");
      const encIdx = argv.indexOf("-EncodedCommand");
      expect(argv[encIdx + 1]).toBeTruthy();
    });
  });

  describe("resolvePsExecPath", () => {
    beforeEach(() => {
      vi.mocked(existsSync).mockReset();
    });

    afterEach(() => {
      vi.mocked(existsSync).mockReset();
    });

    it("prefers config path over env", () => {
      vi.mocked(existsSync).mockImplementation((p) => p === "C:\\cfg\\PsExec.exe");
      const r = resolvePsExecPath(
        winrmBootstrapDefaultsFromConfig({
          winrm_bootstrap: { psexec_path: "C:\\cfg\\PsExec.exe" },
        }),
        { HDC_PSEXEC_PATH: "C:\\env\\PsExec.exe" },
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.path).toBe("C:\\cfg\\PsExec.exe");
    });

    it("returns error when no candidate exists", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const r = resolvePsExecPath(winrmBootstrapDefaultsFromConfig({}), {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("PsExec.exe not found");
    });
  });
});
