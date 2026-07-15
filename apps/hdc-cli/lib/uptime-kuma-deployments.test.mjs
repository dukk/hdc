import { describe, expect, it } from "vitest";

import {
  resolveDeploymentConfigSlice,
  normalizeUptimeKumaConfig,
  instanceFlagToSystemId,
} from "hdc/clump/services/uptime-kuma/lib/deployments.mjs";
import { buildNotificationIdList } from "hdc/clump/services/uptime-kuma/lib/uptime-kuma-notifications-sync.mjs";

describe("uptime-kuma per-deployment config", () => {
  it("inherits root monitors when deployment has no monitors override", () => {
    const cfg = normalizeUptimeKumaConfig({
      schema_version: 5,
      deployments: [{ system_id: "uptime-kuma-a", proxmox: { host_id: "pve-a", lxc: { vmid: 1 } } }],
      monitors: [{ id: "a", name: "A", type: "http", url: "https://a", managed: true }],
    });
    const slice = resolveDeploymentConfigSlice(
      { monitors: [{ id: "a", name: "A", type: "http", url: "https://a", managed: true }] },
      cfg.deployments[0],
    );
    expect(slice.monitors).toHaveLength(1);
  });

  it("replaces monitors when deployment defines monitors", () => {
    const slice = resolveDeploymentConfigSlice(
      {
        monitors: [{ id: "internal", name: "I", type: "http", url: "https://i", managed: true }],
        deployments: [],
      },
      {
        system_id: "uptime-kuma-ext-a",
        monitors: [{ id: "public", name: "P", type: "http", url: "https://p", managed: true }],
      },
    );
    expect(slice.monitors).toHaveLength(1);
    expect(/** @type {Record<string, unknown>} */ (slice.monitors[0]).id).toBe("public");
  });

  it("accepts uptime-kuma-ext-a system_id", () => {
    const cfg = normalizeUptimeKumaConfig({
      schema_version: 5,
      deployments: [
        {
          system_id: "uptime-kuma-ext-a",
          mode: "oci-vm",
          oci: { instance_id: "uptime-kuma-ext-a" },
        },
      ],
    });
    expect(cfg.deployments[0].system_id).toBe("uptime-kuma-ext-a");
  });

  it("maps --instance ext-a to uptime-kuma-ext-a", () => {
    expect(instanceFlagToSystemId("ext-a")).toBe("uptime-kuma-ext-a");
    expect(instanceFlagToSystemId("uptime-kuma-ext-a")).toBe("uptime-kuma-ext-a");
    expect(instanceFlagToSystemId("a")).toBe("uptime-kuma-a");
  });

  it("builds notificationIDList from apply_to_monitors", () => {
    const list = buildNotificationIdList(
      [{ id: "discord", name: "D", type: "discord", managed: true, apply_to_monitors: true, discord_webhook_vault_key: "K", discord_username: null, discord_prefix_message: null }],
      new Map([["discord", 3]]),
      undefined,
    );
    expect(list).toEqual({ 3: true });
  });
});
