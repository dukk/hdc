import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reconcileMailcowDomains } from "../../../packages/services/mailcow/lib/mailcow-api.mjs";

vi.mock("../../../packages/lib/mail-relay-config.mjs", () => ({
  loadMailRelayClientDefaults: () => ({
    relay_hostname: "postfix-relay.hdc.dukk.org",
    relay_port: 25,
  }),
}));

describe("reconcileMailcowDomains", () => {
  /** @type {import("vitest").Mock} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const domains = [
    {
      name: "example.invalid",
      description: "Primary",
      dkim_selector: "dkim",
      dkim_key_size: 2048,
      outbound_mode: "postfix-relay",
      dns: { mx_priority: 10, spf: "", dmarc: "", notes: "" },
    },
  ];

  const client = {
    baseUrl: "https://mail.example.invalid",
    apiKey: "test-key",
    request: (path, opts = {}) => {
      const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
      const url = `https://mail.example.invalid${path.startsWith("/") ? path : `/${path}`}`;
      return fetchMock(url, {
        method,
        headers: { "X-API-Key": "test-key" },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      }).then(async (res) => {
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      });
    },
  };

  it("adds domain, generates DKIM, and sets relayhost", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/v1/get/domain/all") && method === "GET") {
        return new Response(JSON.stringify([]));
      }
      if (url.endsWith("/api/v1/add/domain") && method === "POST") {
        return new Response(JSON.stringify([{ type: "success", msg: "added" }]));
      }
      if (url.endsWith("/api/v1/get/dkim/example.invalid") && method === "GET") {
        return new Response(JSON.stringify({ dkim_txt: "" }));
      }
      if (url.endsWith("/api/v1/add/dkim") && method === "POST") {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      if (url.endsWith("/api/v1/get/dkim/example.invalid") && method === "GET") {
        return new Response(
          JSON.stringify({ dkim_selector: "dkim", dkim_txt: "v=DKIM1; k=rsa; p=abc" }),
        );
      }
      if (url.endsWith("/api/v1/get/relayhost/all") && method === "GET") {
        return new Response(JSON.stringify([]));
      }
      if (url.endsWith("/api/v1/add/relayhost") && method === "POST") {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      if (url.endsWith("/api/v1/get/relayhost/all") && method === "GET") {
        return new Response(JSON.stringify([{ id: "7", hostname: "postfix-relay.hdc.dukk.org:25" }]));
      }
      if (url.endsWith("/api/v1/edit/domain") && method === "POST") {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      return new Response("not found", { status: 404 });
    });

    // Second dkim GET after generate
    let dkimReads = 0;
    fetchMock.mockImplementation(async (url, init) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/v1/get/domain/all")) {
        return new Response(JSON.stringify([]));
      }
      if (url.endsWith("/api/v1/add/domain")) {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      if (url.includes("/api/v1/get/dkim/example.invalid")) {
        dkimReads += 1;
        if (dkimReads === 1) {
          return new Response(JSON.stringify({ dkim_txt: "" }));
        }
        return new Response(
          JSON.stringify({ dkim_selector: "dkim", dkim_txt: "v=DKIM1; k=rsa; p=abc" }),
        );
      }
      if (url.endsWith("/api/v1/add/dkim")) {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      if (url.endsWith("/api/v1/get/relayhost/all")) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        if (body) {
          return new Response(JSON.stringify([{ type: "success" }]));
        }
        const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("relayhost/all")).length;
        if (calls <= 1) {
          return new Response(JSON.stringify([]));
        }
        return new Response(JSON.stringify([{ id: "7", hostname: "postfix-relay.hdc.dukk.org:25" }]));
      }
      if (url.endsWith("/api/v1/add/relayhost")) {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      if (url.endsWith("/api/v1/edit/domain")) {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      return new Response("not found", { status: 404 });
    });

    const result = await reconcileMailcowDomains(domains, client);
    expect(result.summary.configured_count).toBe(1);
    expect(result.summary.added_count).toBe(1);
    expect(result.domain_results).toHaveLength(1);
    expect(result.domain_results[0].ok).toBe(true);
    expect(result.domain_results[0].domain_added).toBe(true);
    expect(result.domain_results[0].dkim_generated).toBe(true);
    expect(result.domain_results[0].relayhost_id).toBe("7");
  });

  it("updates description on existing domain", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith("/api/v1/get/domain/all")) {
        return new Response(
          JSON.stringify([{ domain_name: "example.invalid", description: "old" }]),
        );
      }
      if (url.includes("/api/v1/get/dkim/example.invalid")) {
        return new Response(
          JSON.stringify({ dkim_selector: "dkim", dkim_txt: "v=DKIM1; k=rsa; p=abc" }),
        );
      }
      if (url.endsWith("/api/v1/get/relayhost/all")) {
        return new Response(JSON.stringify([{ id: "3", hostname: "postfix-relay.hdc.dukk.org:25" }]));
      }
      if (url.endsWith("/api/v1/edit/domain")) {
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      return new Response("not found", { status: 404 });
    });

    const result = await reconcileMailcowDomains(domains, client);
    expect(result.domain_results[0].domain_added).toBe(false);
    expect(result.domain_results[0].description_updated).toBe(true);
    expect(result.summary.added_count).toBe(0);
  });
});
