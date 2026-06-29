import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isolatedPrivateRoot = mkdtempSync(join(tmpdir(), "hdc-vitest-no-private-"));
process.env.HDC_PRIVATE_ROOT = isolatedPrivateRoot;
process.env.HDC_SECRET_BACKEND = "local";
delete process.env.HDC_VAULT_PASSPHRASE;
delete process.env.HDC_VAULTWARDEN_URL;
delete process.env.HDC_VAULTWARDEN_EMAIL;
