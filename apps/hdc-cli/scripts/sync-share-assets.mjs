/**
 * Sync platform share assets into apps/hdc-cli/share/ for npm publish.
 * Run from repo root or apps/hdc-cli before `npm publish`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cliDir = dirname(fileURLToPath(import.meta.url)); // .../scripts
const packageRoot = join(cliDir, "..");
const hdcRoot = join(packageRoot, "..", "..");
const shareRoot = join(packageRoot, "share");

/** @type {{ src: string; dest: string }[]} */
const ASSETS = [
  { src: ".env.example", dest: ".env.example" },
  { src: join(".hdc", "clumps-repos.json"), dest: join(".hdc", "clumps-repos.json") },
  {
    src: join("operations", "inventory", "systems", "_example.json"),
    dest: join("operations", "inventory", "systems", "_example.json"),
  },
];

function ensureDirFor(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

let ok = 0;
for (const { src, dest } of ASSETS) {
  const from = join(hdcRoot, src);
  const to = join(shareRoot, dest);
  if (!existsSync(from)) {
    console.error(`sync-share-assets: missing source ${from}`);
    process.exit(1);
  }
  ensureDirFor(to);
  copyFileSync(from, to);
  console.error(`sync-share-assets: ${src} → share/${dest.replace(/\\/g, "/")}`);
  ok++;
}

// Marker so packaged consumers can detect share layout
writeFileSync(
  join(shareRoot, ".hdc-share-version"),
  `${JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version || "0"}\n`,
  "utf8",
);

console.error(`sync-share-assets: synced ${ok} asset(s)`);
