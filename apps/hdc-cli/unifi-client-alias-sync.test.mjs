import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isProxmoxGuestSystem,
  liveClientFromRow,
  loadProxmoxGuestDesired,
  mergeLiveClients,
  nameNeedsAlias,
  normalizeMac,
  planClientAliasSync,
} from "hdc/clump/infrastructure/unifi-network/lib/unifi-client-alias-sync.mjs";
import { normalizeClientAliasesConfig, normalizeUnifiConfig } from "hdc/clump/infrastructure/unifi-network/lib/unifi-config.mjs";

describe("nameNeedsAlias", () => {
  it("treats empty and MAC-equal names as needing alias", () => {
    expect(nameNeedsAlias("", "bc:24:11:9d:7d:a9")).toBe(true);
    expect(nameNeedsAlias("bc:24:11:9d:7d:a9", "bc:24:11:9d:7d:a9")).toBe(true);
    expect(nameNeedsAlias("BC-24-11-9D-7D-A9", "bc:24:11:9d:7d:a9")).toBe(true);
    expect(nameNeedsAlias("open-webui-a", "bc:24:11:9d:7d:a9")).toBe(false);
  });
});

describe("normalizeMac", () => {
  it("lowercases and normalizes separators", () => {
    expect(normalizeMac("BC-24-11-9D-7D-A9")).toBe("bc:24:11:9d:7d:a9");
  });
});

describe("isProxmoxGuestSystem", () => {
  it("requires virtual + hosted_on pve-*", () => {
    expect(
      isProxmoxGuestSystem({
        kind: "system",
        system_class: "virtual",
        hosted_on_system_id: "pve-a",
      }),
    ).toBe(true);
    expect(
      isProxmoxGuestSystem({
        kind: "system",
        system_class: "physical",
        hosted_on_system_id: "pve-a",
      }),
    ).toBe(false);
    expect(
      isProxmoxGuestSystem({
        kind: "system",
        system_class: "virtual",
        hosted_on_system_id: "nas-a",
      }),
    ).toBe(false);
  });
});

describe("planClientAliasSync", () => {
  it("plans rename when IP matches and name differs", () => {
    const byIp = new Map([
      ["10.0.0.21", { systemId: "open-webui-a", ip: "10.0.0.21" }],
      ["10.0.0.25", { systemId: "vm-vllm-a", ip: "10.0.0.25" }],
    ]);
    const byMac = new Map();
    const live = [
      liveClientFromRow({
        mac: "bc:24:11:9d:7d:a9",
        ip: "10.0.0.21",
        name: "bc:24:11:9d:7d:a9",
        _id: "uid-1",
      }),
      liveClientFromRow({
        mac: "bc:24:11:ec:d8:83",
        ip: "10.0.0.25",
        name: "vm-vllm-a",
        _id: "uid-2",
      }),
    ].filter(Boolean);

    const plan = planClientAliasSync(byIp, byMac, live);
    expect(plan.summary.update).toBe(1);
    expect(plan.summary.unchanged).toBe(1);
    expect(plan.update[0].systemId).toBe("open-webui-a");
    expect(plan.update[0].mac).toBe("bc:24:11:9d:7d:a9");
    expect(plan.unchanged[0].systemId).toBe("vm-vllm-a");
  });

  it("skips ambiguous IP and missing clients", () => {
    const byIp = new Map([
      ["10.0.0.21", { systemId: "open-webui-a", ip: "10.0.0.21" }],
      ["10.0.0.99", { systemId: "missing-a", ip: "10.0.0.99" }],
    ]);
    const live = [
      { mac: "aa:bb:cc:dd:ee:01", ip: "10.0.0.21", name: "x", unifiId: "1" },
      { mac: "aa:bb:cc:dd:ee:02", ip: "10.0.0.21", name: "y", unifiId: "2" },
    ];
    const plan = planClientAliasSync(byIp, new Map(), live);
    expect(plan.summary.update).toBe(0);
    expect(plan.skipped.some((s) => s.reason.includes("ambiguous"))).toBe(true);
    expect(plan.skipped.some((s) => s.systemId === "missing-a")).toBe(true);
  });

  it("matches by MAC when IP map missed the guest", () => {
    const byIp = new Map();
    const byMac = new Map([["bc:24:11:93:59:c1", { systemId: "vm-vllm-b", mac: "bc:24:11:93:59:c1" }]]);
    const live = [{ mac: "bc:24:11:93:59:c1", ip: "10.0.0.26", name: "", unifiId: "uid-b" }];
    const plan = planClientAliasSync(byIp, byMac, live);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].systemId).toBe("vm-vllm-b");
  });
});

describe("mergeLiveClients", () => {
  it("merges user and station rows by MAC", () => {
    const merged = mergeLiveClients(
      [{ mac: "aa:bb:cc:dd:ee:ff", name: "old", _id: "u1" }],
      [{ mac: "aa:bb:cc:dd:ee:ff", ip: "10.0.0.21", hostname: "host" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].unifiId).toBe("u1");
    expect(merged[0].ip).toBe("10.0.0.21");
  });
});

describe("loadProxmoxGuestDesired", () => {
  it("loads virtual pve guests from private inventory", () => {
    const publicRoot = mkdtempSync(join(tmpdir(), "hdc-pub-"));
    const privateRoot = mkdtempSync(join(tmpdir(), "hdc-priv-"));
    try {
      const sysDir = join(privateRoot, "operations/inventory/systems");
      mkdirSync(join(sysDir, "virtual"), { recursive: true });
      mkdirSync(join(sysDir, "physical"), { recursive: true });
      writeFileSync(
        join(sysDir, "virtual", "open-webui-a.json"),
        JSON.stringify({
          id: "open-webui-a",
          kind: "system",
          system_class: "virtual",
          hosted_on_system_id: "pve-a",
          access: { nodes: [{ ip: "10.0.0.21" }] },
        }),
      );
      writeFileSync(
        join(sysDir, "physical", "pve-a.json"),
        JSON.stringify({
          id: "pve-a",
          kind: "system",
          system_class: "physical",
          access: { nodes: [{ ip: "10.0.0.11" }] },
        }),
      );
      writeFileSync(
        join(sysDir, "physical", "lan-1.json"),
        JSON.stringify({
          id: "lan-1",
          kind: "system",
          system_class: "physical",
          access: { nodes: [{ ip: "10.0.0.50", mac: "d8:5e:d3:84:26:fa" }] },
        }),
      );

      const env = { HDC_PRIVATE_ROOT: privateRoot };
      const desired = loadProxmoxGuestDesired(publicRoot, env);
      expect(desired.byIp.get("10.0.0.21")?.systemId).toBe("open-webui-a");
      expect(desired.byIp.has("10.0.0.11")).toBe(false);
      expect(desired.guests).toHaveLength(1);
    } finally {
      rmSync(publicRoot, { recursive: true, force: true });
      rmSync(privateRoot, { recursive: true, force: true });
    }
  });
});

describe("normalizeClientAliasesConfig", () => {
  it("defaults disabled; enabled only when true", () => {
    expect(normalizeClientAliasesConfig(undefined).enabled).toBe(false);
    expect(normalizeClientAliasesConfig({ enabled: true }).enabled).toBe(true);
    expect(normalizeClientAliasesConfig({ enabled: false }).enabled).toBe(false);
    const cfg = normalizeUnifiConfig({
      schema_version: 1,
      controller_base_url: "https://example.test",
      client_aliases: { enabled: true },
    });
    expect(cfg.clientAliases.enabled).toBe(true);
  });
});
