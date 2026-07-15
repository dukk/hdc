#!/usr/bin/env node
/**
 * Generate clumps/lib re-export shims pointing at apps/hdc-cli/lib/package/.
 * Keeps legacy ../../../lib/ imports working until clump codemod completes.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageDir = join(root, "apps", "hdc-cli", "lib", "package");
const shimDir = join(root, "clumps", "lib");

/** @param {string} dir */
function walkMjs(dir, base = dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkMjs(p, base));
    else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

for (const src of walkMjs(packageDir)) {
  const relFromPackage = relative(packageDir, src).replace(/\\/g, "/");
  const shimPath = join(shimDir, relFromPackage);
  mkdirSync(dirname(shimPath), { recursive: true });
  const relToPackage = relative(dirname(shimPath), src).replace(/\\/g, "/");
  const importPath = relToPackage.startsWith(".") ? relToPackage : `./${relToPackage}`;
  const content = `/** @deprecated Import from hdc/package/${relFromPackage} */\nexport * from "${importPath}";\n`;
  writeFileSync(shimPath, content, "utf8");
  console.error(`shim ${relFromPackage}`);
}

// clients tier shims at clumps/clients/lib
const clientsShimDir = join(root, "clumps", "clients", "lib");
const clientsPackageDir = join(packageDir, "clients");
mkdirSync(clientsShimDir, { recursive: true });
for (const src of walkMjs(clientsPackageDir)) {
  const relFromPackage = relative(clientsPackageDir, src).replace(/\\/g, "/");
  const shimPath = join(clientsShimDir, relFromPackage);
  mkdirSync(dirname(shimPath), { recursive: true });
  const relToPackage = relative(dirname(shimPath), src).replace(/\\/g, "/");
  const importPath = relToPackage.startsWith(".") ? relToPackage : `./${relToPackage}`;
  writeFileSync(
    shimPath,
    `/** @deprecated Import from hdc/package/clients/${relFromPackage} */\nexport * from "${importPath}";\n`,
    "utf8",
  );
  console.error(`shim clients/${relFromPackage}`);
}
