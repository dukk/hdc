#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "packages", "infrastructure", "proxmox", "lib");

const labels = {
  "proxmox-api-token-maintain.mjs": "API token maintain",
  "proxmox-apt-sources-maintain.mjs": "APT sources maintain",
  "proxmox-host-firewall-maintain.mjs": "Host firewall maintain",
  "proxmox-host-load-report.mjs": "Host load report",
  "proxmox-local-lvm-maintain.mjs": "Local LVM maintain",
  "proxmox-maintain-templates.mjs": "Template maintain",
  "proxmox-oem-windows-license.mjs": "OEM Windows license",
  "proxmox-qemu-guest-agent.mjs": "QEMU guest agent",
  "proxmox-storage-maintain.mjs": "Storage maintain",
};

for (const [name, label] of Object.entries(labels)) {
  const path = join(libDir, name);
  let c = readFileSync(path, "utf8");
  if (c.includes("loadProxmoxMaintainConfig")) {
    console.log("skip", name);
    continue;
  }
  if (!c.includes('join(packageRoot, "config.json")')) {
    console.log("no join", name);
    continue;
  }
  if (!c.includes("loadProxmoxPackageConfig")) {
    c = c.replace(
      /import \{ existsSync, readFileSync \} from "node:fs";/,
      'import { existsSync, readFileSync } from "node:fs";\nimport { loadProxmoxMaintainConfig, tryLoadProxmoxPackageConfig } from "./proxmox-package-config.mjs";',
    );
  }
  const re =
    /const configPath = join\(packageRoot, "config\.json"\);[\s\S]*?cfg = JSON\.parse\(readFileSync\(configPath, "utf8"\)\);[\s\S]*?return \{ ok: (true|false) \};\s*\}/;
  const m = c.match(re);
  if (!m) {
    console.log("no block match", name);
    continue;
  }
  const okVal = m[1];
  const replacement = `const loaded = loadProxmoxMaintainConfig(packageRoot, warn, ${JSON.stringify(label)});
  if (!loaded) {
    return { ok: true };
  }
  const cfg = loaded.data;
  const configPath = loaded.path;`;
  c = c.replace(re, replacement);
  c = c.replace(
    /if \(!existsSync\(join\(packageRoot, "config\.json"\)\)\)/g,
    "!tryLoadProxmoxPackageConfig(packageRoot).ok",
  );
  writeFileSync(path, c, "utf8");
  console.log("patched", name);
}
