import { describe, expect, it } from "vitest";

import {
  apiPasswordVaultKey,
  apiUsernameVaultKey,
  flattenNodesPayload,
  meshAuthHeader,
  publicUrlToControlWss,
  resolveMeshcentralControlUrl,
} from "../../../clumps/services/meshcentral/lib/meshcentral-api.mjs";
import {
  inferPlatformFromNode,
  normalizeLiveDevice,
  parseDeviceSelectors,
  resolveDevices,
  slugDeviceId,
} from "../../../clumps/services/meshcentral/lib/meshcentral-devices.mjs";
import { mergeDevicesFromLive, applyDevicesToConfig } from "../../../clumps/services/meshcentral/lib/meshcentral-inventory.mjs";
import {
  diskCommand,
  extractJsonPayload,
  hardwareCommand,
  installCommand,
  normalizeHardwareMac,
  parseHardwareOutput,
  removeCommand,
  updatesCommand,
} from "../../../clumps/services/meshcentral/lib/meshcentral-ops.mjs";
import { normalizePowerAction } from "../../../clumps/services/meshcentral/lib/meshcentral-power.mjs";
import {
  allocateDeviceId,
  matchClientHostId,
  mergeSystemSidecar,
  preferClientDeviceId,
} from "../../../clumps/services/meshcentral/lib/meshcentral-system-inventory.mjs";

describe("meshcentral-api helpers", () => {
  it("builds control.ashx wss url from public_url", () => {
    expect(publicUrlToControlWss("https://meshcentral.example.invalid/")).toBe(
      "wss://meshcentral.example.invalid/control.ashx",
    );
    expect(
      resolveMeshcentralControlUrl({
        public_url: "https://meshcentral.example.invalid",
        api: { url: null },
      }),
    ).toBe("wss://meshcentral.example.invalid/control.ashx");
    expect(
      resolveMeshcentralControlUrl({
        public_url: "https://meshcentral.example.invalid",
        api: { url: "wss://other.example/control.ashx" },
      }),
    ).toBe("wss://other.example/control.ashx");
  });

  it("builds x-meshauth header", () => {
    expect(meshAuthHeader("admin", "secret")).toBe(
      `${Buffer.from("admin").toString("base64")},${Buffer.from("secret").toString("base64")}`,
    );
  });

  it("defaults api username/password vault keys", () => {
    expect(apiUsernameVaultKey({})).toBe("HDC_MESHCENTRAL_USERNAME");
    expect(apiPasswordVaultKey({})).toBe("HDC_MESHCENTRAL_PASSWORD");
    expect(apiUsernameVaultKey({ api: { username_vault_key: "HDC_OTHER_USER" } })).toBe(
      "HDC_OTHER_USER",
    );
    expect(apiPasswordVaultKey({ api: { password_vault_key: "HDC_OTHER_PASS" } })).toBe(
      "HDC_OTHER_PASS",
    );
  });

  it("flattens nodes payload", () => {
    const flat = flattenNodesPayload({
      "mesh//g1": [
        { _id: "node//a", name: "lan-1", conn: 1, pwr: 1, osdesc: "Windows 11" },
        { _id: "node//b", name: "pi", conn: 0, pwr: 0, osdesc: "Linux" },
      ],
    });
    expect(flat).toHaveLength(2);
    expect(flat[0].meshid).toBe("mesh//g1");
  });
});

describe("meshcentral-devices", () => {
  it("infers platform and normalizes nodes", () => {
    expect(inferPlatformFromNode({ osdesc: "Windows 11 Pro" })).toBe("windows");
    expect(inferPlatformFromNode({ osdesc: "Ubuntu 22.04" })).toBe("linux");
    const n = normalizeLiveDevice({
      _id: "node//xyz",
      name: "LAN-1",
      conn: 1,
      pwr: 1,
      host: "192.0.2.50",
      osdesc: "Windows 11",
    });
    expect(n).toMatchObject({
      node_id: "node//xyz",
      name: "LAN-1",
      online: true,
      platform: "windows",
      ip: "192.0.2.50",
    });
  });

  it("resolves devices by id/name/node_id", () => {
    const live = [
      normalizeLiveDevice({
        _id: "node//abc",
        name: "lan-1",
        conn: 1,
        pwr: 1,
        osdesc: "Windows",
      }),
    ];
    const config = [{ id: "lan-1", name: "lan-1", node_id: "node//abc", platform: "windows", managed: true }];
    const byId = resolveDevices({ liveDevices: live, configDevices: config, selectors: ["lan-1"] });
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(byId.devices[0].node_id).toBe("node//abc");
    const missing = resolveDevices({ liveDevices: live, configDevices: config, selectors: ["nope"] });
    expect(missing.ok).toBe(false);
  });

  it("parses device selectors", () => {
    expect(parseDeviceSelectors({ device: "a,b" }, [])).toEqual(["a", "b"]);
    expect(parseDeviceSelectors({ device: "a" }, ["--device", "a", "--device", "c"])).toEqual([
      "a",
      "c",
    ]);
    expect(slugDeviceId("My PC!")).toBe("my-pc");
  });
});

describe("meshcentral-inventory", () => {
  it("merges live nodes preserving managed ids", () => {
    const existing = {
      devices: [{ id: "lan-1", name: "lan-1", node_id: "old", platform: "windows", managed: true }],
    };
    const live = [
      { _id: "node//new", name: "lan-1", conn: 1, pwr: 1, osdesc: "Windows 11" },
      { _id: "node//pi", name: "pi-lab", conn: 1, pwr: 1, osdesc: "Linux" },
    ];
    const merged = mergeDevicesFromLive(existing, live);
    expect(merged.find((d) => d.id === "lan-1")?.node_id).toBe("node//new");
    expect(merged.find((d) => d.name === "pi-lab")?.platform).toBe("linux");
    const cfg = applyDevicesToConfig({ schema_version: 2, defaults: {}, deployments: [] }, merged);
    expect(cfg.defaults.meshcentral.devices).toHaveLength(2);
  });

  it("prefers client host id by IP when devices[] empty", () => {
    const clientHosts = [
      {
        id: "dukk-lap",
        system_id: "dukk-lap",
        access: { nodes: [{ name: "primary", ip: "10.1.0.10" }] },
      },
    ];
    const merged = mergeDevicesFromLive(
      { devices: [] },
      [{ _id: "node//x", name: "DESKTOP-ABC", host: "10.1.0.10", conn: 1, osdesc: "Windows 11" }],
      { clientHosts },
    );
    expect(merged[0]?.id).toBe("dukk-lap");
  });
});

describe("meshcentral-ops commands", () => {
  it("builds OS-specific commands", () => {
    expect(diskCommand("windows")).toContain("Win32_LogicalDisk");
    expect(diskCommand("linux")).toContain("df -hP");
    expect(hardwareCommand("windows")).toContain("Win32_ComputerSystem");
    expect(hardwareCommand("windows")).toContain("nvidia-smi");
    expect(hardwareCommand("windows")).toContain("Win32_VideoController");
    expect(hardwareCommand("linux")).toContain("python3");
    expect(hardwareCommand("linux")).toContain("nvidia-smi");
    expect(hardwareCommand("linux")).toContain("lspci");
    expect(updatesCommand("linux")).toContain("apt-get dist-upgrade");
    expect(installCommand("windows", "Git.Git")).toContain("winget install");
    expect(installCommand("linux", "curl")).toContain("apt-get install");
    expect(removeCommand("linux", "curl")).toContain("apt-get remove");
  });

  it("parses hardware JSON and normalizes MAC", () => {
    expect(normalizeHardwareMac("84-5C-31-A6-B7-9C")).toBe("84:5c:31:a6:b7:9c");
    expect(normalizeHardwareMac("00:00:00:00:00:00")).toBeNull();
    const bannered =
      'Noise\n{"manufacturer":"Dell","model":"XPS","serial":"ABC","cpu_model":"Intel","logical_cores":8,"memory_gb":16.5,"mac":"AA:BB:CC:DD:EE:FF","disks":[{"device":"C:","size_gb":512,"free_gb":100}],"gpus":[{"name":"NVIDIA RTX 4070","vram_mb":12282}]}\n';
    expect(extractJsonPayload(bannered)).toMatchObject({ manufacturer: "Dell" });
    const parsed = parseHardwareOutput(bannered);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.mac).toBe("aa:bb:cc:dd:ee:ff");
    expect(parsed.hardware.find((h) => h.type === "system")).toMatchObject({
      manufacturer: "Dell",
      model: "XPS",
    });
    expect(parsed.hardware.find((h) => h.type === "cpu")).toMatchObject({
      model: "Intel",
      logical_cores: 8,
    });
    expect(parsed.hardware.find((h) => h.type === "memory")).toMatchObject({ total_gb: 16.5 });
    expect(parsed.hardware.find((h) => h.type === "gpu")).toMatchObject({
      model: "NVIDIA RTX 4070",
      vram_mb: 12282,
    });
    expect(parsed.hardware.find((h) => h.type === "disk")).toMatchObject({
      device: "C:",
      size_gb: 512,
    });
  });
});

describe("meshcentral-system-inventory", () => {
  const hosts = [
    {
      id: "lan-1",
      system_id: "lan-1",
      access: { nodes: [{ ip: "10.1.1.11", mac: "00:11:22:33:44:55" }] },
    },
    {
      id: "dukk-lap",
      system_id: "dukk-lap",
      access: { nodes: [{ ip: "10.1.0.10" }] },
    },
  ];

  it("matches client hosts by name and IP", () => {
    expect(matchClientHostId({ name: "LAN-1", ip: null }, hosts)).toBe("lan-1");
    expect(matchClientHostId({ name: "other", ip: "10.1.0.10" }, hosts)).toBe("dukk-lap");
    expect(matchClientHostId({ name: "nope", ip: "9.9.9.9" }, hosts)).toBeNull();
    expect(preferClientDeviceId(hosts, { name: "x", ip: "10.1.1.11" }, "x")).toBe("lan-1");
  });

  it("allocates ids preferring prior devices then client hosts", () => {
    const used = new Set(["lan-1"]);
    expect(
      allocateDeviceId({
        prev: { id: "lan-1" },
        live: { name: "lan-1" },
        clientHosts: hosts,
        usedHdcIds: used,
      }),
    ).toBe("lan-1");
    expect(
      allocateDeviceId({
        prev: null,
        live: { name: "DESKTOP", ip: "10.1.0.10" },
        clientHosts: hosts,
        usedHdcIds: new Set(),
      }),
    ).toBe("dukk-lap");
  });

  it("merges sidecars without clobbering notes/auth/services", () => {
    const existing = {
      schema_version: 1,
      id: "lan-1",
      kind: "system",
      system_class: "physical",
      notes: "keep me",
      auth: { winrm_user_env: "HDC_WINRM_USER" },
      services: [{ id: "something" }],
      tags: ["windows"],
      access: {
        nodes: [{ name: "primary", ip: "10.1.1.11", mac: "00:11:22:33:44:55" }],
      },
      hardware: [{ type: "cpu", model: "old" }],
    };
    const merged = mergeSystemSidecar({
      existing,
      id: "lan-1",
      live: {
        node_id: "node//1",
        name: "lan-1",
        ip: "10.1.1.99",
        platform: "windows",
        osdesc: "Windows 11",
        online: true,
      },
      hardware: [
        { type: "system", manufacturer: "Dell" },
        { type: "cpu", model: "new", logical_cores: 8 },
      ],
      mac: "aa:bb:cc:dd:ee:ff",
      collectedAt: "2026-07-12T00:00:00.000Z",
    });
    expect(merged.notes).toBe("keep me");
    expect(merged.auth).toEqual({ winrm_user_env: "HDC_WINRM_USER" });
    expect(merged.services).toEqual([{ id: "something" }]);
    expect(merged.tags).toEqual(expect.arrayContaining(["windows", "client", "meshcentral"]));
    expect(merged.access.nodes[0].ip).toBe("10.1.1.99");
    expect(merged.access.nodes[0].mac).toBe("aa:bb:cc:dd:ee:ff");
    expect(merged.hardware.find((h) => h.type === "cpu")?.model).toBe("new");
    expect(merged.query_last).toMatchObject({
      source: "meshcentral",
      node_id: "node//1",
      online: true,
    });
  });

  it("does not clear mac or hardware when collect fails", () => {
    const existing = {
      schema_version: 1,
      id: "lan-1",
      kind: "system",
      access: { nodes: [{ name: "primary", mac: "11:22:33:44:55:66", ip: "192.0.2.1" }] },
      hardware: [{ type: "memory", total_gb: 8 }],
    };
    const merged = mergeSystemSidecar({
      existing,
      id: "lan-1",
      live: {
        name: "lan-1",
        online: false,
        platform: "windows",
        osdesc: null,
        node_id: "n",
        ip: null,
      },
      hardware: null,
      mac: null,
    });
    expect(merged.access.nodes[0].mac).toBe("11:22:33:44:55:66");
    expect(merged.access.nodes[0].ip).toBe("192.0.2.1");
    expect(merged.hardware).toEqual([{ type: "memory", total_gb: 8 }]);
  });
});

describe("meshcentral-power", () => {
  it("normalizes power actions", () => {
    expect(normalizePowerAction("on")).toBe("wake");
    expect(normalizePowerAction("OFF")).toBe("off");
    expect(() => normalizePowerAction("hibernate")).toThrow(/invalid/);
  });
});
