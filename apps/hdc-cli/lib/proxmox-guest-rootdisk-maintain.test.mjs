import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKIP_NAME_PATTERNS,
  expansionStepsNeeded,
  guestNameMatchesSystemId,
  guestRootdiskOptionsFromConfig,
  needsRootExpansion,
  nextExpansionPlan,
  parseDfBytesLine,
  parseQemuBootDiskFromConfig,
  resolveGuestRootdiskRunOptions,
  rootUsedPercent,
  stillNeedsRootExpansion,
  shouldSkipGuestByName,
} from "../../../clumps/infrastructure/proxmox/lib/proxmox-guest-rootdisk-maintain.mjs";

const GIB = 1024 ** 3;

describe("proxmox-guest-rootdisk-maintain", () => {
  it("parseDfBytesLine parses size used avail", () => {
    const df = parseDfBytesLine("33554432000 17179869184 14680064000");
    expect(df?.sizeBytes).toBe(33554432000);
    expect(df?.usedBytes).toBe(17179869184);
    expect(df?.availBytes).toBe(14680064000);
  });

  it("parseDfBytesLine rejects short lines", () => {
    expect(parseDfBytesLine("123 456")).toBeNull();
    expect(parseDfBytesLine("")).toBeNull();
  });

  it("rootUsedPercent and needsRootExpansion use strict greater-than threshold", () => {
    const half = { sizeBytes: 100 * GIB, usedBytes: 50 * GIB, availBytes: 50 * GIB };
    expect(rootUsedPercent(half)).toBe(50);
    expect(needsRootExpansion(half, 50)).toBe(false);

    const over = { sizeBytes: 100 * GIB, usedBytes: 51 * GIB, availBytes: 49 * GIB };
    expect(needsRootExpansion(over, 50)).toBe(true);
    expect(stillNeedsRootExpansion(half, 50)).toBe(true);
  });

  it("expansionStepsNeeded adds 8G increments until below threshold", () => {
    const df = { sizeBytes: 32 * GIB, usedBytes: 20 * GIB, availBytes: 12 * GIB };
    expect(expansionStepsNeeded(df, 50, 8)).toBe(2);
    expect(nextExpansionPlan(df, 50, 8)).toEqual({ steps: 2, targetSizeGb: 48 });
  });

  it("expansionStepsNeeded returns zero when already below threshold", () => {
    const df = { sizeBytes: 32 * GIB, usedBytes: 10 * GIB, availBytes: 22 * GIB };
    expect(expansionStepsNeeded(df, 50, 8)).toBe(0);
  });

  it("shouldSkipGuestByName matches Windows and HAOS patterns", () => {
    expect(shouldSkipGuestByName("vm-win11-a", DEFAULT_SKIP_NAME_PATTERNS)).toBe(true);
    expect(shouldSkipGuestByName("homeassistant-a", DEFAULT_SKIP_NAME_PATTERNS)).toBe(true);
    expect(shouldSkipGuestByName("glances-a", DEFAULT_SKIP_NAME_PATTERNS)).toBe(false);
  });

  it("guestNameMatchesSystemId normalizes vm- prefix", () => {
    expect(guestNameMatchesSystemId("bind-a", "vm-bind-a")).toBe(true);
    expect(guestNameMatchesSystemId("vm-bind-a", "vm-bind-a")).toBe(true);
    expect(guestNameMatchesSystemId("bind-a", "bind-b")).toBe(false);
  });

  it("parseQemuBootDiskFromConfig reads boot order and scsi0 fallback", () => {
    expect(
      parseQemuBootDiskFromConfig("boot: order=scsi0;net0\nscsi0: local-lvm:32"),
    ).toBe("scsi0");
    expect(parseQemuBootDiskFromConfig("scsi0: local-lvm:32\nnet0: virtio")).toBe("scsi0");
    expect(parseQemuBootDiskFromConfig("net0: virtio")).toBeNull();
  });

  it("guestRootdiskOptionsFromConfig reads provision.guest_rootdisk", () => {
    const opts = guestRootdiskOptionsFromConfig({
      provision: {
        guest_rootdisk: {
          max_used_percent: 60,
          increment_gb: 16,
          skip_name_patterns: ["test"],
        },
      },
    });
    expect(opts.maxUsedPercent).toBe(60);
    expect(opts.incrementGb).toBe(16);
    expect(opts.skipNamePatterns).toEqual(["test"]);
  });

  it("resolveGuestRootdiskRunOptions applies flag overrides", () => {
    const opts = resolveGuestRootdiskRunOptions(
      { "guest-rootfs-threshold": "55", "guest-rootfs-increment-gb": "4" },
      guestRootdiskOptionsFromConfig({}),
    );
    expect(opts.maxUsedPercent).toBe(55);
    expect(opts.incrementGb).toBe(4);
  });
});
