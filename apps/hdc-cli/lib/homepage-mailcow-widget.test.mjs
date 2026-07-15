import { describe, expect, it } from "vitest";

import {
  mailcowWidgetEnabled,
  resolveMailcowWidgetCredentials,
} from "../../../clumps/services/homepage/lib/homepage-mailcow-widget.mjs";

describe("homepage mailcow widget", () => {
  it("mailcowWidgetEnabled respects enabled flag", () => {
    expect(mailcowWidgetEnabled({ mailcow_widget: { enabled: true } })).toBe(true);
    expect(mailcowWidgetEnabled({ mailcow_widget: { enabled: false } })).toBe(false);
    expect(mailcowWidgetEnabled({})).toBe(false);
  });

  it("resolveMailcowWidgetCredentials reads api_url and vault key", () => {
    const cfg = {
      schema_version: 2,
      defaults: {
        mode: "proxmox-qemu",
        mailcow: {
          hostname: "mail.example.invalid",
          api_url: "https://10.0.0.62",
          api_key_vault_key: "HDC_MAILCOW_API_KEY",
        },
      },
      deployments: [
        {
          system_id: "vm-mailcow-a",
          mode: "proxmox-qemu",
          proxmox: { host_id: "pve-b", qemu: { vmid: 100, template_vmid: 9024, ip: "10.0.0.62/24" } },
          configure: { ssh: { host: "10.0.0.62" } },
        },
      ],
    };
    expect(resolveMailcowWidgetCredentials(cfg)).toEqual({
      url: "https://10.0.0.62",
      vaultKey: "HDC_MAILCOW_API_KEY",
    });
  });
});
