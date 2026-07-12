import { describe, expect, it } from "vitest";

import {
  parseDfVolumes,
  parseDiskEnum,
  parseDsmVersionLine,
  parseHealthCollectOutput,
  parseMdstat,
  parseSynoupgradeCheck,
} from "../../../clumps/infrastructure/synology-nas/lib/synology-query-remote.mjs";

describe("parseDsmVersionLine", () => {
  it("parses productversion from synoinfo line", () => {
    expect(parseDsmVersionLine('productversion="7.2.1-69057"')).toBe("7.2.1-69057");
  });
});

describe("parseDfVolumes", () => {
  it("extracts /volume mounts", () => {
    const df = `Filesystem      Size  Used Avail Use% Mounted on
/dev/md0        10T  2.0T  8.0T  20% /volume1
/dev/md1         5T  1.0T  4.0T  20% /volume2`;
    const rows = parseDfVolumes(df);
    expect(rows).toHaveLength(2);
    expect(rows[0].mount).toBe("/volume1");
    expect(rows[0].usePct).toBe("20%");
  });
});

describe("parseMdstat", () => {
  it("detects degraded RAID", () => {
    const md = `md2 : active raid5 sdf5[5] sde5[4] sdd5[3]
      21444608 blocks super 1.2 level 5, 64k chunk, algorithm 2 [6/5] [_UUUUU]
      bitmap: 0/1 pages [0KB], 65536KB chunk`;
    const r = parseMdstat(md);
    expect(r.arrays.length).toBeGreaterThan(0);
    expect(r.degraded).toBe(true);
  });

  it("parses clean array", () => {
    const md = `md0 : active raid1 sda5[0] sdb5[1]
      123456 blocks [2/2] [UU]`;
    const r = parseMdstat(md);
    expect(r.degraded).toBe(false);
    expect(r.arrays[0].name).toBe("md0");
  });
});

describe("parseHealthCollectOutput", () => {
  it("splits marked sections", () => {
    const raw = `===DSM_VERSION===
productversion="7.2"
===UPTIME===
up 3 days
===DF===
Filesystem Size Used Avail Use% Mounted on
/dev/md0 1T 100G 900G 10% /volume1
===MDSTAT===
md0 : active raid1
===DISKS===
Disk list line`;
    const h = parseHealthCollectOutput(raw);
    expect(h.dsmVersion).toBe("7.2");
    expect(h.volumes).toHaveLength(1);
    expect(h.uptime).toContain("3 days");
  });
});

describe("parseSynoupgradeCheck", () => {
  it("detects available update", () => {
    const r = parseSynoupgradeCheck("Available update: DSM 7.2.2-72806");
    expect(r.updateAvailable).toBe(true);
    expect(r.summary).toContain("Available update");
  });

  it("detects no update", () => {
    const r = parseSynoupgradeCheck("Your DSM is up to date");
    expect(r.updateAvailable).toBe(false);
  });
});

describe("parseDiskEnum", () => {
  it("returns non-empty lines", () => {
    const r = parseDiskEnum("Disk 1: WD\nDisk 2: WD");
    expect(r.lines).toHaveLength(2);
  });
});
