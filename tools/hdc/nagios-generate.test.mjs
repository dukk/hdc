import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { nagiosHostName } from "../../packages/services/nagios/lib/generate.mjs";
import { dedupeBindRecordsByFqdn, loadBindForwardARecords } from "../../packages/services/nagios/lib/bind-monitored-hosts.mjs";

describe("nagios generate from BIND", () => {
  it("builds host_name from sidecar id and node name", () => {
    expect(nagiosHostName("hypervisor-a", "node")).toBe("hypervisor-a_node");
  });

  it("collects only forward A records from fixture config", () => {
    const dir = mkdtempSync(join(tmpdir(), "hdc-nagios-test-"));
    const bindPath = join(dir, "bind.json");
    writeFileSync(
      bindPath,
      JSON.stringify({
        schema_version: 2,
        zones: [
          {
            id: "hdc.example.invalid",
            zone_type: "forward",
            records: [
              { type: "A", name: "hypervisor-a", data: "192.0.2.11", ttl: 3600 },
              { type: "A", name: "hypervisor-b", data: "192.0.2.12", ttl: 3600 },
            ],
          },
          {
            id: "2.0.192.in-addr.arpa",
            zone_type: "reverse",
            subnet: "192.0.2.0/24",
            records: [{ type: "PTR", name: "11.2.0", data: "hypervisor-a.hdc.example.invalid.", ttl: 3600 }],
          },
          {
            id: "example.invalid",
            zone_type: "forward",
            records: [{ type: "NS", name: "@", data: "dns-a.hdc.example.invalid.", ttl: 3600 }],
          },
        ],
        bind: { primary_ip: "192.0.2.2" },
        deployments: [
          {
            system_id: "vm-dns-a",
            role: "primary",
            proxmox: { host_id: "hypervisor-a", qemu: { vmid: 101, ip: "192.0.2.2/24" } },
            configure: { ssh: { user: "root", host: "192.0.2.2" } },
          },
        ],
      }),
      "utf8",
    );
    try {
      const { records } = loadBindForwardARecords(dir, bindPath);
      expect(records).toHaveLength(2);
      expect(records[0].ip).toBe("192.0.2.11");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dedupes duplicate FQDN", () => {
    const records = [
      { zone: "z", name: "a", fqdn: "a.z.", ip: "192.0.2.1", ttl: 3600 },
      { zone: "z", name: "a", fqdn: "a.z.", ip: "192.0.2.2", ttl: 3600 },
    ];
    expect(dedupeBindRecordsByFqdn(records)).toHaveLength(1);
  });
});
