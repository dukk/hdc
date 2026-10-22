import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bwGetPassword,
  bwGetLoginCredentials,
  bwGetLoginUris,
  bwListItemNames,
  bwReadOrgSecrets,
  bwSetPassword,
  bwUpdateLoginUris,
  clearBwSessionProcessCache,
  ensureBwUnlocked,
  normalizeLoginUris,
  quoteCmdArg,
  resolveBwCollectionId,
  resolveBwCommand,
  resolveBwExecutable,
  resolveBwOrganizationId,
} from "./vaultwarden-cli.mjs";

const ORG_ID = "org-1111-aaaa-bbbb-cccc";
const COLL_ID = "coll-2222-dddd-eeee-ffff";
const ENCODED_PAYLOAD = "encoded-payload";

describe("vaultwarden-cli", () => {
  afterEach(() => {
    clearBwSessionProcessCache();
    vi.restoreAllMocks();
  });

  function makeDeps(/** @type {Record<string, unknown>} */ o = {}) {
    const capture = { log: [], warn: [], err: [] };
    /** @type {Record<string, { status: number; stdout?: string; stderr?: string }>} */
    const responses = {
      "--version": { status: 0, stdout: "2024.1.0" },
      "bw:--version": { status: 0, stdout: "2024.1.0" },
      "list organizations": {
        status: 0,
        stdout: JSON.stringify([{ id: ORG_ID, name: "HDC" }]),
      },
      [`list org-collections --organizationid ${ORG_ID}`]: {
        status: 0,
        stdout: JSON.stringify([{ id: COLL_ID, name: "HDC" }]),
      },
      encode: { status: 0, stdout: ENCODED_PAYLOAD },
      ...(o.responses ?? {}),
    };
    const spawnSync = vi.fn((exe, args) => {
      const key = args.join(" ");
      const hit = responses[key] ?? responses[`bw:${key}`] ?? responses[`${exe}:${key}`];
      if (hit) {
        return {
          status: hit.status,
          stdout: hit.stdout ?? "",
          stderr: hit.stderr ?? "",
        };
      }
      return { status: 1, stdout: "", stderr: `unexpected: ${key}` };
    });
    return {
      env: {
        HDC_VAULTWARDEN_URL: "https://vault.example.test",
        HDC_VAULTWARDEN_EMAIL: "ops@example.test",
        HDC_VAULTWARDEN_ORGANIZATION_ID: ORG_ID,
        HDC_VAULTWARDEN_COLLECTION_ID: COLL_ID,
        ...(o.envVars ?? {}),
      },
      log: (...a) => capture.log.push(a.join(" ")),
      error: (...a) => capture.err.push(a.join(" ")),
      warn: (...a) => capture.warn.push(a.join(" ")),
      readLineQuestion: o.readLineQuestion ?? (async () => ""),
      spawnSync,
      _capture: capture,
    };
  }

  it("resolveBwExecutable finds bw via --version", () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
      },
    });
    expect(resolveBwExecutable(deps)).toBe("bw");
  });

  describe("Windows bw resolution", () => {
    const PATH_DIR = join("C:", "tools", "bin");
    const NPM_DIR = join("C:", "Users", "u", "AppData", "Roaming", "npm");
    const LOCAL = join("C:", "Users", "u", "AppData", "Local");
    const BW_JS = join(NPM_DIR, "node_modules/@bitwarden/cli/build/bw.js");
    const BW_CMD = join(NPM_DIR, "bw.cmd");

    function winDeps(/** @type {string[]} */ files, /** @type {Record<string, unknown>} */ o = {}) {
      const deps = makeDeps({
        ...o,
        envVars: { Path: [PATH_DIR, NPM_DIR].join(delimiter), APPDATA: join(NPM_DIR, ".."), LOCALAPPDATA: LOCAL, ...(o.envVars ?? {}) },
      });
      const set = new Set(files);
      return { ...deps, platform: "win32", existsSync: (/** @type {string} */ f) => set.has(f) };
    }

    it("prefers native bw.exe on PATH over npm bw.js / bw.cmd", () => {
      const exe = join(PATH_DIR, "bw.exe");
      const deps = winDeps([exe, BW_JS, BW_CMD]);
      expect(resolveBwCommand(deps)).toEqual({ command: exe, prefixArgs: [] });
    });

    it("finds winget Links bw.exe when not on PATH", () => {
      const exe = join(LOCAL, "Microsoft/WinGet/Links/bw.exe");
      const deps = winDeps([exe, BW_CMD]);
      expect(resolveBwCommand(deps).command).toBe(exe);
    });

    it("falls back to node + npm bw.js when no bw.exe exists", () => {
      const deps = winDeps([BW_JS, BW_CMD], { responses: { [`${BW_JS} --version`]: { status: 0 } } });
      expect(resolveBwCommand(deps)).toEqual({ command: process.execPath, prefixArgs: [BW_JS] });
    });

    it("runs a bare .cmd shim via shell with quoted args and password only in env", async () => {
      const shim = join("C:", "Program Files", "bw", "bw.cmd");
      const deps = winDeps([shim], {
        envVars: { HDC_BW_EXECUTABLE: shim },
        responses: {
          "config server https://vault.example.test": { status: 0 },
          "login --check": { status: 1 },
          "login ops@example.test --passwordenv BW_PASSWORD --raw": { status: 0 },
          "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "session-cmd" },
          [`list items --collectionid ${COLL_ID}`]: { status: 0, stdout: "[]" },
        },
      });
      expect(resolveBwCommand(deps)).toEqual({ command: shim, prefixArgs: [], shell: true });
      const session = await ensureBwUnlocked(deps, vi.fn(async () => "master pass&x"), vi.fn(async () => {}));
      expect(session).toBe("session-cmd");
      for (const [cmd, args, opts] of deps.spawnSync.mock.calls) {
        expect(cmd).toBe(`"${shim}"`);
        expect(opts.shell).toBe(true);
        expect(args.join(" ")).not.toContain("master pass");
      }
      const loginCall = deps.spawnSync.mock.calls.find((c) => c[1][0] === "login" && c[1][1] === "ops@example.test");
      expect(loginCall?.[2].env.BW_PASSWORD).toBe("master pass&x");
    });

    it("warns and auto-detects when HDC_BW_EXECUTABLE is missing", () => {
      const exe = join(PATH_DIR, "bw.exe");
      const deps = winDeps([exe], { envVars: { HDC_BW_EXECUTABLE: join(NPM_DIR, "missing", "bw.cmd") } });
      expect(resolveBwCommand(deps).command).toBe(exe);
      expect(deps._capture.warn.some((m) => m.includes("HDC_BW_EXECUTABLE not found"))).toBe(true);
    });

    it("uses a PATH bw.cmd via shell as last resort", () => {
      const deps = winDeps([BW_CMD]);
      expect(resolveBwCommand(deps)).toEqual({ command: BW_CMD, prefixArgs: [], shell: true });
    });
  });

  it("quoteCmdArg quotes spaces/metacharacters and rejects unsafe characters", () => {
    expect(quoteCmdArg("list")).toBe("list");
    expect(quoteCmdArg("a b&c")).toBe('"a b&c"');
    expect(() => quoteCmdArg("100%")).toThrow(/bw\.exe/);
    expect(() => quoteCmdArg('say "hi"')).toThrow();
  });

  it("resolveBwOrganizationId trusts env id without list organizations", () => {
    const deps = makeDeps({ responses: {} });
    expect(resolveBwOrganizationId(deps, "sess")).toBe(ORG_ID);
    expect(deps.spawnSync.mock.calls.some((c) => c[1]?.[1] === "organizations")).toBe(false);
  });

  it("resolveBwOrganizationId resolves by name when env unset", () => {
    const deps = makeDeps({
      envVars: {
        HDC_VAULTWARDEN_ORGANIZATION_ID: "",
        HDC_VAULTWARDEN_ORGANIZATION_NAME: "HDC",
      },
      responses: {
        "list organizations": {
          status: 0,
          stdout: JSON.stringify([{ id: ORG_ID, name: "HDC" }, { id: "other", name: "Other" }]),
        },
      },
    });
    expect(resolveBwOrganizationId(deps, "sess")).toBe(ORG_ID);
  });

  it("resolveBwCollectionId trusts env id without list org-collections", () => {
    const deps = makeDeps({ responses: {} });
    expect(resolveBwCollectionId(deps, "sess", ORG_ID)).toBe(COLL_ID);
    expect(deps.spawnSync.mock.calls.some((c) => c[1]?.[1] === "org-collections")).toBe(false);
  });

  it("ensureBwUnlocked uses stored master password and caches session", async () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "config server https://vault.example.test": { status: 0 },
        "login --check": { status: 0 },
        "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "session-key-1" },
        [`list items --collectionid ${COLL_ID}`]: { status: 0, stdout: "[]" },
      },
    });
    const readLocal = vi.fn(async () => "master-pass");
    const writeLocal = vi.fn(async () => {});
    const s1 = await ensureBwUnlocked(deps, readLocal, writeLocal);
    const s2 = await ensureBwUnlocked(deps, readLocal, writeLocal);
    expect(s1).toBe("session-key-1");
    expect(s2).toBe("session-key-1");
    expect(readLocal).toHaveBeenCalledTimes(1);
  });

  it("ensureBwUnlocked uses API key login when client id and secret are set", async () => {
    /** @type {NodeJS.ProcessEnv[]} */
    const apiLoginEnvs = [];
    const deps = makeDeps({
      envVars: {
        HDC_VAULTWARDEN_URL: "https://vault.example.test",
        HDC_VAULTWARDEN_KEY_CLIENT_ID: "user.test-client-id",
        HDC_VAULTWARDEN_KEY_CLIENT_SECRET: "test-client-secret",
        HDC_VAULTWARDEN_ORGANIZATION_ID: ORG_ID,
        HDC_VAULTWARDEN_COLLECTION_ID: COLL_ID,
      },
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "config server https://vault.example.test": { status: 0 },
        "login --check": { status: 1 },
        "login --apikey": { status: 0 },
        "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "apikey-session" },
        [`list items --collectionid ${COLL_ID}`]: { status: 0, stdout: "[]" },
      },
    });
    const origSpawn = deps.spawnSync;
    deps.spawnSync = vi.fn((exe, args, opts) => {
      const key = args.join(" ");
      if (key === "login --apikey") {
        apiLoginEnvs.push({ ...(opts?.env ?? {}) });
      }
      return origSpawn(exe, args, opts);
    });
    const readLocal = vi.fn(async (k) => {
      if (k === "HDC_VAULTWARDEN_MASTER_PASSWORD") return "master-pass";
      return null;
    });
    const writeLocal = vi.fn(async () => {});
    const session = await ensureBwUnlocked(deps, readLocal, writeLocal);
    expect(session).toBe("apikey-session");
    expect(apiLoginEnvs.length).toBe(1);
    expect(apiLoginEnvs[0].BW_CLIENTID).toBe("user.test-client-id");
    expect(apiLoginEnvs[0].BW_CLIENTSECRET).toBe("test-client-secret");
    const emailLoginCalls = deps.spawnSync.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1][0] === "login" && c[1][1] !== "--check" && c[1][1] !== "--apikey",
    );
    expect(emailLoginCalls.length).toBe(0);
    expect(deps._capture.log.some((m) => m.includes("logging in with API key"))).toBe(true);
  });

  it("resolveBwCommand caches result across spawns", () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
      },
    });
    resolveBwCommand(deps);
    resolveBwCommand(deps);
    const versionCalls = deps.spawnSync.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1].includes("--version"),
    );
    expect(versionCalls.length).toBe(1);
  });

  it("ensureBwUnlocked reuses valid BW_SESSION from environment", async () => {
    const deps = makeDeps({
      envVars: { BW_SESSION: "inherited-session" },
      responses: {
        "config server https://vault.example.test": { status: 0 },
        [`list items --collectionid ${COLL_ID}`]: { status: 0, stdout: "[]" },
      },
    });
    const readLocal = vi.fn(async () => null);
    const writeLocal = vi.fn(async () => {});
    const session = await ensureBwUnlocked(deps, readLocal, writeLocal);
    expect(session).toBe("inherited-session");
    expect(deps.spawnSync.mock.calls.some((c) => c[1]?.[0] === "unlock")).toBe(false);
    expect(readLocal).not.toHaveBeenCalled();
  });

  it("ensureBwUnlocked omits stale BW_SESSION from env during password unlock", async () => {
    /** @type {NodeJS.ProcessEnv[]} */
    const unlockEnvs = [];
    let listItemsCalls = 0;
    const deps = makeDeps({
      envVars: { BW_SESSION: "expired-session" },
      responses: {
        "config server https://vault.example.test": { status: 0 },
        "login --check": { status: 0 },
        "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "fresh-session" },
      },
    });
    const origSpawn = deps.spawnSync;
    deps.spawnSync = vi.fn((exe, args, opts) => {
      const key = args.join(" ");
      if (key === `list items --collectionid ${COLL_ID}`) {
        listItemsCalls += 1;
        if (listItemsCalls === 1) {
          return { status: 1, stdout: "", stderr: "invalid session" };
        }
        return { status: 0, stdout: "[]" };
      }
      if (Array.isArray(args) && args[0] === "unlock") {
        unlockEnvs.push({ ...(opts?.env ?? {}) });
      }
      return origSpawn(exe, args, opts);
    });
    const readLocal = vi.fn(async () => "master-pass");
    const writeLocal = vi.fn(async () => {});
    const session = await ensureBwUnlocked(deps, readLocal, writeLocal);
    expect(session).toBe("fresh-session");
    expect(unlockEnvs.length).toBeGreaterThan(0);
    expect(unlockEnvs[0].BW_SESSION).toBeUndefined();
    expect(unlockEnvs[0].BW_PASSWORD).toBe("master-pass");
  });

  it("bwGetPassword reads password from list items without get password spawn", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "item-1",
              name: "HDC_X",
              organizationId: ORG_ID,
              login: { username: "HDC_X", password: "embedded-secret", uris: [] },
            },
          ]),
        },
      },
    });
    expect(bwGetPassword(deps, "sess", "HDC_X")).toBe("embedded-secret");
    expect(deps.spawnSync.mock.calls.some((c) => c[1]?.[0] === "get" && c[1]?.[1] === "password")).toBe(
      false,
    );
  });

  it("bwGetLoginCredentials returns username and password from login item", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "item-mc",
              name: "HDC_MESHCENTRAL_USER",
              organizationId: ORG_ID,
              login: { username: "mc-admin", password: "mc-pass", uris: [] },
            },
          ]),
        },
      },
    });
    expect(bwGetLoginCredentials(deps, "sess", "HDC_MESHCENTRAL_USER")).toEqual({
      username: "mc-admin",
      password: "mc-pass",
    });
  });

  it("bwGetLoginCredentials returns null when username missing", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "item-mc",
              name: "HDC_MESHCENTRAL_USER",
              organizationId: ORG_ID,
              login: { username: "", password: "mc-pass", uris: [] },
            },
          ]),
        },
      },
    });
    expect(bwGetLoginCredentials(deps, "sess", "HDC_MESHCENTRAL_USER")).toBeNull();
  });

  it("bwReadOrgSecrets bulk-reads from list items without per-item get password", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([
            {
              id: "item-a",
              name: "HDC_A",
              organizationId: ORG_ID,
              login: { username: "HDC_A", password: "secret-a", uris: [] },
            },
            {
              id: "item-b",
              name: "HDC_B",
              organizationId: ORG_ID,
              login: { username: "HDC_B", password: "secret-b", uris: [] },
            },
          ]),
        },
      },
    });
    expect(bwReadOrgSecrets(deps, "sess")).toEqual({ HDC_A: "secret-a", HDC_B: "secret-b" });
    const getPasswordCalls = deps.spawnSync.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1][0] === "get" && c[1][1] === "password",
    );
    expect(getPasswordCalls.length).toBe(0);
    const listCalls = deps.spawnSync.mock.calls.filter(
      (c) => Array.isArray(c[1]) && c[1][0] === "list" && c[1][1] === "items",
    );
    expect(listCalls.length).toBe(1);
  });

  it("bwGetPassword returns org item password by id", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([{ id: "item-1", name: "HDC_X", organizationId: ORG_ID }]),
        },
        "get password item-1": { status: 0, stdout: "secret-value" },
      },
    });
    expect(bwGetPassword(deps, "sess", "HDC_X")).toBe("secret-value");
  });

  it("bwGetPassword returns null when login item has no password", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([
            { id: "item-empty", name: "HDC_ADMIN_USER_PASSWORD", organizationId: ORG_ID },
          ]),
        },
        "get password item-empty": {
          status: 1,
          stderr: "No password available for this login.",
        },
        "get item item-empty": {
          status: 0,
          stdout: JSON.stringify({
            id: "item-empty",
            name: "HDC_ADMIN_USER_PASSWORD",
            organizationId: ORG_ID,
            login: { username: "HDC_ADMIN_USER_PASSWORD", password: "", uris: [] },
          }),
        },
      },
    });
    expect(bwGetPassword(deps, "sess", "HDC_ADMIN_USER_PASSWORD")).toBeNull();
  });

  it("bwGetPassword falls back to secure note body when password command fails", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([{ id: "item-note", name: "HDC_NOTE", organizationId: ORG_ID }]),
        },
        "get password item-note": {
          status: 1,
          stderr: "No password available for this login.",
        },
        "get item item-note": {
          status: 0,
          stdout: JSON.stringify({
            id: "item-note",
            name: "HDC_NOTE",
            organizationId: ORG_ID,
            type: 2,
            notes: "note-secret",
          }),
        },
      },
    });
    expect(bwGetPassword(deps, "sess", "HDC_NOTE")).toBe("note-secret");
  });

  it("bwSetPassword creates org login item and assigns collection", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: { status: 0, stdout: "[]" },
        "list items --search HDC_Y": { status: 0, stdout: "[]" },
        [`create item ${ENCODED_PAYLOAD}`]: {
          status: 0,
          stdout: JSON.stringify({ id: "item-new", name: "HDC_Y", organizationId: ORG_ID }),
        },
      },
    });
    bwSetPassword(deps, "sess", "HDC_Y", "new-secret");
    const createCall = deps.spawnSync.mock.calls.find(
      (c) => Array.isArray(c[1]) && c[1][0] === "create" && c[1][1] === "item",
    );
    expect(createCall).toBeDefined();
    expect(createCall[1]).toContain(ENCODED_PAYLOAD);
  });

  it("bwSetPassword updates existing org login item via encoded JSON edit", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([{ id: "item-z", name: "HDC_Z", organizationId: ORG_ID }]),
        },
        "get item item-z": {
          status: 0,
          stdout: JSON.stringify({
            id: "item-z",
            name: "HDC_Z",
            organizationId: ORG_ID,
            login: { username: "HDC_Z", password: "old-secret", uris: [] },
          }),
        },
        [`edit item item-z ${ENCODED_PAYLOAD}`]: { status: 0 },
      },
    });
    bwSetPassword(deps, "sess", "HDC_Z", "new-secret");
    const editCall = deps.spawnSync.mock.calls.find(
      (c) => Array.isArray(c[1]) && c[1][0] === "edit" && c[1][1] === "item" && c[1][2] === "item-z",
    );
    expect(editCall).toBeDefined();
    expect(editCall[1]).toContain(ENCODED_PAYLOAD);
  });

  it("bwListItemNames lists organization items only", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([
            { id: "a", name: "HDC_B", organizationId: ORG_ID },
            { id: "b", name: "HDC_A", organizationId: ORG_ID },
          ]),
        },
      },
    });
    expect(bwListItemNames(deps, "sess")).toEqual(["HDC_A", "HDC_B"]);
  });

  it("normalizeLoginUris deduplicates and formats Bitwarden uri objects", () => {
    expect(normalizeLoginUris(["https://a.example", "https://a.example", "https://b.example"])).toEqual([
      { uri: "https://a.example", match: null },
      { uri: "https://b.example", match: null },
    ]);
  });

  it("bwSetPassword passes uris on create", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: { status: 0, stdout: "[]" },
        "list items --search HDC_URI": { status: 0, stdout: "[]" },
        [`create item ${ENCODED_PAYLOAD}`]: {
          status: 0,
          stdout: JSON.stringify({ id: "item-uri", name: "HDC_URI", organizationId: ORG_ID }),
        },
      },
    });
    bwSetPassword(deps, "sess", "HDC_URI", "secret", {
      uris: ["https://svc.example", "http://192.0.2.1:8080"],
    });
    expect(deps.spawnSync.mock.calls.some((c) => c[1]?.[0] === "create")).toBe(true);
  });

  it("bwUpdateLoginUris replaces login uris on edit", () => {
    const deps = makeDeps({
      responses: {
        [`list items --collectionid ${COLL_ID}`]: {
          status: 0,
          stdout: JSON.stringify([{ id: "item-u", name: "HDC_U", organizationId: ORG_ID }]),
        },
        "get item item-u": {
          status: 0,
          stdout: JSON.stringify({
            id: "item-u",
            name: "HDC_U",
            organizationId: ORG_ID,
            login: {
              username: "HDC_U",
              password: "pw",
              uris: [{ uri: "https://old.example", match: null }],
            },
          }),
        },
        [`edit item item-u ${ENCODED_PAYLOAD}`]: { status: 0 },
      },
    });
    bwUpdateLoginUris(deps, "sess", "HDC_U", ["https://new.example"]);
    const editCall = deps.spawnSync.mock.calls.find(
      (c) => Array.isArray(c[1]) && c[1][0] === "edit" && c[1][1] === "item" && c[1][2] === "item-u",
    );
    expect(editCall).toBeDefined();
  });
});
