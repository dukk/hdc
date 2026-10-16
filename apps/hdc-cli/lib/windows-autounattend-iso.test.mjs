import { describe, expect, it, vi } from "vitest";
import * as ssh from "hdc/cli/lib/ssh-host-access.mjs";
import { buildAndUploadAutounattendIso } from "hdc/clump/services/windows-desktop/lib/autounattend-iso.mjs";
import { pressKeyToBootFromCdCommand, removeCachedUnattendCommand } from "hdc/clump/services/windows-desktop/lib/proxmox-windows-vm.mjs";

vi.mock("hdc/cli/lib/ssh-host-access.mjs", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, sshBashLc: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })) };
});

describe("autounattend ISO", () => {
  it("stages the answer file as autounattend.xml at the media root, unescaped", async () => {
    const bs = String.fromCharCode(92); const xml = "<Path value=\"D:" + bs + "vioscsi" + bs + "w11\" var=\"$x\" />";
    await buildAndUploadAutounattendIso({
      sshTarget: { id: "pve-a" },
      xml,
      isoStorage: "local",
      basename: "hdc-t-autounattend.iso",
      spawnSync: () => ({}),
      env: {},
      identities: [],
    });
    const calls = vi.mocked(ssh.sshBashLc).mock.calls;
    const script = String(calls[0][1]);
    expect(script).toContain("/tmp/hdc-t-autounattend.iso.d/autounattend.xml");
    expect(script).toContain("-J -r '/tmp/hdc-t-autounattend.iso.d'");
    expect(script).toContain(xml);
  });
});

describe("pressKeyToBootFromCdCommand", () => {
  it("loops sendkey on the host", () => {
    expect(pressKeyToBootFromCdCommand(9001, 60, 500)).toBe(
      "for i in $(seq 1 60); do qm sendkey 9001 ret >/dev/null 2>&1; sleep 0.50; done",
    );
  });
});

describe("removeCachedUnattendCommand", () => {
  it("deletes Panther answer files with forward-slash paths (no backslash quoting)", () => {
    const cmd = removeCachedUnattendCommand(9001);
    expect(cmd).toContain("qm guest exec 9001 -- powershell.exe");
    expect(cmd).toContain("C:/Windows/Panther/unattend.xml");
    expect(cmd).not.toContain(String.fromCharCode(92));
  });
});