import { describe, expect, it } from "vitest";
import {
  buildWazuhLogCollectionApplyScript,
  normalizeWazuhLogCollectionEntries,
  renderWazuhManagedLocalfileBlock,
  wazuhLogCollectionSkippedByFlags,
} from "hdc/package/wazuh-log-collection.mjs";
import { resolveNginxWafWazuhLogCollection } from "hdc/clump/services/nginx-waf/lib/wazuh-log-collection.mjs";

describe("wazuh-log-collection", () => {
  it("normalizes and deduplicates log collection entries", () => {
    const entries = normalizeWazuhLogCollectionEntries([
      { location: "/var/log/nginx/access.log", log_format: "syslog" },
      { location: "/var/log/nginx/access.log", log_format: "syslog" },
      { location: "relative/path", log_format: "syslog" },
      { location: "/var/log/nginx/error.log", log_format: "not-real" },
    ]);
    expect(entries).toEqual([
      { location: "/var/log/nginx/access.log", log_format: "syslog" },
      { location: "/var/log/nginx/error.log", log_format: "syslog" },
    ]);
  });

  it("renders managed localfile block with hdc markers", () => {
    const block = renderWazuhManagedLocalfileBlock([
      { location: "/var/log/nginx/access.log", log_format: "syslog" },
    ]);
    expect(block).toContain("<!-- hdc-managed-log-collection begin -->");
    expect(block).toContain("<location>/var/log/nginx/access.log</location>");
    expect(block).toContain("<!-- hdc-managed-log-collection end -->");
  });

  it("builds remote apply script referencing ossec.conf", () => {
    const script = buildWazuhLogCollectionApplyScript(
      renderWazuhManagedLocalfileBlock([
        { location: "/var/log/nginx/access.log", log_format: "syslog" },
      ]),
    );
    expect(script).toContain("/var/ossec/etc/ossec.conf");
    expect(script).toContain("systemctl");
    expect(script).toContain("wazuh-agent");
  });

  it("skips when wazuh agent skip flags are set", () => {
    expect(wazuhLogCollectionSkippedByFlags({ "skip-wazuh-agent": "1" })).toBe(true);
    expect(wazuhLogCollectionSkippedByFlags({ "skip-wazuh-log-collection": "1" })).toBe(true);
    expect(wazuhLogCollectionSkippedByFlags({})).toBe(false);
  });

  it("resolves nginx-waf defaults without modsecurity", () => {
    const entries = resolveNginxWafWazuhLogCollection({
      defaults: {
        nginx_waf: { modsecurity: { enabled: false } },
      },
    });
    expect(entries).toEqual([
      { location: "/var/log/nginx/access.log", log_format: "syslog" },
      { location: "/var/log/nginx/error.log", log_format: "syslog" },
    ]);
  });

  it("resolves explicit log_collection from config", () => {
    const entries = resolveNginxWafWazuhLogCollection({
      defaults: {
        wazuh: {
          log_collection: [{ location: "/var/log/custom.log", log_format: "json" }],
        },
        nginx_waf: { modsecurity: { enabled: true } },
      },
    });
    expect(entries).toEqual([{ location: "/var/log/custom.log", log_format: "json" }]);
  });

  it("includes modsec audit log when modsecurity is enabled and no explicit collection", () => {
    const entries = resolveNginxWafWazuhLogCollection({
      defaults: {
        nginx_waf: { modsecurity: { enabled: true } },
      },
    });
    expect(entries).toEqual([
      { location: "/var/log/nginx/access.log", log_format: "syslog" },
      { location: "/var/log/nginx/error.log", log_format: "syslog" },
      { location: "/var/log/nginx/modsec_audit.log", log_format: "json" },
    ]);
  });
});
