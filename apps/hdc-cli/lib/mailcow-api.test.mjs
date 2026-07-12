import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  reconcileMailcowAliases,
  reconcileMailcowDomains,
  reconcileMailcowMailboxes,
} from "../../../clumps/services/mailcow/lib/mailcow-api.mjs";

vi.mock("../../../clumps/lib/mail-relay-config.mjs", () => ({
  loadMailRelayClientDefaults: () => ({
    relay_hostname: "postfix-relay.home.example.invalid",
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
        return new Response(JSON.stringify([{ id: "7", hostname: "postfix-relay.home.example.invalid:25" }]));
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
        return new Response(JSON.stringify([{ id: "7", hostname: "postfix-relay.home.example.invalid:25" }]));
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
        return new Response(JSON.stringify([{ id: "3", hostname: "postfix-relay.home.example.invalid:25" }]));
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

describe("reconcileMailcowMailboxes", () => {
  /** @type {import("vitest").Mock} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  const mailboxes = [
    {
      local_part: "admin",
      domain: "example.invalid",
      address: "admin@example.invalid",
      name: "Admin",
      quota_mb: 3072,
      active: true,
      password_vault_key: "HDC_TEST_MAILBOX_PASSWORD",
    },
  ];

  it("adds missing mailbox with password", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith("/api/v1/get/mailbox/all")) {
        return new Response(JSON.stringify([]));
      }
      if (url.endsWith("/api/v1/add/mailbox") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.local_part).toBe("admin");
        expect(body.password).toBe("secret123");
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      return new Response("not found", { status: 404 });
    });

    const result = await reconcileMailcowMailboxes(mailboxes, client, {
      resolvePassword: async () => "secret123",
    });
    expect(result.summary.added_count).toBe(1);
    expect(result.mailbox_results[0].mailbox_added).toBe(true);
  });

  it("updates existing mailbox display name", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith("/api/v1/get/mailbox/all")) {
        return new Response(
          JSON.stringify([
            {
              username: "admin@example.invalid",
              name: "Old Name",
              quota: "3072",
              active: "1",
            },
          ]),
        );
      }
      if (url.endsWith("/api/v1/edit/mailbox") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.attr.name).toBe("Admin");
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      return new Response("not found", { status: 404 });
    });

    const result = await reconcileMailcowMailboxes(mailboxes, client, {});
    expect(result.summary.updated_count).toBe(1);
    expect(result.mailbox_results[0].mailbox_updated).toBe(true);
  });
});

describe("reconcileMailcowAliases", () => {
  /** @type {import("vitest").Mock} */
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  const aliases = [
    {
      address: "info@example.invalid",
      goto: ["admin@example.invalid"],
      active: true,
    },
  ];

  it("adds missing alias", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (url.endsWith("/api/v1/get/alias/all")) {
        return new Response(JSON.stringify([]));
      }
      if (url.endsWith("/api/v1/add/alias") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body.address).toBe("info@example.invalid");
        expect(body.goto).toBe("admin@example.invalid");
        return new Response(JSON.stringify([{ type: "success" }]));
      }
      return new Response("not found", { status: 404 });
    });

    const result = await reconcileMailcowAliases(aliases, client);
    expect(result.summary.added_count).toBe(1);
    expect(result.alias_results[0].alias_added).toBe(true);
  });
});
