import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packagesRoot = path.join(repoRoot, "packages");

const patterns = [
  [
    /typeof ssh\.user === "string" && ssh\.user\.trim\(\) \? ssh\.user\.trim\(\) : "root"/g,
    "resolveGuestSshUser(ssh.user)",
  ],
  [
    /typeof ssh\.user === "string" \? ssh\.user\.trim\(\) : "root"/g,
    "resolveGuestSshUser(ssh.user)",
  ],
  [/typeof ssh\.user === "string" \? ssh\.user : "root"/g, "resolveGuestSshUser(ssh.user)"],
  [
    /typeof sshCfg\.user === "string" && sshCfg\.user\.trim\(\) \? sshCfg\.user\.trim\(\) : "root"/g,
    "resolveGuestSshUser(sshCfg.user)",
  ],
  [
    /typeof target\.user === "string" && target\.user\.trim\(\) \? target\.user\.trim\(\) : "root"/g,
    "resolveGuestSshUser(target.user)",
  ],
];

/** @param {string} file */
function relImport(file) {
  const dir = path.dirname(file);
  let rel = path.relative(dir, path.join(packagesRoot, "lib/guest-ssh-resolve.mjs")).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

const skip = new Set([
  path.join(packagesRoot, "lib/guest-ssh-resolve.mjs"),
  path.join(packagesRoot, "lib/guest-ssh-exec.mjs"),
]);

/** @type {string[]} */
const changed = [];

for (const file of walk(packagesRoot)) {
  if (skip.has(file)) continue;
  let src = fs.readFileSync(file, "utf8");
  let next = src;
  for (const [re, rep] of patterns) next = next.replace(re, rep);
  if (next === src) continue;
  if (!next.includes("resolveGuestSshUser")) continue;
  if (!next.includes("guest-ssh-resolve.mjs")) {
    const imp = relImport(file);
    const importLine = `import { resolveGuestSshUser } from "${imp}";\n`;
    const m = next.match(/^(import .+\n)+/);
    if (m) next = next.replace(m[0], `${m[0]}${importLine}`);
    else next = `${importLine}${next}`;
  }
  fs.writeFileSync(file, next);
  changed.push(path.relative(repoRoot, file).replace(/\\/g, "/"));
}

console.log(`changed ${changed.length}`);
for (const f of changed) console.log(f);
