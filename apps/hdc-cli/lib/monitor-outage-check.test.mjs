import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  formatOutageSummaryMarkdown,
  outageFingerprint,
  outagesFromHomepageQuery,
  outagesFromProxmoxQuery,
  outagesFromUptimeKumaQuery,
  runMonitorOutageCheck,
} from "../../hdc-agent-server/lib/monitor-outage-check.mjs";

const HDC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("monitor-outage-check", () => {
  it("outageFingerprint is stable for same outage keys", () => {
    const outages = [
      { source: "uptime-kuma", key: "uk:immich", label: "Immich", details: {} },
      { source: "homepage", key: "hp:personal-immich", label: "Immich", details: {} },
    ];
    expect(outageFingerprint(outages)).toBe(outageFingerprint([...outages].reverse()));
  });

  it("maps probe JSON into outage entries", () => {
    const uk = outagesFromUptimeKumaQuery({
      failing: [{ monitor_id: 5, name: "Immich", type: "http", target: "https://immich.invalid" }],
    });
    expect(uk[0].key).toMatch(/^uk:/);

    const hp = outagesFromHomepageQuery({
      failing: [{ group: "Personal", name: "Immich", kind: "siteMonitor", target: "https://x", error: "HTTP 500" }],
    });
    expect(hp[0].key).toMatch(/^hp:/);

    const pve = outagesFromProxmoxQuery({
      failing: [{ id: "vm-bind-a", status: "stopped", kind: "guest" }],
    });
    expect(pve[0].key).toMatch(/^pve:vm-bind-a:stopped$/);
  });

  it("formatOutageSummaryMarkdown lists outages", () => {
    const md = formatOutageSummaryMarkdown([
      { source: "uptime-kuma", key: "uk:a", label: "Service A", details: { msg: "timeout" } },
    ]);
    expect(md).toContain("Service A");
    expect(md).toContain("uptime-kuma");
  });

  it("skips LLM when same outage fingerprint persists", () => {
    const mockCapture = (_root, args) => {
      const cmd = args.join(" ");
      if (cmd.includes("uptime-kuma")) {
        return {
          ok: false,
          status: 1,
          stdout: JSON.stringify({
            ok: false,
            failing_count: 1,
            failing: [{ monitor_id: 1, name: "down-a" }],
          }),
          stderr: "",
        };
      }
      return {
        ok: true,
        status: 0,
        stdout: JSON.stringify({ ok: true, failing_count: 0, failing: [] }),
        stderr: "",
      };
    };

    const root = mkdtempSync(join(tmpdir(), "hdc-outage-"));
    try {
      mkdirSync(join(root, "operations"), { recursive: true });
      const first = runMonitorOutageCheck({
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        runHdcCliCapture: mockCapture,
      });
      expect(first.should_invoke_llm).toBe(true);

      const second = runMonitorOutageCheck({
        hdcRoot: HDC_ROOT,
        privateRoot: root,
        runHdcCliCapture: mockCapture,
      });
      expect(second.same_as_last_cycle).toBe(true);
      expect(second.should_invoke_llm).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
