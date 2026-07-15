import { describe, expect, it } from "vitest";
import {
  buildClamavScanSystemdUnits,
  clamavScanScheduleSkippedByFlags,
} from "hdc/package/clamav-scan-schedule.mjs";
import {
  buildSystemdTimerInstallScript,
  staggerOffsetFromSystemId,
} from "hdc/package/guest-systemd-unit-ensure.mjs";
import {
  buildUnattendedUpgradesConfigSnippet,
  unattendedUpgradesSkippedByFlags,
} from "hdc/package/unattended-upgrades-ensure.mjs";
import {
  crowdsecAgentSkippedByFlags,
} from "hdc/package/crowdsec-agent-ensure.mjs";
import {
  guestAgentsConfigFromProxmox,
  isNagiosGuestSystem,
} from "hdc/package/guest-agents-config.mjs";

describe("guest-systemd-unit-ensure", () => {
  it("staggerOffsetFromSystemId is deterministic", () => {
    const a = staggerOffsetFromSystemId("vaultwarden-a", 1440);
    const b = staggerOffsetFromSystemId("vaultwarden-a", 1440);
    expect(a).toEqual(b);
    expect(a.hour).toBeGreaterThanOrEqual(0);
    expect(a.hour).toBeLessThan(24);
    expect(a.minute).toBeGreaterThanOrEqual(0);
    expect(a.minute).toBeLessThan(60);
  });

  it("buildSystemdTimerInstallScript writes service and timer", () => {
    const script = buildSystemdTimerInstallScript({
      name: "hdc-clamscan",
      serviceUnit: "[Service]\nExecStart=/bin/true\n",
      timerUnit: "[Timer]\nOnCalendar=daily\n",
    });
    expect(script).toContain("hdc-clamscan.service");
    expect(script).toContain("systemctl enable --now 'hdc-clamscan.timer'");
  });
});

describe("clamav-scan-schedule", () => {
  it("honours skip flags", () => {
    expect(clamavScanScheduleSkippedByFlags({ "skip-clamav-scan": "1" })).toBe(true);
    expect(clamavScanScheduleSkippedByFlags({})).toBe(false);
  });

  it("buildClamavScanSystemdUnits includes clamscan paths", () => {
    const units = buildClamavScanSystemdUnits("n8n-a");
    expect(units.serviceUnit).toContain("/home /opt /var");
    expect(units.timerUnit).toContain("OnCalendar=");
  });
});

describe("unattended-upgrades-ensure", () => {
  it("honours skip flags", () => {
    expect(unattendedUpgradesSkippedByFlags({ "skip-unattended-upgrades": "1" })).toBe(true);
  });

  it("buildUnattendedUpgradesConfigSnippet disables auto reboot", () => {
    const snippet = buildUnattendedUpgradesConfigSnippet("pi-hole-a", 120);
    expect(snippet).toContain('Automatic-Reboot "false"');
    expect(snippet).toContain("RandomSleep");
  });
});

describe("guest-agents-config", () => {
  it("parses guest_agents from proxmox config", () => {
    const cfg = guestAgentsConfigFromProxmox({
      provision: {
        guest_agents: {
          crowdsec: { enabled: true, lapi_url: "http://192.0.2.50:8080" },
          wazuh: { enabled: false },
        },
      },
    });
    expect(cfg.crowdsec?.lapi_url).toBe("http://192.0.2.50:8080");
    expect(cfg.wazuh?.enabled).toBe(false);
  });

  it("isNagiosGuestSystem matches nagios sidecars", () => {
    expect(isNagiosGuestSystem("nagios-a")).toBe(true);
    expect(isNagiosGuestSystem("n8n-a")).toBe(false);
  });
});

describe("crowdsec-agent-ensure flags", () => {
  it("honours skip-crowdsec-agent", () => {
    expect(crowdsecAgentSkippedByFlags({ "skip-crowdsec-agent": "1" })).toBe(true);
  });
});
