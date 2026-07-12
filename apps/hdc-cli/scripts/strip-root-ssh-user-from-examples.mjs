import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.name === "config.example.json") out.push(p);
  }
  return out;
}

for (const file of walk(path.join(repoRoot, "clumps"))) {
  const src = fs.readFileSync(file, "utf8");
  const next = src
    .replace(/\r?\n\s*"user": "root",?\r?\n/g, "\n")
    .replace(/"user": "root", /g, "")
    .replace(/, "user": "root"/g, "");
  if (next !== src) {
    fs.writeFileSync(file, next);
    console.log("updated", path.relative(repoRoot, file));
  }
}
