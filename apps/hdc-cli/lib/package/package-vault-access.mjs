import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { stdin as input, stderr as errout, env } from "node:process";

import { createVaultAccess, vaultDepsFromCli } from "../vault-access.mjs";
import { readLineMasked } from "../readline-masked.mjs";
import { defaultVaultPath } from "../../vault.mjs";

/**
 * Vault access for clump scripts (masked prompts on stderr).
 * @returns {ReturnType<typeof createVaultAccess>}
 */
export function createPackageVaultAccess() {
  return createVaultAccess(
    vaultDepsFromCli({
      env,
      log: (...a) => errout.write(`${a.join(" ")}\n`),
      error: (...a) => errout.write(`${a.join(" ")}\n`),
      warn: (...a) => errout.write(`${a.join(" ")}\n`),
      defaultVaultPath,
      existsSync,
      readLineQuestion: async (q, opts) => {
        if (opts?.mask) {
          return readLineMasked(q, errout, input);
        }
        const rl = createInterface({ input, output: errout });
        try {
          return await rl.question(q);
        } finally {
          rl.close();
        }
      },
    }),
  );
}
