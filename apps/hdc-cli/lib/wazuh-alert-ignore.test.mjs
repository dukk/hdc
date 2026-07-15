import { describe, expect, it } from "vitest";
import {
  WAZUH_MONITOR_LIST_REL,
  WAZUH_MONITOR_RULE_ID,
  buildWazuhAlertIgnoreSyncBash,
  patchWazuhManagerConfAlertIgnore,
  patchWazuhManagerConfMonitorList,
  patchWazuhManagerConfWhiteList,
  renderWazuhMonitorCdbList,
  renderWazuhMonitorLocalRules,
  resolveWazuhAlertIgnore,
  wazuhAlertIgnoreSkippedByFlags,
} from "hdc/clump/services/wazuh/lib/wazuh-alert-ignore.mjs";

const SAMPLE_CONF = `<ossec_config>
  <global>
    <email_notification>yes</email_notification>
    <email_to>ops@example.invalid</email_to>
  </global>
  <ruleset>
    <decoder_dir>ruleset/decoders</decoder_dir>
    <rule_dir>ruleset/rules</rule_dir>
  </ruleset>
</ossec_config>
`;

describe("wazuh-alert-ignore", () => {
  it("resolves srcips and default groups", () => {
    const resolved = resolveWazuhAlertIgnore({
      alert_ignore: { srcips: ["10.0.0.105", " 10.0.0.49 ", "not-an-ip", "10.0.0.105"] },
    });
    expect(resolved).toEqual({
      srcips: ["10.0.0.105", "10.0.0.49"],
      groups: ["web", "web_scan", "attack", "ids", "modsecurity", "nginx"],
    });
  });

  it("returns null when srcips empty", () => {
    expect(resolveWazuhAlertIgnore({ alert_ignore: { srcips: [] } })).toBeNull();
    expect(resolveWazuhAlertIgnore({})).toBeNull();
  });

  it("renders CDB list with trailing colons", () => {
    expect(renderWazuhMonitorCdbList(["10.0.0.105", "132.145.205.212"])).toBe(
      "10.0.0.105:\n132.145.205.212:\n",
    );
  });

  it("renders local_rules that mute configured groups for list srcips", () => {
    const xml = renderWazuhMonitorLocalRules({
      srcips: ["10.0.0.105"],
      groups: ["web", "attack"],
    });
    expect(xml).toContain(`id="${WAZUH_MONITOR_RULE_ID}"`);
    expect(xml).toContain('level="0"');
    expect(xml).toContain("<if_group>web|attack</if_group>");
    expect(xml).toContain(`>${WAZUH_MONITOR_LIST_REL}</list>`);
  });

  it("patches ruleset list and white_list entries", () => {
    const patched = patchWazuhManagerConfAlertIgnore(SAMPLE_CONF, {
      srcips: ["10.0.0.105", "10.0.0.49"],
      groups: ["web"],
    });
    expect(patched).toContain(`<list>${WAZUH_MONITOR_LIST_REL}</list>`);
    expect(patched).toContain("<white_list>10.0.0.105</white_list>");
    expect(patched).toContain("<white_list>10.0.0.49</white_list>");
    // idempotent
    expect(patchWazuhManagerConfMonitorList(patched)).toBe(patched);
    expect(patchWazuhManagerConfWhiteList(patched, ["10.0.0.105"])).toBe(patched);
  });

  it("builds sync bash with CDB path and manager restart", () => {
    const bash = buildWazuhAlertIgnoreSyncBash({
      srcips: ["10.0.0.105"],
      groups: ["web", "attack"],
    });
    expect(bash).toContain("hdc-monitor-sources");
    expect(bash).toContain("local_rules.xml");
    expect(bash).toContain("docker");
    expect(bash).toContain("10.0.0.105");
  });

  it("skips when --skip-alert-ignore is set", () => {
    expect(wazuhAlertIgnoreSkippedByFlags({ "skip-alert-ignore": "1" })).toBe(true);
    expect(wazuhAlertIgnoreSkippedByFlags({})).toBe(false);
  });
});
