import { beforeEach, describe, expect, it, vi } from "vitest";

const { pveJsonRequest, waitForPveTask } = vi.hoisted(() => ({
  pveJsonRequest: vi.fn(),
  waitForPveTask: vi.fn(),
}));

vi.mock("../../../clumps/infrastructure/proxmox/lib/pve-http.mjs", () => ({
  pveData: (body) => (body && typeof body === "object" && "data" in body ? body.data : body),
  pveFormBody: (fields) => new URLSearchParams(fields).toString(),
  pveJsonRequest,
  waitForPveTask,
}));

import {
  stopAndDestroyLxc,
  stopAndDestroyQemu,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-destroy.mjs";

describe("proxmox-guest-destroy", () => {
  const baseOpts = {
    apiBase: "https://192.0.2.1:8006",
    authorization: "PVEAPIToken=x",
    rejectUnauthorized: true,
    node: "hypervisor-a",
    vmid: 470,
    log: () => {},
  };

  beforeEach(() => {
    pveJsonRequest.mockReset();
    waitForPveTask.mockReset();
    pveJsonRequest.mockResolvedValue({ data: "UPID:hypervisor-a:000:stop" });
    waitForPveTask.mockResolvedValue(undefined);
  });

  it("stopAndDestroyLxc stops then deletes", async () => {
    await stopAndDestroyLxc(baseOpts);
    expect(pveJsonRequest).toHaveBeenCalledTimes(2);
    expect(pveJsonRequest.mock.calls[0][2]).toContain("/lxc/470/status/stop");
    expect(pveJsonRequest.mock.calls[1][0]).toBe("DELETE");
    expect(pveJsonRequest.mock.calls[1][2]).toContain("/lxc/470");
    expect(waitForPveTask).toHaveBeenCalledOnce();
  });

  it("stopAndDestroyQemu stops then deletes", async () => {
    await stopAndDestroyQemu({ ...baseOpts, vmid: 200 });
    expect(pveJsonRequest).toHaveBeenCalledTimes(2);
    expect(pveJsonRequest.mock.calls[0][2]).toContain("/qemu/200/status/stop");
    expect(pveJsonRequest.mock.calls[1][0]).toBe("DELETE");
    expect(pveJsonRequest.mock.calls[1][2]).toContain("/qemu/200");
  });

  it("stopAndDestroyLxc still deletes when stop fails", async () => {
    pveJsonRequest.mockImplementationOnce(async () => {
      throw new Error("stop failed");
    });
    pveJsonRequest.mockResolvedValueOnce(undefined);
    await stopAndDestroyLxc(baseOpts);
    expect(pveJsonRequest).toHaveBeenCalledTimes(2);
    expect(pveJsonRequest.mock.calls[1][0]).toBe("DELETE");
  });
});
