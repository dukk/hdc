import { describe, expect, it } from "vitest";
import { deriveHealthStatus, statusIsOk } from "../../../clumps/lib/service-health/status.mjs";
import { joinUrlPath, hostnameFromUrl } from "../../../clumps/lib/service-health/resolve-endpoints.mjs";

describe("service-health status", () => {
  it("marks healthy when public works", () => {
    expect(
      deriveHealthStatus({
        dns: { ok: true, skipped: false },
        public: { ok: true, skipped: false },
        waf: { ok: true, skipped: false },
        direct: { ok: true, skipped: false },
        guest: { ok: true, skipped: false },
      }),
    ).toBe("healthy");
  });

  it("marks degraded when origin ok but edge fails (WAF outage)", () => {
    expect(
      deriveHealthStatus({
        dns: { ok: true, skipped: false },
        public: { ok: false, skipped: false },
        waf: { ok: false, skipped: false },
        direct: { ok: true, skipped: false },
        guest: { ok: true, skipped: false },
      }),
    ).toBe("degraded");
    expect(statusIsOk("degraded")).toBe(true);
  });

  it("marks down when origin fails", () => {
    expect(
      deriveHealthStatus({
        dns: { ok: false, skipped: false },
        public: { ok: false, skipped: false },
        waf: { ok: false, skipped: false },
        direct: { ok: false, skipped: false },
        guest: { ok: false, skipped: false },
      }),
    ).toBe("down");
    expect(statusIsOk("down")).toBe(false);
  });
});

describe("service-health url helpers", () => {
  it("joins url paths", () => {
    expect(joinUrlPath("https://vault.example/", "/alive")).toBe("https://vault.example/alive");
    expect(hostnameFromUrl("https://vault.dukk.org/alive")).toBe("vault.dukk.org");
  });
});
