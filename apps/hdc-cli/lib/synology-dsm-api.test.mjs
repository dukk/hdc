import { describe, expect, it, vi } from "vitest";

import {
  synologyDsmBaseUrl,
  dsmLogin,
  dsmPackageControl,
  probeHttpIdentity,
} from "../../../clumps/infrastructure/synology-nas/lib/synology-dsm-api.mjs";

describe("synologyDsmBaseUrl", () => {
  it("defaults to https :5001", () => {
    expect(synologyDsmBaseUrl("10.0.0.10")).toBe("https://10.0.0.10:5001");
  });

  it("supports http :5000", () => {
    expect(synologyDsmBaseUrl("10.0.0.10", { scheme: "http" })).toBe("http://10.0.0.10:5000");
  });
});

describe("dsmLogin / dsmPackageControl", () => {
  it("logs in and starts a package", async () => {
    const httpRequest = vi.fn(async (url) => {
      if (url.includes("SYNO.API.Info")) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            data: { "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 7 } },
          }),
        };
      }
      if (url.includes("method=login")) {
        expect(url).toContain("account=dukk");
        return { statusCode: 200, body: JSON.stringify({ success: true, data: { sid: "sid-1" } }) };
      }
      if (url.includes("Package.Control") && url.includes("method=start")) {
        expect(url).toContain("_sid=sid-1");
        expect(url).toContain(encodeURIComponent(JSON.stringify(["PlexMediaServer"])));
        return { statusCode: 200, body: JSON.stringify({ success: true, data: {} }) };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const session = await dsmLogin({
      baseUrl: "https://10.0.0.10:5001",
      account: "dukk",
      password: "secret",
      httpRequest,
    });
    expect(session.sid).toBe("sid-1");
    await dsmPackageControl({
      session,
      packageId: "PlexMediaServer",
      method: "start",
      httpRequest,
    });
  });
});

describe("probeHttpIdentity", () => {
  it("treats 200 as ok", async () => {
    const httpRequest = vi.fn(async () => ({ statusCode: 200, body: "<MediaContainer/>" }));
    const r = await probeHttpIdentity("10.0.0.10", 32400, { httpRequest });
    expect(r.ok).toBe(true);
    expect(r.statusCode).toBe(200);
  });
});
