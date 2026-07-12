import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeVault } from "../vault.mjs";
import { clearVaultPassphraseProcessCache, createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { clearBwSessionProcessCache, vaultwardenCliDepsFromCli } from "./vaultwarden-cli.mjs";
import { parseSecretsSyncUrisArgv, syncVaultKeyUris } from "./vaultwarden-sync-uris.mjs";

const ORG_ID = "org-1111-aaaa-bbbb-cccc";
const COLL_ID = "coll-2222-dddd-eeee-ffff";

describe("vaultwarden-sync-uris", () => {
  afterEach(() => {
    clearVaultPassphraseProcessCache();
    clearBwSessionProcessCache();
    vi.restoreAllMocks();
  });

  it("parseSecretsSyncUrisArgv reads flags", () => {
    expect(parseSecretsSyncUrisArgv(["--dry-run", "--force", "--key", "HDC_X"])).toEqual({
      dryRun: true,
      force: true,
      keyFilter: "HDC_X",
    });
  });

  it("syncVaultKeyUris skips keys without resolved URLs", async () => {
    const root = mkdtempSync(join(tmpdir(), "hdc-sync-uris-"));
    try {
      writeVault(join(root, "vault.enc"), "pw", {
        HDC_VAULTWARDEN_MASTER_PASSWORD: "master-pass",
      });
      const spawnSync = vi.fn((exe, args) => {
        const key = args.join(" ");
        const responses = {
          "--version": { status: 0, stdout: "2024.1.0" },
          "bw:--version": { status: 0, stdout: "2024.1.0" },
          "config server https://vault.example.test": { status: 0 },
          "login --check": { status: 0 },
          "unlock --passwordenv BW_PASSWORD --raw": { status: 0, stdout: "session-key" },
          "list organizations": {
            status: 0,
            stdout: JSON.stringify([{ id: ORG_ID, name: "HDC" }]),
          },
          [`list org-collections --organizationid ${ORG_ID}`]: {
            status: 0,
            stdout: JSON.stringify([{ id: COLL_ID, name: "HDC" }]),
          },
          [`list items --collectionid ${COLL_ID}`]: {
            status: 0,
            stdout: JSON.stringify([
              {
                id: "item-cf",
                name: "HDC_CLOUDFLARE_API_TOKEN",
                organizationId: ORG_ID,
                login: { password: "x", uris: [] },
              },
            ]),
          },
        };
        const hit = responses[key] ?? responses[`bw:${key}`];
        if (hit) return { status: hit.status, stdout: hit.stdout ?? "", stderr: "" };
        return { status: 1, stdout: "", stderr: `unexpected: ${key}` };
      });
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
      const vwCli = vaultwardenCliDepsFromCli(deps, spawnSync);
      const result = await syncVaultKeyUris(access, vwCli, {
        publicRoot: root,
        keyFilter: "HDC_CLOUDFLARE_API_TOKEN",
      });
      expect(result.skipped).toBe(1);
      expect(capture.log.some((l) => l.includes("no HDC URL"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
