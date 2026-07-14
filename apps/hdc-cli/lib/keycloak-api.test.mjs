import { describe, expect, it, vi } from "vitest";

import {
  reconcileKeycloakRealms,
  realmNeedsUpdate,
  userNeedsUpdate,
  realmRepresentationFromConfig,
  userRepresentationFromConfig,
  smtpServerNeedsUpdate,
} from "../../../clumps/services/keycloak/lib/keycloak-api.mjs";
import {
  filterRealmsByFlag,
  normalizeRealmList,
  resolveKeycloakApiBaseUrl,
  buildRealmDriftFields,
  smtpServerFromMailConfig,
} from "../../../clumps/services/keycloak/lib/keycloak-realms.mjs";

vi.mock("../../../clumps/lib/mail-relay-settings.mjs", () => ({
  loadMailRelayAppSettings: () => ({
    host: "postfix-relay.hdc.example.invalid",
    port: 25,
    from: "noreply@hdc.example.invalid",
    encryption: null,
    myorigin: "hdc.example.invalid",
  }),
  mailEnabledFromConfig: (mailBlock) => {
    if (mailBlock === null || typeof mailBlock !== "object" || Array.isArray(mailBlock)) {
      return false;
    }
    const m = /** @type {Record<string, unknown>} */ (mailBlock);
    return m.enabled === true || m.enabled === 1 || m.enabled === "true";
  },
}));

describe("normalizeRealmList", () => {
  it("accepts realms with users and password_vault_key", () => {
    const realms = normalizeRealmList({
      realms: [
        {
          id: "hdc",
          realm: "hdc",
          display_name: "HDC",
          users: [
            {
              username: "alice",
              email: "alice@example.invalid",
              password_vault_key: "HDC_KEYCLOAK_USER_HDC_ALICE_PASSWORD",
            },
          ],
        },
      ],
    });
    expect(realms).toHaveLength(1);
    expect(realms[0].realm).toBe("hdc");
    expect(realms[0].users[0].username).toBe("alice");
  });

  it("rejects master realm", () => {
    expect(() =>
      normalizeRealmList({
        realms: [{ realm: "master", users: [] }],
      }),
    ).toThrow(/master/);
  });

  it("requires password_vault_key", () => {
    expect(() =>
      normalizeRealmList({
        realms: [{ realm: "hdc", users: [{ username: "alice" }] }],
      }),
    ).toThrow(/password_vault_key/);
  });

  it("returns empty when realms omitted", () => {
    expect(normalizeRealmList({})).toEqual([]);
  });

  it("resolves smtp_server when mail.enabled", () => {
    const realms = normalizeRealmList({
      realms: [
        {
          id: "dukk-sso",
          realm: "dukk-sso",
          mail: { enabled: true, from_display_name: "Dukk SSO" },
          users: [],
        },
      ],
    });
    expect(realms[0].smtp_server).toEqual({
      host: "postfix-relay.hdc.example.invalid",
      port: "25",
      from: "noreply@hdc.example.invalid",
      ssl: "false",
      starttls: "false",
      auth: "false",
      fromDisplayName: "Dukk SSO",
    });
  });

  it("leaves smtp_server unset when mail absent", () => {
    const realms = normalizeRealmList({
      realms: [{ id: "hdc", realm: "hdc", users: [] }],
    });
    expect(realms[0].smtp_server).toBeUndefined();
  });
});

describe("smtpServerFromMailConfig", () => {
  it("returns null when mail disabled", () => {
    expect(smtpServerFromMailConfig({ enabled: false })).toBeNull();
  });

  it("allows from override", () => {
    const smtp = smtpServerFromMailConfig({
      enabled: true,
      from: "sso@example.invalid",
      reply_to: "ops@example.invalid",
    });
    expect(smtp?.from).toBe("sso@example.invalid");
    expect(smtp?.replyTo).toBe("ops@example.invalid");
  });
});

describe("resolveKeycloakApiBaseUrl", () => {
  it("prefers api_url", () => {
    expect(
      resolveKeycloakApiBaseUrl({
        api_url: "https://kc.local/",
        external_url: "https://keycloak.example.invalid",
      }),
    ).toBe("https://kc.local");
  });

  it("falls back to external_url", () => {
    expect(
      resolveKeycloakApiBaseUrl({
        external_url: "https://keycloak.example.invalid/",
      }),
    ).toBe("https://keycloak.example.invalid");
  });

  it("falls back to CT IP", () => {
    expect(resolveKeycloakApiBaseUrl({ host_port: 8080 }, { ctIp: "10.0.0.197" })).toBe(
      "http://10.0.0.197:8080",
    );
  });
});

describe("filterRealmsByFlag", () => {
  const realms = normalizeRealmList({
    realms: [
      { id: "hdc", realm: "hdc", users: [] },
      { id: "apps", realm: "apps", users: [] },
    ],
  });

  it("filters by id", () => {
    expect(filterRealmsByFlag(realms, "apps").map((r) => r.realm)).toEqual(["apps"]);
  });

  it("throws when no match", () => {
    expect(() => filterRealmsByFlag(realms, "nope")).toThrow(/no configured realm/);
  });
});

describe("drift helpers", () => {
  it("realmNeedsUpdate detects display name drift", () => {
    expect(
      realmNeedsUpdate(
        { realm: "hdc", enabled: true, displayName: "Old" },
        {
          id: "hdc",
          realm: "hdc",
          enabled: true,
          display_name: "New",
          users: [],
        },
      ),
    ).toBe(true);
  });

  it("realmNeedsUpdate detects smtp drift", () => {
    const configured = normalizeRealmList({
      realms: [
        {
          id: "hdc",
          realm: "hdc",
          mail: { enabled: true },
          users: [],
        },
      ],
    })[0];
    expect(
      realmNeedsUpdate(
        {
          realm: "hdc",
          enabled: true,
          smtpServer: { host: "old.example", port: "25", from: "a@b.c" },
        },
        configured,
      ),
    ).toBe(true);
    expect(
      smtpServerNeedsUpdate(
        {
          host: "postfix-relay.hdc.example.invalid",
          port: "25",
          from: "noreply@hdc.example.invalid",
          ssl: "false",
          starttls: "false",
          auth: "false",
        },
        configured.smtp_server ?? {},
      ),
    ).toBe(false);
  });

  it("userNeedsUpdate detects email drift", () => {
    expect(
      userNeedsUpdate(
        { username: "alice", email: "old@example.invalid", enabled: true },
        {
          username: "alice",
          email: "new@example.invalid",
          password_vault_key: "K",
        },
      ),
    ).toBe(true);
  });

  it("buildRealmDriftFields reports missing/extra", () => {
    const configured = normalizeRealmList({
      realms: [
        {
          id: "hdc",
          realm: "hdc",
          users: [{ username: "alice", password_vault_key: "K" }],
        },
      ],
    });
    const drift = buildRealmDriftFields(
      configured,
      [{ realm: "hdc" }, { realm: "orphan" }, { realm: "master" }],
      new Map([["hdc", ["alice", "bob"]]]),
    );
    expect(drift.extra_realms).toContain("orphan");
    expect(drift.extra_realms).not.toContain("master");
    expect(drift.realms[0].extra_users).toContain("bob");
  });
});

describe("representation helpers", () => {
  it("maps config fields to Keycloak representations", () => {
    const realm = realmRepresentationFromConfig({
      id: "hdc",
      realm: "hdc",
      enabled: true,
      display_name: "HDC",
      login_with_email_allowed: true,
      ssl_required: "external",
      smtp_server: {
        host: "postfix-relay.hdc.example.invalid",
        port: "25",
        from: "noreply@hdc.example.invalid",
        ssl: "false",
        starttls: "false",
        auth: "false",
      },
      users: [],
    });
    expect(realm.displayName).toBe("HDC");
    expect(realm.loginWithEmailAllowed).toBe(true);
    expect(realm.sslRequired).toBe("external");
    expect(realm.smtpServer).toMatchObject({
      host: "postfix-relay.hdc.example.invalid",
      port: "25",
      auth: "false",
    });

    const user = userRepresentationFromConfig({
      username: "alice",
      email: "a@b.c",
      first_name: "Alice",
      password_vault_key: "K",
    });
    expect(user.firstName).toBe("Alice");
    expect(user.email).toBe("a@b.c");
  });
});

/**
 * @param {{
 *   realms?: Record<string, unknown>[];
 *   usersByRealm?: Record<string, Record<string, unknown>[]>;
 * }} [seed]
 */
function mockClient(seed = {}) {
  /** @type {Record<string, unknown>[]} */
  let realms = [...(seed.realms ?? [])];
  /** @type {Record<string, Record<string, unknown>[]>} */
  const usersByRealm = { ...(seed.usersByRealm ?? {}) };
  /** @type {unknown[]} */
  const passwordResets = [];
  /** @type {string[]} */
  const deletedRealms = [];
  /** @type {string[]} */
  const deletedUsers = [];

  const client = {
    baseUrl: "http://keycloak.test",
    accessToken: "tok",
    /**
     * @param {string} path
     * @param {{ method?: string; body?: unknown; query?: Record<string, unknown> }} [opts]
     */
    request: async (path, opts = {}) => {
      const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
      if (path === "/admin/realms" && method === "GET") return realms;
      if (path === "/admin/realms" && method === "POST") {
        const body = /** @type {Record<string, unknown>} */ (opts.body ?? {});
        realms = [...realms, { ...body, enabled: body.enabled !== false }];
        const name = String(body.realm ?? "");
        if (name && !usersByRealm[name]) usersByRealm[name] = [];
        return null;
      }
      const realmGet = path.match(/^\/admin\/realms\/([^/]+)$/);
      if (realmGet && method === "GET") {
        const name = decodeURIComponent(realmGet[1]);
        const found = realms.find((r) => r.realm === name);
        if (!found) throw new Error(`realm ${name} not found`);
        return found;
      }
      if (realmGet && method === "PUT") {
        const name = decodeURIComponent(realmGet[1]);
        const body = /** @type {Record<string, unknown>} */ (opts.body ?? {});
        realms = realms.map((r) => (r.realm === name ? { ...r, ...body } : r));
        return null;
      }
      if (realmGet && method === "DELETE") {
        const name = decodeURIComponent(realmGet[1]);
        deletedRealms.push(name);
        realms = realms.filter((r) => r.realm !== name);
        delete usersByRealm[name];
        return null;
      }
      const usersList = path.match(/^\/admin\/realms\/([^/]+)\/users$/);
      if (usersList && method === "GET") {
        const name = decodeURIComponent(usersList[1]);
        let users = usersByRealm[name] ?? [];
        const q = opts.query ?? {};
        if (typeof q.username === "string" && q.username) {
          const want = q.username.toLowerCase();
          users = users.filter(
            (u) => typeof u.username === "string" && u.username.toLowerCase() === want,
          );
        }
        return users;
      }
      if (usersList && method === "POST") {
        const name = decodeURIComponent(usersList[1]);
        const body = /** @type {Record<string, unknown>} */ (opts.body ?? {});
        const id = `uid-${(usersByRealm[name] ?? []).length + 1}`;
        const row = { id, ...body };
        usersByRealm[name] = [...(usersByRealm[name] ?? []), row];
        return null;
      }
      const userPut = path.match(/^\/admin\/realms\/([^/]+)\/users\/([^/]+)$/);
      if (userPut && method === "PUT") {
        const name = decodeURIComponent(userPut[1]);
        const id = decodeURIComponent(userPut[2]);
        const body = /** @type {Record<string, unknown>} */ (opts.body ?? {});
        usersByRealm[name] = (usersByRealm[name] ?? []).map((u) =>
          u.id === id ? { ...u, ...body } : u,
        );
        return null;
      }
      if (userPut && method === "DELETE") {
        const name = decodeURIComponent(userPut[1]);
        const id = decodeURIComponent(userPut[2]);
        deletedUsers.push(`${name}/${id}`);
        usersByRealm[name] = (usersByRealm[name] ?? []).filter((u) => u.id !== id);
        return null;
      }
      const reset = path.match(/^\/admin\/realms\/([^/]+)\/users\/([^/]+)\/reset-password$/);
      if (reset && method === "PUT") {
        passwordResets.push(opts.body);
        return null;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };

  return {
    client,
    get realms() {
      return realms;
    },
    passwordResets,
    deletedRealms,
    deletedUsers,
    usersByRealm,
  };
}

describe("reconcileKeycloakRealms", () => {
  it("creates missing realm and user and sets password", async () => {
    const mock = mockClient({ realms: [] });
    const realms = normalizeRealmList({
      realms: [
        {
          id: "hdc",
          realm: "hdc",
          display_name: "HDC",
          users: [
            {
              username: "alice",
              email: "alice@example.invalid",
              password_vault_key: "HDC_KEYCLOAK_USER_HDC_ALICE_PASSWORD",
            },
          ],
        },
      ],
    });

    const result = await reconcileKeycloakRealms(realms, mock.client, {
      resolveUserPassword: async () => "s3cret",
    });

    expect(result.ok).toBe(true);
    expect(result.summary.added_count).toBe(1);
    expect(result.summary.users_added).toBe(1);
    expect(result.summary.passwords_set).toBe(1);
    expect(mock.passwordResets[0]).toEqual({
      type: "password",
      value: "s3cret",
      temporary: false,
    });
    expect(mock.realms.some((r) => r.realm === "hdc")).toBe(true);
  });

  it("creates realm with smtpServer when mail.enabled", async () => {
    const mock = mockClient({ realms: [] });
    const realms = normalizeRealmList({
      realms: [
        {
          id: "dukk-sso",
          realm: "dukk-sso",
          mail: { enabled: true, from_display_name: "Dukk SSO" },
          users: [],
        },
      ],
    });
    const result = await reconcileKeycloakRealms(realms, mock.client, {
      resolveUserPassword: async () => "x",
    });
    expect(result.ok).toBe(true);
    expect(mock.realms[0].smtpServer).toMatchObject({
      host: "postfix-relay.hdc.example.invalid",
      port: "25",
      fromDisplayName: "Dukk SSO",
      auth: "false",
    });
  });

  it("updates realm settings and prunes extra users", async () => {
    const mock = mockClient({
      realms: [{ realm: "hdc", enabled: true, displayName: "Old" }],
      usersByRealm: {
        hdc: [
          { id: "uid-1", username: "alice", email: "alice@example.invalid", enabled: true },
          { id: "uid-2", username: "bob", enabled: true },
        ],
      },
    });

    const realms = normalizeRealmList({
      realms: [
        {
          id: "hdc",
          realm: "hdc",
          display_name: "HDC",
          users: [
            {
              username: "alice",
              email: "alice@example.invalid",
              password_vault_key: "K",
            },
          ],
        },
      ],
    });

    const result = await reconcileKeycloakRealms(realms, mock.client, {
      prune: true,
      resolveUserPassword: async () => "s3cret",
    });

    expect(result.ok).toBe(true);
    expect(result.summary.updated_count).toBe(1);
    expect(result.summary.users_pruned).toBe(1);
    expect(mock.deletedUsers).toContain("hdc/uid-2");
    expect(mock.realms.find((r) => r.realm === "hdc")?.displayName).toBe("HDC");
  });

  it("does not prune realms when config realms is empty", async () => {
    const mock = mockClient({
      realms: [{ realm: "master" }, { realm: "orphan" }],
    });
    const result = await reconcileKeycloakRealms([], mock.client, {
      prune: true,
      resolveUserPassword: async () => "x",
    });
    expect(result.summary.pruned_realm_count).toBe(0);
    expect(mock.deletedRealms).toEqual([]);
  });

  it("prunes unmanaged non-master realms when config has realms", async () => {
    const mock = mockClient({
      realms: [{ realm: "master" }, { realm: "orphan" }, { realm: "hdc", enabled: true }],
      usersByRealm: { hdc: [] },
    });
    const realms = normalizeRealmList({
      realms: [{ id: "hdc", realm: "hdc", users: [] }],
    });
    const result = await reconcileKeycloakRealms(realms, mock.client, {
      prune: true,
      resolveUserPassword: async () => "x",
    });
    expect(result.summary.pruned_realm_count).toBe(1);
    expect(mock.deletedRealms).toEqual(["orphan"]);
    expect(mock.deletedRealms).not.toContain("master");
  });
});
