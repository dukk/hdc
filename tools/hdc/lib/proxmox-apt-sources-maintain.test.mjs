import { describe, expect, it } from "vitest";
import {
  PVE_REMOVE_NAG_SCRIPT,
  aptSourcesMaintainEnabledFromConfig,
  aptSourcesOptionsFromConfig,
  buildAptSourcesApplyScript,
  buildAptSourcesAuditScript,
  debianSuiteForPveMajor,
  formatAptSourcesHostSummary,
  parseAptSourcesAudit,
} from "../../../packages/infrastructure/proxmox/lib/proxmox-apt-sources-maintain.mjs";

const fixtureCfg = {
  schema_version: 1,
  clusters: [],
  provision: {
    apt_sources: {
      enabled: true,
      disable_enterprise: true,
      enable_no_subscription: true,
      disable_ceph_enterprise: true,
      remove_subscription_nag: false,
    },
  },
};

describe("proxmox apt sources maintain", () => {
  it("debianSuiteForPveMajor maps PVE 8/9 to bookworm/trixie", () => {
    expect(debianSuiteForPveMajor(8)).toBe("bookworm");
    expect(debianSuiteForPveMajor(9)).toBe("trixie");
    expect(debianSuiteForPveMajor(7)).toBeNull();
  });

  it("aptSourcesMaintainEnabledFromConfig defaults to enabled", () => {
    expect(aptSourcesMaintainEnabledFromConfig({})).toBe(true);
    expect(aptSourcesMaintainEnabledFromConfig({ provision: { apt_sources: { enabled: false } } })).toBe(
      false,
    );
  });

  it("aptSourcesOptionsFromConfig reads provision.apt_sources", () => {
    const opts = aptSourcesOptionsFromConfig(fixtureCfg);
    expect(opts.disableEnterprise).toBe(true);
    expect(opts.enableNoSubscription).toBe(true);
    expect(opts.disableCephEnterprise).toBe(true);
    expect(opts.removeSubscriptionNag).toBe(false);
  });

  it("parseAptSourcesAudit detects drift from key=value audit output", () => {
    const auditOut = `
major=9
format=deb822
enterprise_active=1
no_sub_active=0
nag_script=0
nag_apt_conf=0
debian_sources_ok=1
`.trim();
    const audit = parseAptSourcesAudit(auditOut, aptSourcesOptionsFromConfig({}));
    expect(audit.major).toBe(9);
    expect(audit.format).toBe("deb822");
    expect(audit.enterpriseActive).toBe(true);
    expect(audit.noSubActive).toBe(false);
    expect(audit.needsApply).toBe(true);
  });

  it("parseAptSourcesAudit reports no apply when compliant", () => {
    const auditOut = `
major=9
format=deb822
enterprise_active=0
no_sub_active=1
nag_script=1
nag_apt_conf=1
debian_sources_ok=1
`.trim();
    const audit = parseAptSourcesAudit(auditOut, aptSourcesOptionsFromConfig({}));
    expect(audit.needsApply).toBe(false);
  });

  it("buildAptSourcesApplyScript includes PVE 9 proxmox.sources and disable enterprise", () => {
    const script = buildAptSourcesApplyScript({
      major: 9,
      suite: "trixie",
      options: aptSourcesOptionsFromConfig({}),
    });
    expect(script).toContain("HDC_MAJOR=9");
    expect(script).toContain("pve-no-subscription");
    expect(script).toContain("Enabled: false");
    expect(script).toContain("proxmox.sources");
    expect(script).toContain("pve-remove-nag.sh");
  });

  it("buildAptSourcesApplyScript includes PVE 8 list files", () => {
    const script = buildAptSourcesApplyScript({
      major: 8,
      suite: "bookworm",
      options: aptSourcesOptionsFromConfig({}),
    });
    expect(script).toContain("HDC_MAJOR=8");
    expect(script).toContain("pve-install-repo.list");
    expect(script).toContain("pve-enterprise.list");
    expect(script).toContain("bookworm");
  });

  it("buildAptSourcesAuditScript prints machine-readable keys", () => {
    const script = buildAptSourcesAuditScript();
    expect(script).toContain("enterprise_active=");
    expect(script).toContain("no_sub_active=");
    expect(script).toContain("debian_sources_ok=");
  });

  it("PVE_REMOVE_NAG_SCRIPT patches proxmoxlib.js", () => {
    expect(PVE_REMOVE_NAG_SCRIPT).toContain("proxmoxlib.js");
    expect(PVE_REMOVE_NAG_SCRIPT).toContain("NoMoreNagging");
  });

  it("formatAptSourcesHostSummary includes host id and status", () => {
    expect(
      formatAptSourcesHostSummary({ hostId: "hypervisor-b", major: 9, changed: true, ok: true }),
    ).toMatch(/hypervisor-b:.*changed/);
    expect(
      formatAptSourcesHostSummary({ hostId: "hypervisor-c", major: null, changed: false, ok: false, error: "x" }),
    ).toContain("fail");
  });
});
