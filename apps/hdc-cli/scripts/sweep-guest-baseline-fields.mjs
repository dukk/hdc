import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const clumpsRoot = path.join(repoRoot, "clumps");

const blockRe =
  /(\n\s*)guest_resources: baseline\.guest_resources,\s*\n\s*admin_user: baseline\.admin_user,\s*\n\s*clamav: baseline\.clamav,/g;

const adminClamavRe =
  /(\n\s*)admin_user: baseline\.admin_user,\s*\n\s*clamav: baseline\.clamav,/g;

const okRe =
  /ok: baseline\.admin_user\?\.ok !== false,/g;

/** @param {string} file */
function relImport(file, target) {
  const dir = path.dirname(file);
  let rel = path.relative(dir, target).replace(/\\/g, "/");
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

const reportPath = path.join(clumpsRoot, "lib/guest-baseline-report.mjs");
/** @type {string[]} */
const changed = [];

for (const file of walk(clumpsRoot)) {
  if (file === reportPath) continue;
  let src = fs.readFileSync(file, "utf8");
  let next = src
    .replace(blockRe, "$1...guestBaselineResultFields(baseline),")
    .replace(adminClamavRe, "$1...guestBaselineResultFields(baseline),")
    .replace(okRe, "ok: guestBaselineUsersOk(baseline),");
  if (next === src) continue;
  if (!next.includes("guest-baseline-report.mjs")) {
    const imp = relImport(file, reportPath);
    const importLine = `import { guestBaselineResultFields, guestBaselineUsersOk } from "${imp}";\n`;
    const existing = next.match(
      /import \{([^}]*)\} from "[^"]*guest-baseline-report\.mjs";/,
    );
    if (existing) {
      let names = existing[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const n of ["guestBaselineResultFields", "guestBaselineUsersOk"]) {
        if (!names.includes(n)) names.push(n);
      }
      next = next.replace(
        existing[0],
        `import { ${names.join(", ")} } from "${imp}";`,
      );
    } else {
      const m = next.match(/^(import .+\n)+/);
      if (m) next = next.replace(m[0], `${m[0]}${importLine}`);
      else next = `${importLine}${next}`;
    }
  }
  fs.writeFileSync(file, next);
  changed.push(path.relative(repoRoot, file).replace(/\\/g, "/"));
}

console.log(`changed ${changed.length}`);
for (const f of changed) console.log(f);
