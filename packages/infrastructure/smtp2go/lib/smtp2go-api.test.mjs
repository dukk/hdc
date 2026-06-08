import { afterEach, describe, expect, it, vi } from "vitest";

import { createSmtp2goClient, smtp2goErrorMessage } from "./smtp2go-api.mjs";

describe("smtp2go-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("smtp2goErrorMessage parses data.error", () => {
    expect(
      smtp2goErrorMessage({
        data: { error: "permission denied", error_code: "E_TEST" },
      })
    ).toBe("permission denied (E_TEST)");
  });

  it("listSenderDomains posts to /domain/view with API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          request_id: "req1",
          data: {
            domains: [
              {
                domain: {
                  fulldomain: "dukk.org",
                  dkim_selector: "s1160987",
                  dkim_value: "dkim.smtp2go.net",
                  dkim_verified: true,
                  rpath_selector: "em1160987",
                  rpath_value: "return.smtp2go.net",
                  rpath_verified: true,
                },
                trackers: [
                  {
                    subdomain: "link",
                    cname_value: "track.smtp2go.net",
                    cname_verified: true,
                    enabled: true,
                  },
                ],
              },
            ],
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createSmtp2goClient({ apiKey: "api-test-key" });
    const domains = await api.listSenderDomains();

    expect(domains).toHaveLength(1);
    expect(domains[0].domain.fulldomain).toBe("dukk.org");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/domain/view");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Smtp2go-Api-Key"]).toBe("api-test-key");
  });

  it("addSenderDomain includes tracking and returnpath subdomains", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: { domains: [{ domain: { fulldomain: "hdc.dukk.org" } }] },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createSmtp2goClient({ apiKey: "api-test-key" });
    await api.addSenderDomain({
      domain: "hdc.dukk.org",
      trackingSubdomain: "link",
      returnpathSubdomain: "em1160987",
      autoVerify: true,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.domain).toBe("hdc.dukk.org");
    expect(body.tracking_subdomain).toBe("link");
    expect(body.returnpath_subdomain).toBe("em1160987");
    expect(body.auto_verify).toBe(true);
  });

  it("throws on API error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          data: { error: "invalid domain", error_code: "E_BAD" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const api = createSmtp2goClient({ apiKey: "api-test-key" });
    await expect(api.verifySenderDomain("bad.example")).rejects.toThrow(/invalid domain/);
  });
});
