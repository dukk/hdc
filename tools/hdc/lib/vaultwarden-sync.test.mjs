import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeVault } from "../vault.mjs";
import { clearVaultPassphraseProcessCache, createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { clearBwSessionProcessCache } from "./vaultwarden-cli.mjs";
import { parseSecretsPushArgv, pushLocalSecretsToVaultwarden } from "./vaultwarden-sync.mjs";

const ORG_ID = "org-1111-aaaa-bbbb-cccc";
const COLL_ID = "coll-2222-dddd-eeee-ffff";

describe("vaultwarden-sync", () => {
  it("parseSecretsPushArgv defaults to skipExisting without force", () => {
    expect(parseSecretsPushArgv([])).toEqual({ dryRun: false, skipExisting: true, force: false });
    expect(parseSecretsPushArgv(["--force"])).toEqual({
      dryRun: false,
      skipExisting: false,
      force: true,
    });
    expect(parseSecretsPushArgv(["--dry-run"])).toEqual({
      dryRun: true,
      skipExisting: true,
      force: false,
    });
  });

  describe("pushLocalSecretsToVaultwarden", () => {
    let root = "";
    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
      root = "";
      clearVaultPassphraseProcessCache();
      clearBwSessionProcessCache();
      vi.restoreAllMocks();
    });

    function makeSpawn() {
      /** @type {Record<string, { status: number; stdout?: string; stderr?: string }>} */
      const responses = {
        "--version": { status: 0, stdout: "2024.1.0" },
        "bw:--version": { status: 0, stdout: "2024.1.0" },
        "config server https://vault.example.test": { status: 0 },
        "login --check": { status: 0 },
        "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "session-key" },
        [`list org-collections --organizationid ${ORG_ID}`]: {
          status: 0,
          stdout: JSON.stringify([{ id: COLL_ID, name: "HDC" }]),
        },
        encode: { status: 0, stdout: "encoded-collection-ids" },
        [`list items --search HDC_EXISTING --organizationid ${ORG_ID}`]: {
          status: 0,
          stdout: JSON.stringify([{ id: "item-1", name: "HDC_EXISTING", organizationId: ORG_ID }]),
        },
        [`list items --search HDC_NEW --organizationid ${ORG_ID}`]: { status: 0, stdout: "[]" },
        "list items --search HDC_NEW": { status: 0, stdout: "[]" },
        [`create item login --name HDC_NEW --username HDC_NEW --password new-val --organizationid ${ORG_ID}`]: {
          status: 0,
          stdout: JSON.stringify({ id: "item-new", name: "HDC_NEW", organizationId: ORG_ID }),
        },
        [`edit item-collections item-new encoded-collection-ids --organizationid ${ORG_ID}`]: { status: 0 },
      };
      return vi.fn((exe, args) => {
        const key = args.join(" ");
        const hit = responses[key] ?? responses[`bw:${key}`];
        if (hit) {
          return { status: hit.status, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
        }
        return { status: 1, stdout: "", stderr: `unexpected: ${key}` };
      });
    }

    it("dry-run lists keys without bw writes", async () => {
      root = mkdtempSync(join(tmpdir(), "hdc-sync-"));
      writeVault(join(root, "vault.enc"), "pw", {
        HDC_NEW: "new-val",
        HDC_EXISTING: "old-val",
        HDC_VAULTWARDEN_MASTER_PASSWORD: "master-pass",
      });
      const spawnSync = makeSpawn();
      const capture = { log: [], warn: [], err: [] };
      const deps = {
        env: {
          HDC_VAULT_PASSPHRASE: "pw",
          HDC_SECRET_BACKEND: "vaultwarden",
          HDC_VAULTWARDEN_URL: "https://vault.example.test",
          HDC_VAULTWARDEN_EMAIL: "ops@example.test",
          HDC_VAULTWARDEN_ORGANIZATION_ID: ORG_ID,
          HDC_VAULTWARDEN_COLLECTION_ID: COLL_ID,
        },
        log: (...a) => capture.log.push(a.join(" ")),
        error: (...a) => capture.err.push(a.join(" ")),
        warn: (...a) => capture.warn.push(a.join(" ")),
        defaultVaultPath: () => join(root, "vault.enc"),
        existsSync,
        readLineQuestion: async () => "",
        spawnSync,
      };
      const access = createVaultAccess(vaultDepsFromCli(deps));
      const vwCli = {
        env: deps.env,
        log: deps.log,
        error: deps.error,
        warn: deps.warn,
        readLineQuestion: deps.readLineQuestion,
        spawnSync,
      };
      const result = await pushLocalSecretsToVaultwarden(access, vwCli, { dryRun: true });
      expect(result.pushed).toBe(2);
      expect(result.pushedKeys).toEqual(["HDC_EXISTING", "HDC_NEW"]);
      expect(capture.log.some((l) => l.includes("[dry-run] would push HDC_NEW"))).toBe(true);
      expect(spawnSync).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(["create", "item"]),
      );
    });

    it("skipExisting skips keys already in organization", async () => {
      root = mkdtempSync(join(tmpdir(), "hdc-sync-"));
      writeVault(join(root, "vault.enc"), "pw", {
        HDC_EXISTING: "old-val",
        HDC_NEW: "new-val",
        HDC_VAULTWARDEN_MASTER_PASSWORD: "master-pass",
      });
      const spawnSync = makeSpawn();
      const capture = { log: [], warn: [], err: [] };
      const deps = {
        env: {
          HDC_VAULT_PASSPHRASE: "pw",
          HDC_SECRET_BACKEND: "vaultwarden",
          HDC_VAULTWARDEN_URL: "https://vault.example.test",
          HDC_VAULTWARDEN_EMAIL: "ops@example.test",
          HDC_VAULTWARDEN_ORGANIZATION_ID: ORG_ID,
          HDC_VAULTWARDEN_COLLECTION_ID: COLL_ID,
        },
        log: (...a) => capture.log.push(a.join(" ")),
        error: (...a) => capture.err.push(a.join(" ")),
        warn: (...a) => capture.warn.push(a.join(" ")),
        defaultVaultPath: () => join(root, "vault.enc"),
        existsSync,
        readLineQuestion: async () => "",
        spawnSync,
      };
      const access = createVaultAccess(vaultDepsFromCli(deps));
      const vwCli = {
        env: deps.env,
        log: deps.log,
        error: deps.error,
        warn: deps.warn,
        readLineQuestion: deps.readLineQuestion,
        spawnSync,
      };
      const result = await pushLocalSecretsToVaultwarden(access, vwCli, { skipExisting: true });
      expect(result.skipped).toBe(1);
      expect(result.skippedKeys).toEqual(["HDC_EXISTING"]);
      expect(result.pushed).toBe(1);
    });
  });
});
