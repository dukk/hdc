import { mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const isolatedPrivateRoot = mkdtempSync(join(tmpdir(), "hdc-vitest-no-private-"));
process.env.HDC_PRIVATE_ROOT = isolatedPrivateRoot;
process.env.HDC_SECRET_BACKEND = "local";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const siblingClumps = join(repoRoot, "..", "hdc-clumps");
process.env.HDC_CLUMPS_ROOT = siblingClumps;
delete process.env.HDC_VAULT_PASSPHRASE;
delete process.env.HDC_VAULTWARDEN_URL;
delete process.env.HDC_VAULTWARDEN_EMAIL;
