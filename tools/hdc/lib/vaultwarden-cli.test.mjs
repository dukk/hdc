import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bwGetPassword,
  bwListItemNames,
  bwSetPassword,
  clearBwSessionProcessCache,
  ensureBwUnlocked,
  resolveBwCollectionId,
  resolveBwExecutable,
  resolveBwOrganizationId,
} from "./vaultwarden-cli.mjs";

const ORG_ID = "org-1111-aaaa-bbbb-cccc";
const COLL_ID = "coll-2222-dddd-eeee-ffff";

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
      [`list org-collections --organizationid ${ORG_ID}`]: {
        status: 0,
        stdout: JSON.stringify([{ id: COLL_ID, name: "HDC" }]),
      },
      encode: { status: 0, stdout: "encoded-collection-ids" },
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

  it("resolveBwOrganizationId uses env when set", () => {
    const deps = makeDeps();
    expect(resolveBwOrganizationId(deps, "sess")).toBe(ORG_ID);
    expect(deps.spawnSync).not.toHaveBeenCalled();
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

  it("resolveBwCollectionId validates collection in org", () => {
    const deps = makeDeps();
    expect(resolveBwCollectionId(deps, "sess", ORG_ID)).toBe(COLL_ID);
  });

  it("ensureBwUnlocked uses stored master password and caches session", async () => {
    const deps = makeDeps({
      responses: {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "config server https://vault.example.test": { status: 0 },
        "login --check": { status: 0 },
        "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "session-key-1" },
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

  it("bwGetPassword returns org item password by id", () => {
    const deps = makeDeps({
      responses: {
        [`list items --search HDC_X --organizationid ${ORG_ID}`]: {
          status: 0,
          stdout: JSON.stringify([{ id: "item-1", name: "HDC_X", organizationId: ORG_ID }]),
        },
        "get password item-1": { status: 0, stdout: "secret-value" },
      },
    });
    expect(bwGetPassword(deps, "sess", "HDC_X")).toBe("secret-value");
  });

  it("bwSetPassword creates org login item and assigns collection", () => {
    const deps = makeDeps({
      responses: {
        [`list items --search HDC_Y --organizationid ${ORG_ID}`]: { status: 0, stdout: "[]" },
        "list items --search HDC_Y": { status: 0, stdout: "[]" },
        [`create item login --name HDC_Y --username HDC_Y --password new-secret --organizationid ${ORG_ID}`]: {
          status: 0,
          stdout: JSON.stringify({ id: "item-new", name: "HDC_Y", organizationId: ORG_ID }),
        },
        [`edit item-collections item-new encoded-collection-ids --organizationid ${ORG_ID}`]: { status: 0 },
      },
    });
    bwSetPassword(deps, "sess", "HDC_Y", "new-secret");
    expect(deps.spawnSync).toHaveBeenCalled();
  });

  it("bwListItemNames lists organization items only", () => {
    const deps = makeDeps({
      responses: {
        [`list items --organizationid ${ORG_ID}`]: {
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
});
