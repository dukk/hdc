import { describe, expect, it } from "vitest";
import {
  clamavAptInstallCommand,
  clamavInstalledCheckCommand,
  clamavSkippedByFlags,
} from "../../../packages/lib/clamav-ensure.mjs";
import { listSshTargetsFromPackageConfig } from "../../../packages/lib/maintain-clamav-only.mjs";

describe("clamav-ensure", () => {
  it("exposes dpkg check for clamav", () => {
    expect(clamavInstalledCheckCommand()).toContain("dpkg -s clamav");
  });

  it("apt install includes clamav packages", () => {
    const cmd = clamavAptInstallCommand();
    expect(cmd).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(cmd).toContain("clamav");
    expect(cmd).toContain("clamav-freshclam");
  });

  it("honours --skip-clamav and skip_clamav flags", () => {
    expect(clamavSkippedByFlags({ "skip-clamav": "1" })).toBe(true);
    expect(clamavSkippedByFlags({ skip_clamav: "1" })).toBe(true);
    expect(clamavSkippedByFlags({})).toBe(false);
  });
});

describe("maintain-clamav-only listSshTargetsFromPackageConfig", () => {
  it("collects SSH targets from deployments", () => {
    const targets = listSshTargetsFromPackageConfig({
      deployments: [
        {
          system_id: "vm-dns-a",
          configure: { ssh: { user: "root", host: "192.0.2.10" } },
        },
        {
          system_id: "vm-dns-b",
          configure: { ssh: { user: "root", host: "192.0.2.11" } },
        },
      ],
    });
    expect(targets).toHaveLength(2);
    expect(targets[0].host).toBe("192.0.2.10");
  });

  it("dedupes identical SSH endpoints", () => {
    const targets = listSshTargetsFromPackageConfig({
      deployments: [
        { system_id: "a", configure: { ssh: { host: "192.0.2.1" } } },
        { system_id: "b", configure: { ssh: { host: "192.0.2.1" } } },
      ],
    });
    expect(targets).toHaveLength(1);
  });
});
