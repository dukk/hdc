import { beforeEach, describe, expect, it, vi } from "vitest";

const { pveJsonRequest, waitForPveTask } = vi.hoisted(() => ({
  pveJsonRequest: vi.fn(),
  waitForPveTask: vi.fn(),
}));

vi.mock("hdc/clump/infrastructure/proxmox/lib/pve-http.mjs", () => ({
  pveData: (body) => (body && typeof body === "object" && "data" in body ? body.data : body),
  pveFormBody: (fields) => new URLSearchParams(fields).toString(),
  pveJsonRequest,
  waitForPveTask,
}));

import { ensureLxcStarted, getLxcRuntimeStatus } from "hdc/clump/infrastructure/proxmox/lib/proxmox-lxc-start.mjs";

describe("proxmox-lxc-start", () => {
  const baseOpts = {
    apiBase: "https://192.0.2.1:8006",
    authorization: "PVEAPIToken=x",
    rejectUnauthorized: true,
    node: "hypervisor-d",
    vmid: 470,
    log: () => {},
  };

  beforeEach(() => {
    pveJsonRequest.mockReset();
    waitForPveTask.mockReset();
    waitForPveTask.mockResolvedValue(undefined);
  });

  it("getLxcRuntimeStatus returns status field", async () => {
    pveJsonRequest.mockResolvedValueOnce({ data: { status: "stopped" } });
    await expect(getLxcRuntimeStatus(baseOpts)).resolves.toBe("stopped");
  });

  it("ensureLxcStarted skips POST when already running", async () => {
    pveJsonRequest.mockResolvedValueOnce({ data: { status: "running" } });
    await ensureLxcStarted(baseOpts);
    expect(pveJsonRequest).toHaveBeenCalledOnce();
    expect(waitForPveTask).not.toHaveBeenCalled();
  });

  it("ensureLxcStarted POSTs start when stopped", async () => {
    pveJsonRequest
      .mockResolvedValueOnce({ data: { status: "stopped" } })
      .mockResolvedValueOnce({ data: "UPID:hypervisor-d:001:start:470:root@pam:" })
      .mockResolvedValueOnce({ data: { status: "running" } });
    await ensureLxcStarted(baseOpts);
    expect(pveJsonRequest).toHaveBeenCalledTimes(3);
    expect(pveJsonRequest.mock.calls[1][0]).toBe("POST");
    expect(pveJsonRequest.mock.calls[1][2]).toContain("/status/start");
    expect(waitForPveTask).toHaveBeenCalledOnce();
  });
});
