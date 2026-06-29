import {
  discoverManifests,
  envRequired,
  inventoryDocs,
  formatManifestServiceInvoke,
  manifestById,
  manifestByTierAndId,
  manifestId,
  manifestPlatforms,
  manifestRunTier,
  manifestServices,
  manifestTitle,
  canonicalRunTier,
  parseRunTier,
  resolveRunInvocation,
  runScriptDir,
  runTiersUsage,
  RUN_TIERS,
  verbSpec,
  VERBS,
} from "../manifests.mjs";
import { readVault, writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";
import { splitRunArgs } from "./split-run-args.mjs";
import { collectHdcEnvRows } from "./hdc-env-report.mjs";
import {
  bootstrapGlobalEnv,
  buildPackageRunEnv,
  collectGlobalEnvKeys,
  resolveEnvIncludes,
} from "./package-env.mjs";
import {
  clearVaultPassphraseProcessCache,
  createVaultAccess,
  vaultDepsFromCli,
} from "./vault-access.mjs";
import { runUsersBootstrapHdc } from "./users-bootstrap-hdc.mjs";
import { resolveRepoFile } from "./private-repo.mjs";
import {
  filterSecretsForExport,
  parseSecretsExportArgv,
  writeSecretExport,
} from "./secrets-export.mjs";
import { parseSecretsPushArgv, pushLocalSecretsToVaultwarden } from "./vaultwarden-sync.mjs";
import { resolveSecretBackendMode } from "./secret-backend.mjs";
import { vaultwardenCliDepsFromCli } from "./vaultwarden-cli.mjs";
import { isLocalOnlyVaultKey } from "./secret-backend.mjs";
import { cmdMaintainDaily } from "./daily-maintain.mjs";

/**
 * @typedef {{ hostname: string, ips: string[], platform: string, arch: string }} HostProbe
 */

/**
 * @typedef {object} CliDeps
 * @property {NodeJS.ProcessEnv} env
 * @property {(...args: unknown[]) => void} log
 * @property {(...args: unknown[]) => void} error
 * @property {(...args: unknown[]) => void} warn
 * @property {() => string} repoRoot
 * @property {(root: string) => string} packagesDir
 * @property {typeof import("node:path").join} join
 * @property {typeof import("node:path").resolve} resolve
 * @property {typeof import("node:path").isAbsolute} isAbsolute
 * @property {typeof import("node:path").relative} relative
 * @property {typeof import("node:fs").existsSync} existsSync
 * @property {typeof import("node:fs").readFileSync} readFileSync
 * @property {typeof import("node:child_process").spawnSync} spawnSync
 * @property {string} execPath
 * @property {(filePath: string, override?: boolean) => void} loadDotenv
 * @property {() => string} defaultVaultPath
 * @property {() => string} readStdinUtf8
 * @property {(q: string, opts?: { mask?: boolean }) => Promise<string>} readLineQuestion
 * @property {() => string} cliInvocationForHelp
 * @property {(s: string) => void} stdoutWrite
 * @property {() => HostProbe} hostProbe
 */

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @param {CliDeps} deps
 */
function helpExe(deps) {
  return deps.cliInvocationForHelp();
}

/**
 * Prefix for shell pipelines when the executable may contain spaces.
 * @param {CliDeps} deps
 */
function helpExeShell(deps) {
  const s = helpExe(deps);
  if (/[\s"'&|;<>()]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

/**
 * @param {CliDeps} deps
 */
function usage(deps) {
  const c = helpExe(deps);
  deps.log(`HDC — Home Data Center automation CLI

Usage:
  ${c} help [ <topic> ... ]
  ${c} list
  ${c} run <tier> <package> <verb> [-- <extra args...>]
  ${c} run <tier> <package> <platform> <verb> [-- <extra args...>]   # when manifest lists "platforms"
  ${c} secrets path
  ${c} secrets init   # new vault: passphrase prompt, or HDC_VAULT_PASSPHRASE once
  ${c} secrets change-passphrase
  ${c} secrets set <ENV_NAME> [--stdin | --value <s>]
  ${c} secrets delete <ENV_NAME>
  ${c} secrets list
  ${c} secrets get <ENV_NAME> --out <path>
  ${c} secrets dump --out-dir <dir> [--format files|env|json]
  ${c} secrets unlock   # pre-unlock Vaultwarden when HDC_SECRET_BACKEND uses it
  ${c} secrets push [--dry-run] [--skip-existing] [--force]   # local vault -> Vaultwarden HDC org
  ${c} users bootstrap-hdc [--dry-run] [--sidecar <path> ...]
  ${c} maintain daily [--dry-run] [--skip-clients] [--skip-upgrades] [--only <tier>/<id>] [--skip <tier>/<id>] [--no-report] [--report <path>]
  ${c} env              # HDC_* variables (secrets redacted)

verbs: ${VERBS.join(", ")}

More detail: ${c} help [ <command> [ <subcommand> ... ] ]
`);
}

const HELP_SCRIPT_PREVIEW_LINES = 28;

/**
 * @param {CliDeps} deps
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }} m
 * @param {string | null} platform
 * @param {string} verb
 */
function formatRunInvokeLine(deps, m, platform, verb) {
  const c = helpExe(deps);
  const tier = manifestRunTier(m) ?? "infrastructure";
  const pkg = manifestId(m);
  if (platform) return `${c} run ${tier} ${pkg} ${platform} ${verb}`;
  return `${c} run ${tier} ${pkg} ${verb}`;
}

/**
 * Resolve manifest for `run` / `help run` after tier token.
 * @param {CliDeps} deps
 * @param {{ path: string, dir: string, raw: Record<string, unknown> }[]} manifests
 * @param {string} tierToken
 * @param {string} packageId
 * @returns {{ path: string, dir: string, raw: Record<string, unknown> }}
 */
function resolveRunManifest(deps, manifests, tierToken, packageId) {
  const tierDir = parseRunTier(tierToken);
  if (!tierDir) {
    die(
      deps,
      `run: unknown tier ${JSON.stringify(tierToken)} (expected: ${runTiersUsage()})`,
    );
  }
  const m = manifestByTierAndId(manifests, tierToken, packageId);
  if (m) return m;
  const other = manifestById(manifests, packageId);
  if (other) {
    const actual = manifestRunTier(other);
    die(
      deps,
      `run: package ${JSON.stringify(packageId)} is not under tier ${JSON.stringify(tierToken)}` +
        (actual ? ` (expected: ${actual})` : ""),
    );
  }
  die(deps, `run: unknown package ${JSON.stringify(packageId)} under tier ${JSON.stringify(tierToken)}`);
}

/**
 * @param {CliDeps} deps
 * @param {string} absPath
 * @param {number} maxLines
 */
function scriptHeadPreview(deps, absPath, maxLines) {
  if (!deps.existsSync(absPath)) return null;
  const text = deps.readFileSync(absPath, "utf8");
  const lines = text.split(/\r?\n/);
  return lines.slice(0, maxLines).join("\n");
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} topics argv after "help"
 */
function cmdHelp(deps, root, topics) {
  if (topics.length === 0) {
    usage(deps);
    const c = helpExe(deps);
    deps.log(`Topic tree (each prints more detail):
  ${c} help help
  ${c} help list
  ${c} help run [ <tier> [ <package> [ <verb> ] ] ]
  ${c} help secrets [ path | init | change-passphrase | set | list | get | dump | delete | unlock | push ]
  ${c} help users [ bootstrap-hdc ]
  ${c} help maintain [ daily ]
  ${c} help env`);
    return;
  }

  const [a0, a1, a2] = topics;

  if (a0 === "help") {
    if (topics.length > 1) die(deps, `help: too many arguments after "help"`);
    const c = helpExe(deps);
    deps.log(`help — hierarchical usage for hdc

Use:
  ${c} help
for the command summary, or add topics to drill down, for example:
  ${c} help run infrastructure proxmox query
  ${c} help secrets set

Topics mirror real commands: "run" is followed by tier (client | infrastructure (infra) | service), package id,
then a verb (${VERBS.join(", ")}). Package scripts live under packages/<tier-dir>/<package>/<verb>/.
`);
    return;
  }

  if (a0 === "env") {
    if (topics.length > 1) die(deps, `help: too many arguments after "env"`);
    const c = helpExe(deps);
    deps.log(`env — show HDC_* environment variables

Prints global variables from root .env by default (vault, secret backend, HDC_PRIVATE_ROOT, …).
Use --package <tier>/<id> or --run <tier> <id> to show the effective merged set for a package run
(includes env_includes and auto-proxmox when config uses Proxmox modes).

Values that look like secrets are redacted (length only).

Examples:
  ${c} env
  ${c} env --run service pi-hole
  ${c} env --package infrastructure/proxmox
`);
    return;
  }

  if (a0 === "list") {
    if (topics.length > 1) die(deps, `help: too many arguments after "list"`);
    const c = helpExe(deps);
    deps.log(`list — show hdc packages (from packages/*/manifest.json)

Each row is a package id, title, and which verbs exist (deploy / maintain / query). These are the
hdc entrypoints (${c} run <tier> <package> <verb>).

Structured facts for automation live in optional per-package config.json files under
packages/infrastructure/<id>/, packages/services/<id>/, and packages/clients/<id>/ (see each package's config.example.json).

Examples:
  ${c} list
`);
    return;
  }

  if (a0 === "run") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`run — execute a package script

Usage:
  ${c} run <tier> <package> <verb> [-- <extra args...>]
  ${c} run <tier> <package> <platform> <verb> [-- <extra args...>]   # when manifest lists "platforms"

- <tier> is one of: ${runTiersUsage()} (maps to packages/clients, packages/infrastructure, packages/services).
- <package> is the manifest "id" (or the packages/ folder name if id is missing).
- <verb> must be one of: ${VERBS.join(", ")}.
- Platform-routed packages require <platform> before <verb>; see ${c} help run <tier> <package>.
- Everything after "--" is forwarded to the package script (not parsed by hdc).

The child process cwd is packages/<tier-dir>/<package>/<verb>/ (or .../<platform>/<verb>/ when platforms are set).

When a query or deploy plugin exits 0 and prints JSON to stdout, hdc forwards that output to the
terminal unchanged. Package scripts do not update repo inventory paths.

Discover packages:
  ${c} list
Drill into one package or verb:
  ${c} help run <tier> <package>
  ${c} help run <tier> <package> <verb>
`);
      return;
    }

    const tierToken = a1;
    const tierDir = parseRunTier(tierToken);
    if (!tierDir) {
      die(
        deps,
        `help run: unknown tier ${JSON.stringify(tierToken)} (expected: ${runTiersUsage()})`,
      );
    }

    const manifests = discoverManifests(deps.packagesDir(root));
    const canonical = canonicalRunTier(tierToken);
    const tierManifests = manifests.filter((m) => manifestRunTier(m) === canonical);

    if (topics.length === 2) {
      const lines = [];
      lines.push(`run — tier ${tierToken} (packages/${tierDir}/)`);
      lines.push("");
      if (!tierManifests.length) lines.push("(no packages discovered)");
      else {
        lines.push("Packages:");
        for (const m of tierManifests) {
          const verbs = VERBS.filter((v) => verbSpec(m, v)).join(", ") || "(none)";
          lines.push(`  ${manifestId(m)}\t${manifestTitle(m)}\tverbs: ${verbs}`);
        }
      }
      lines.push("");
      lines.push(`Example: ${helpExe(deps)} help run ${tierToken} <package>`);
      deps.log(lines.join("\n"));
      return;
    }

    const packageId = a2;
    const m = resolveRunManifest(deps, manifests, tierToken, packageId);
    const platforms = manifestPlatforms(m);
    const tier = manifestRunTier(m) ?? tierToken;
    const maxTopics = platforms.length > 0 ? 5 : 4;
    if (topics.length > maxTopics) {
      die(deps, `help: too many arguments after "run"`);
    }

    if (topics.length === 3 && platforms.length > 0) {
      const lines = [];
      lines.push(`run — package ${manifestId(m)} (${manifestTitle(m)}), tier ${tier}`);
      lines.push("");
      lines.push(`Manifest: ${deps.relative(root, m.path).replace(/\\/g, "/")}`);
      lines.push(`Platforms: ${platforms.join(", ")}`);
      lines.push("");
      lines.push("Verbs (each platform subfolder must implement configured verbs):");
      for (const v of VERBS) {
        const spec = verbSpec(m, v);
        lines.push(spec ? `  ${v}\t${spec.script}` : `  ${v}\t(not configured)`);
      }
      lines.push("");
      lines.push(`Example: ${formatRunInvokeLine(deps, m, "<platform>", "<verb>")} [-- ...]`);
      deps.log(lines.join("\n"));
      return;
    }

    if (topics.length === 4 && platforms.length > 0) {
      const platform = a3;
      if (!platforms.includes(platform)) {
        die(deps, `help run: unknown platform ${JSON.stringify(platform)} (expected: ${platforms.join(", ")})`);
      }
      const lines = [];
      lines.push(`run — package ${manifestId(m)}, platform ${platform}`);
      lines.push("");
      for (const v of VERBS) {
        const spec = verbSpec(m, v);
        const cwd = deps.join(m.dir, platform, v);
        const scriptAbs = spec ? deps.join(cwd, spec.script) : "";
        const rel = spec ? deps.relative(root, scriptAbs).replace(/\\/g, "/") : "(not configured)";
        lines.push(spec ? `  ${v}\t${rel}` : `  ${v}\t(not configured)`);
      }
      lines.push("");
      lines.push(`Example: ${formatRunInvokeLine(deps, m, platform, "maintain")} [-- ...]`);
      deps.log(lines.join("\n"));
      return;
    }

    if (topics.length === 3) {
      const lines = [];
      lines.push(`run — package ${manifestId(m)} (${manifestTitle(m)}), tier ${tier}`);
      lines.push("");
      lines.push(`Manifest: ${deps.relative(root, m.path).replace(/\\/g, "/")}`);
      const req = envRequired(m);
      if (req.length) lines.push(`env_required (from manifest): ${req.join(", ")}`);
      else lines.push("env_required (from manifest): (none)");
      const invDocs = inventoryDocs(m);
      if (invDocs.length) lines.push(`inventory_docs: ${invDocs.join(", ")}`);
      lines.push("");
      lines.push("Verbs (see help run <tier> <package> <verb> for script path and preview):");
      for (const v of VERBS) {
        const spec = verbSpec(m, v);
        lines.push(spec ? `  ${v}\t${spec.script}` : `  ${v}\t(not configured)`);
      }
      const services = manifestServices(m);
      if (services.length) {
        lines.push("");
        lines.push("Services (capabilities exposed by this package):");
        const c = helpExe(deps);
        for (const svc of services) {
          const inv = formatManifestServiceInvoke(svc, m);
          const invokePart = svc.invoke ? ` → ${svc.invoke}` : "";
          lines.push(`  ${svc.id}\t${svc.verb}${invokePart}\t${svc.title}`);
          if (svc.summary) lines.push(`\t${svc.summary}`);
          lines.push(`\t${c} ${inv} …`);
        }
      }
      lines.push("");
      const platNote = platforms.length
        ? ` or ${formatRunInvokeLine(deps, m, "<platform>", "<verb>")}`
        : "";
      lines.push(`Example: ${formatRunInvokeLine(deps, m, null, "<verb>")} [-- ...]${platNote}`);
      deps.log(lines.join("\n"));
      return;
    }

    const verb = platforms.length > 0 && topics.length === 5 ? topics[4] : topics[3];
    const platform = platforms.length > 0 && topics.length === 5 ? a3 : null;
    if (platform && !platforms.includes(platform)) {
      die(deps, `help run: unknown platform ${JSON.stringify(platform)}`);
    }
    if (!VERBS.includes(verb)) die(deps, `help run: verb must be one of: ${VERBS.join(", ")}`);
    const spec = verbSpec(m, verb);
    if (!spec) die(deps, `help run: package ${JSON.stringify(packageId)} has no ${verb} script in manifest`);
    const cwd = runScriptDir(m, platform, verb);
    const scriptAbs = deps.join(cwd, spec.script);
    const relScript = deps.relative(root, scriptAbs).replace(/\\/g, "/");
    const queryNote =
      verb === "query" || verb === "deploy"
        ? `On exit 0, stdout from the script is written to the terminal as received (no hdc post-processing).\n\n`
        : "";
    const invokeLine = `${formatRunInvokeLine(deps, m, platform, verb)} [-- <args for ${spec.script}>]`;
    deps.log(`run — package ${manifestId(m)} (${manifestTitle(m)})${platform ? `, platform ${platform}` : ""}, verb ${verb}

Manifest: ${deps.relative(root, m.path).replace(/\\/g, "/")}
Working directory (spawn cwd): ${deps.relative(root, cwd).replace(/\\/g, "/")}
Script (manifest): ${spec.script}
Script (repo path): ${relScript}

Invoke:
  ${invokeLine}

${queryNote}If the script file is missing on disk, "run" exits with an error (same check as real execution).`);
    if (!deps.existsSync(scriptAbs)) {
      deps.warn(`warning: script not found at ${relScript}`);
      return;
    }
    const head = scriptHeadPreview(deps, scriptAbs, HELP_SCRIPT_PREVIEW_LINES);
    if (head) {
      deps.log("");
      deps.log(`First lines of ${spec.script} (preview, max ${HELP_SCRIPT_PREVIEW_LINES} lines):`);
      deps.log(head);
    }
    return;
  }

  if (a0 === "secrets") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`secrets — encrypted vault for environment-style names

Subcommands:
  path    Print the vault file path.
  init    Create an empty vault (passphrase prompt, or HDC_VAULT_PASSPHRASE once).
  change-passphrase  Re-encrypt vault with a new passphrase (current via env or prompt).
  set     Set or update a key (ENV-style name).
  list    List keys (Vaultwarden items and/or local bootstrap keys).
  get     Write one secret value to a file (--out required).
  dump    Export secrets to a directory (per-key files, or --format env|json).
  delete  Remove a key.
  unlock  Unlock Vaultwarden vault (bw session) when HDC_SECRET_BACKEND is vaultwarden or auto.
  push    Copy local vault secrets into the Vaultwarden HDC organization collection.

Examples:
  ${c} secrets path
  ${c} help secrets dump
  ${c} help secrets set
  ${c} help secrets push
`);
      return;
    }
    if (topics.length > 2) die(deps, `help: too many arguments after "secrets ${a1}"`);
    const sub = a1;
    if (sub === "path") {
      const c = helpExe(deps);
      deps.log(`secrets path — print vault location

Prints the path used by other secrets commands (see deps.defaultVaultPath at runtime).

Example:
  ${c} secrets path
`);
      return;
    }
    if (sub === "init") {
      const c = helpExe(deps);
      deps.log(`secrets init — create an empty vault

If HDC_VAULT_PASSPHRASE is set, it is used once to encrypt the new vault; otherwise hdc prompts
for a passphrase and confirmation. Fails if the vault file already exists.

Example:
  ${c} secrets init
`);
      return;
    }
    if (sub === "change-passphrase") {
      const c = helpExe(deps);
      deps.log(`secrets change-passphrase — rotate vault encryption passphrase

Requires an existing vault. Unlocks with HDC_VAULT_PASSPHRASE when it decrypts the file, otherwise
prompts for the current passphrase. Prompts twice for the new passphrase (masked). All stored keys
are preserved. After success, update HDC_VAULT_PASSPHRASE in repo .env if you use non-interactive unlock.

Example:
  ${c} secrets change-passphrase
`);
      return;
    }
    if (sub === "list") {
      const c = helpExe(deps);
      deps.log(`secrets list — print sorted key names

Lists keys from the active secret backend (Vaultwarden when HDC_VAULTWARDEN_URL and
HDC_VAULTWARDEN_EMAIL are set with HDC_SECRET_BACKEND auto or vaultwarden; otherwise local
~/.hdc/vault.enc). Local-only bootstrap keys are labeled when listed from Vaultwarden mode.

Example:
  ${c} secrets list
`);
      return;
    }
    if (sub === "unlock") {
      const c = helpExe(deps);
      deps.log(`secrets unlock — unlock Vaultwarden for this command session

Requires Bitwarden CLI (bw), HDC_VAULTWARDEN_URL, and HDC_VAULTWARDEN_EMAIL. Prompts for the
Vaultwarden master password unless HDC_VAULTWARDEN_MASTER_PASSWORD is in the local hdc vault.

Example:
  ${c} secrets unlock
`);
      return;
    }
    if (sub === "push") {
      const c = helpExe(deps);
      deps.log(`secrets push — copy local vault secrets into Vaultwarden HDC organization

Requires Bitwarden CLI (bw), HDC_VAULTWARDEN_URL, HDC_VAULTWARDEN_EMAIL, and
HDC_VAULTWARDEN_COLLECTION_ID. Organization: HDC_VAULTWARDEN_ORGANIZATION_ID or auto-resolve by
HDC_VAULTWARDEN_ORGANIZATION_NAME (default HDC). Bootstrap keys (HDC_VAULTWARDEN_MASTER_PASSWORD,
HDC_VAULTWARDEN_ADMIN_TOKEN) stay in the local vault only.

Usage:
  ${c} secrets push [--dry-run] [--skip-existing] [--force]

  --dry-run         List keys that would be pushed; no bw writes.
  --skip-existing   Skip keys already in the organization (default when --force is omitted).
  --force           Overwrite organization items even when present.

Examples:
  ${c} secrets push --dry-run
  ${c} secrets push --force
`);
      return;
    }
    if (sub === "delete") {
      const c = helpExe(deps);
      deps.log(`secrets delete — remove one key

Usage:
  ${c} secrets delete <ENV_NAME>

<ENV_NAME> must look like an environment variable token (letters, digits, underscore).

Example:
  ${c} secrets delete HDC_EXAMPLE
`);
      return;
    }
    if (sub === "set") {
      const c = helpExe(deps);
      const sh = helpExeShell(deps);
      deps.log(`secrets set — store a secret value

Usage:
  ${c} secrets set <ENV_NAME> [--stdin | --value <s>]

If neither --stdin nor --value is given, hdc prompts for the value (unless your stdin is wired).

Examples:
  ${c} secrets set HDC_EXAMPLE --value "secret"
  printf 'secret\\n' | ${sh} secrets set HDC_EXAMPLE --stdin
`);
      return;
    }
    if (sub === "get") {
      const c = helpExe(deps);
      deps.log(`secrets get — write one secret to a file

Requires an unlocked vault (local passphrase or Vaultwarden). Values are written as plaintext
with mode 0600. Prefer a directory outside the hdc repo; never commit exported files.

Usage:
  ${c} secrets get <ENV_NAME> --out <path> [--force] [--dry-run]

Example:
  ${c} secrets get HDC_PROXMOX_API_TOKEN --out %USERPROFILE%\\.hdc\\export\\HDC_PROXMOX_API_TOKEN
`);
      return;
    }
    if (sub === "dump") {
      const c = helpExe(deps);
      deps.log(`secrets dump — export secrets to the filesystem

Requires an unlocked vault. By default excludes local bootstrap keys (HDC_VAULTWARDEN_*);
use --include-bootstrap to export those too.

Usage:
  ${c} secrets dump --out-dir <dir> [--format files|env|json] [--key <ENV_NAME> ...]
      [--include-bootstrap] [--force] [--dry-run]

Formats:
  files (default)  One file per key named <ENV_NAME> (value only).
  env              Single secrets.env with KEY=value lines.
  json             Single secrets.json object.

Examples:
  ${c} secrets dump --out-dir %USERPROFILE%\\.hdc\\export
  ${c} secrets dump --out-dir %USERPROFILE%\\.hdc\\export --format env
  ${c} secrets dump --out-dir %USERPROFILE%\\.hdc\\export --key HDC_BIND_TSIG_KEY
`);
      return;
    }
    die(
      deps,
      `help secrets: unknown subtopic ${JSON.stringify(sub)} (try: path, init, change-passphrase, set, list, get, dump, delete, unlock, push)`,
    );
  }

  if (a0 === "users") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`users — host-local user operations

Subcommands:
  bootstrap-hdc  Create/update the "hdc" Linux user over SSH for hosts listed in package config or explicit JSON sidecars.

Example:
  ${c} help users bootstrap-hdc`);
      return;
    }
    if (topics.length > 2) die(deps, `help: too many arguments after "users ${a1}"`);
    if (a1 === "bootstrap-hdc") {
      const c = helpExe(deps);
      deps.log(`users bootstrap-hdc — remote "hdc" user + password in vault

Usage:
  ${c} users bootstrap-hdc [--dry-run] [--sidecar <path> ...]

- With no --sidecar, hdc reads bootstrap_hosts from packages/infrastructure/ubuntu/config.json and
  packages/infrastructure/proxmox/config.json (if present). Each host entry uses the same shape as
  a legacy system sidecar: tags (include "ubuntu" and/or "proxmox"), access.nodes[].ssh, auth.ssh_user_env.
- With one or more --sidecar paths, only those JSON files are used (same field expectations).

Non-dry-run requires vault unlock (passphrase / HDC_VAULT_PASSPHRASE) to store generated passwords.

Flags:
  --dry-run        Log what would happen; no vault writes and no ssh.
  --sidecar <path> Limit to specific JSON files (repeatable).

Examples:
  ${c} users bootstrap-hdc --dry-run
  ${c} users bootstrap-hdc --sidecar path/to/host.json
`);
      return;
    }
    die(deps, `help users: unknown subtopic ${JSON.stringify(a1)} (try: bootstrap-hdc)`);
  }

  if (a0 === "maintain") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`maintain — scheduled / cross-package maintenance

Subcommands:
  daily  Run a curated non-destructive recipe across packages with config.json.

Example:
  ${c} help maintain daily`);
      return;
    }
    if (topics.length > 2) die(deps, `help: too many arguments after "maintain ${a1}"`);
    if (a1 === "daily") {
      const c = helpExe(deps);
      deps.log(`maintain daily — safe daily maintenance orchestrator

Usage:
  ${c} maintain daily [--dry-run] [--skip-clients] [--skip-upgrades]
  ${c} maintain daily [--only <tier>/<id>] [--skip <tier>/<id>] [--no-report] [--report <path>]
  ${c} maintain daily -- [--only service/bind]   # flags after -- also accepted

Runs configured packages sequentially (continues on failure). Skips packages without
config.json. Applies routine updates (Docker pull, guest apt, DSM packages) but avoids
prune, rolling restarts, and reboots. Home clients run query only.

Writes an aggregated markdown report under tools/hdc/reports/ (hdc-private when present).

Examples:
  ${c} maintain daily
  ${c} maintain daily --dry-run
  ${c} maintain daily -- --only infrastructure/proxmox
  ${c} maintain daily -- --skip service/trivy --skip-upgrades
`);
      return;
    }
    die(deps, `help maintain: unknown subtopic ${JSON.stringify(a1)} (try: daily)`);
  }

  die(
    deps,
    `help: unknown topic ${JSON.stringify(a0)} (try: help, list, run, secrets, users, env)`,
  );
}

/**
 * @param {CliDeps} deps
 * @param {string} msg
 * @param {number} [code]
 * @returns {never}
 */
function die(deps, msg, code = 1) {
  deps.error(msg);
  throw new CliExit(code);
}

/**
 * @param {CliDeps} deps
 */
function bootstrapEnv(deps) {
  const root = deps.repoRoot();
  bootstrapGlobalEnv(deps, root);
  return root;
}

/**
 * @param {CliDeps} deps
 * @param {string} sub
 * @param {string[]} rest
 */
async function cmdSecretsExport(deps, sub, rest) {
  const vaultPath = deps.defaultVaultPath();
  const access = createVaultAccess(vaultDepsFromCli(deps));

  /** @type {import("./secrets-export.mjs").ParsedSecretsExportArgv} */
  let parsed;
  try {
    parsed = parseSecretsExportArgv([sub, ...rest]);
  } catch (e) {
    die(deps, /** @type {Error} */ (e).message);
  }

  if (parsed.mode === "get") {
    if (!parsed.key || !ENV_NAME_RE.test(parsed.key)) {
      die(
        deps,
        "secrets get: need a valid ENV-style name (letters, digits, underscore)",
      );
    }
  }
  for (const k of parsed.keys) {
    if (!ENV_NAME_RE.test(k)) {
      die(
        deps,
        `secrets dump: invalid --key ${JSON.stringify(k)} (letters, digits, underscore)`,
      );
    }
  }

  if (parsed.mode === "get" && parsed.key) {
    if (isLocalOnlyVaultKey(parsed.key) && !parsed.includeBootstrap) {
      die(deps, `secrets get: unknown key(s): ${parsed.key}`);
    }
    const value = await access.getSecret(parsed.key, { optional: true });
    if (!value) {
      die(deps, `secrets get: unknown key(s): ${parsed.key}`);
    }
    try {
      const { written, destination } = writeSecretExport(deps, { [parsed.key]: value }, parsed);
      if (parsed.dryRun) {
        deps.log(`[dry-run] would export ${written} secret(s)`);
      } else {
        deps.log(`wrote ${written} secret(s) to ${destination}`);
      }
    } catch (e) {
      die(deps, /** @type {Error} */ (e).message);
    }
    return;
  }

  const all = await access.readSecrets({ createIfMissing: false });
  if (all === null) {
    die(deps, `secrets ${sub}: no vault at ${vaultPath} (run secrets init first)`);
  }

  const filterKeys =
    parsed.mode === "get" && parsed.key ? [parsed.key] : parsed.keys;
  const { secrets, missing } = filterSecretsForExport(all, {
    keys: filterKeys,
    includeBootstrap: parsed.includeBootstrap,
  });
  if (missing.length > 0) {
    die(deps, `secrets ${sub}: unknown key(s): ${missing.join(", ")}`);
  }
  if (Object.keys(secrets).length === 0) {
    deps.warn(`secrets ${sub}: no secrets to export`);
    return;
  }

  try {
    const { written, destination } = writeSecretExport(deps, secrets, parsed);
    if (parsed.dryRun) {
      deps.log(`[dry-run] would export ${written} secret(s)`);
    } else {
      deps.log(`wrote ${written} secret(s) to ${destination}`);
    }
  } catch (e) {
    die(deps, /** @type {Error} */ (e).message);
  }
}

/**
 * @param {CliDeps} deps
 * @param {string[]} argv
 */
async function cmdSecrets(deps, argv) {
  const sub = argv[0];
  const vaultPath = deps.defaultVaultPath();
  const access = createVaultAccess(vaultDepsFromCli(deps));

  if (sub === "path") {
    deps.log(vaultPath);
    return;
  }
  if (sub === "init") {
    if (deps.existsSync(vaultPath)) {
      die(deps, `secrets init: vault already exists: ${vaultPath}`);
    }
    const envPass = String(deps.env.HDC_VAULT_PASSPHRASE ?? "").trim();
    if (envPass) {
      writeVault(vaultPath, envPass, {});
      deps.log(`initialized empty vault: ${vaultPath}`);
      return;
    }
    const p1 = await deps.readLineQuestion("Choose a vault passphrase: ", { mask: true });
    if (!p1) die(deps, "secrets init: empty passphrase");
    const p2 = await deps.readLineQuestion("Confirm vault passphrase: ", { mask: true });
    if (p1 !== p2) die(deps, "secrets init: passphrases do not match");
    writeVault(vaultPath, p1, {});
    deps.log(`initialized empty vault: ${vaultPath}`);
    return;
  }
  if (sub === "change-passphrase") {
    if (!deps.existsSync(vaultPath)) {
      die(
        deps,
        `secrets change-passphrase: no vault at ${vaultPath} (run secrets init first)`,
      );
    }
    const currentPass = await access.unlock({ createIfMissing: false });
    if (currentPass === null) {
      die(deps, `secrets change-passphrase: no vault at ${vaultPath}`);
    }
    const data = readVault(vaultPath, currentPass);
    const p1 = await deps.readLineQuestion("New vault passphrase: ", { mask: true });
    if (!p1) die(deps, "secrets change-passphrase: empty passphrase");
    const p2 = await deps.readLineQuestion("Confirm new vault passphrase: ", { mask: true });
    if (p1 !== p2) die(deps, "secrets change-passphrase: passphrases do not match");
    if (p1 === currentPass) {
      die(deps, "secrets change-passphrase: new passphrase must differ from current");
    }
    writeVault(vaultPath, p1, data);
    clearVaultPassphraseProcessCache();
    deps.log(`changed vault passphrase: ${vaultPath}`);
    if (String(deps.env.HDC_VAULT_PASSPHRASE ?? "").trim()) {
      deps.warn("Update HDC_VAULT_PASSPHRASE in your repo .env to the new passphrase.");
    }
    return;
  }
  if (sub === "list") {
    const listed = await access.listSecretKeys();
    const { local, vaultwarden, mode } = listed;
    if (mode === "vaultwarden") {
      if (vaultwarden.length === 0 && local.length === 0) deps.log("(empty)");
      for (const k of vaultwarden) deps.log(k);
      for (const k of local) {
        if (!vaultwarden.includes(k)) deps.log(`${k} (local bootstrap)`);
      }
      return;
    }
    if (local.length === 0) deps.log("(empty)");
    else for (const k of local) deps.log(k);
    return;
  }
  if (sub === "unlock") {
    await access.unlockVaultwarden();
    return;
  }
  if (sub === "push") {
    const parsed = parseSecretsPushArgv(argv.slice(1));
    const vwCli = vaultwardenCliDepsFromCli(deps, deps.spawnSync);
    const result = await pushLocalSecretsToVaultwarden(access, vwCli, parsed);
    const total = result.pushed + result.updated;
    if (result.errorKeys.length > 0) {
      die(
        deps,
        `secrets push: ${result.errorKeys.length} key(s) failed (${result.errorKeys.join(", ")})`,
      );
    }
    if (parsed.dryRun) {
      deps.log(`[dry-run] would push ${total} secret(s)`);
    } else {
      deps.log(
        `secrets push: ${result.pushed} created, ${result.updated} updated, ${result.skipped} skipped`,
      );
    }
    return;
  }
  if (sub === "get" || sub === "dump") {
    await cmdSecretsExport(deps, sub, argv.slice(1));
    return;
  }
  if (sub === "delete") {
    const key = argv[1];
    if (!key || !ENV_NAME_RE.test(key)) {
      die(
        deps,
        "secrets delete: need a valid ENV-style name (letters, digits, underscore)",
      );
    }
    const deleted = await access.deleteSecret(key);
    if (!deleted) die(deps, `secrets delete: no entry ${JSON.stringify(key)}`);
    deps.log(`deleted ${key}`);
    return;
  }
  if (sub === "set") {
    const key = argv[1];
    if (!key || !ENV_NAME_RE.test(key)) {
      die(
        deps,
        "secrets set: need a valid ENV-style name (letters, digits, underscore)",
      );
    }
    const useStdin = argv.includes("--stdin");
    let valueArg = null;
    const vi = argv.indexOf("--value");
    if (vi !== -1) valueArg = argv[vi + 1] ?? null;
    if (useStdin && valueArg !== null) die(deps, "secrets set: use only one of --stdin or --value");
    let value = valueArg;
    if (!useStdin && value === null) {
      value = await deps.readLineQuestion(`Value for ${key}: `, { mask: true });
    } else if (useStdin) {
      value = deps.readStdinUtf8().replace(/\r?\n$/, "");
    }
    if (value === null || value === "") die(deps, "secrets set: empty value");
    await access.setSecret(key, value);
    deps.log(`saved ${key}`);
    return;
  }
  die(deps, `secrets: unknown subcommand ${JSON.stringify(sub ?? "")}`);
}

/**
 * @param {CliDeps} deps
 * @param {string[]} argv
 */
async function cmdUsers(deps, argv) {
  const sub = argv[0];
  if (sub === "bootstrap-hdc") {
    await runUsersBootstrapHdc(argv.slice(1), deps);
    return;
  }
  die(
    deps,
    `users: unknown subcommand ${JSON.stringify(sub ?? "")} (try: users bootstrap-hdc)`,
  );
}

/**
 * @param {string[]} argv
 * @returns {{ packageRun: { tier: string; id: string } | null; rest: string[] }}
 */
function parseEnvArgv(argv) {
  /** @type {{ tier: string; id: string } | null} */
  let packageRun = null;
  const rest = [...argv];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--run" && rest[i + 1] && rest[i + 2]) {
      packageRun = { tier: rest[i + 1], id: rest[i + 2] };
      rest.splice(i, 3);
      i--;
      continue;
    }
    if (a === "--package" && rest[i + 1]) {
      const spec = rest[i + 1];
      const slash = spec.indexOf("/");
      if (slash <= 0) {
        throw new Error("--package needs <tier>/<id> (e.g. service/pi-hole)");
      }
      packageRun = { tier: spec.slice(0, slash), id: spec.slice(slash + 1) };
      rest.splice(i, 2);
      i--;
    }
  }
  if (rest.length) {
    throw new Error(`env: unknown argument(s): ${rest.join(" ")}`);
  }
  return { packageRun, rest };
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv
 */
function cmdEnv(deps, root, argv = []) {
  let packageRun = null;
  try {
    packageRun = parseEnvArgv(argv).packageRun;
  } catch (e) {
    die(deps, /** @type {Error} */ (e).message);
  }

  if (packageRun) {
    const manifests = discoverManifests(deps.packagesDir(root));
    const m = manifestByTierAndId(manifests, packageRun.tier, packageRun.id);
    if (!m) {
      die(deps, `env: no package ${packageRun.tier}/${packageRun.id}`);
    }
    const includes = resolveEnvIncludes(m, root, deps.env);
    const pkgRel = deps.relative(root, deps.join(m.dir, ".env")).replace(/\\/g, "/");
    deps.log(
      `Effective HDC_* for ${packageRun.tier}/${manifestId(m)} (global + ${includes.length ? `includes: ${includes.join(", ")} + ` : ""}${pkgRel}; redacted).`,
    );
    const runEnv = buildPackageRunEnv(deps, root, m);
    const rows = collectHdcEnvRows(runEnv);
    if (!rows.length) {
      deps.log("(none set)");
      return;
    }
    for (const { key, display } of rows) {
      deps.log(`${key}=${display}`);
    }
    return;
  }

  const relDotenv = deps.relative(root, deps.join(root, ".env")).replace(/\\/g, "/");
  const dotenvPath = deps.join(root, ".env");
  const dotenvPresent = deps.existsSync(dotenvPath);
  deps.log(
    `Global HDC_* variables (.env: ${relDotenv} ${dotenvPresent ? "exists" : "missing"}; per-package: packages/<tier>/<id>/.env).`,
  );
  const globalKeys = new Set(collectGlobalEnvKeys(deps.env));
  const rows = collectHdcEnvRows(deps.env).filter((r) => globalKeys.has(r.key));
  if (!rows.length) {
    deps.log("(none set)");
    return;
  }
  for (const { key, display } of rows) {
    deps.log(`${key}=${display}`);
  }
}

function cmdList(deps, root) {
  const manifests = discoverManifests(deps.packagesDir(root));
  deps.log("Packages (manifest.json):");
  for (const tier of RUN_TIERS) {
    const tierManifests = manifests.filter((m) => manifestRunTier(m) === tier);
    if (!tierManifests.length) continue;
    deps.log(`  [${tier}]`);
    for (const m of tierManifests) {
      const verbs = VERBS.filter((v) => verbSpec(m, v)).join(", ") || "(none)";
      const svc = manifestServices(m);
      const svcBrief = svc.length
        ? `\tservices: ${svc.map((s) => (s.invoke ? `${s.id}(${s.verb}/${s.invoke})` : `${s.id}(${s.verb})`)).join(", ")}`
        : "";
      const plat = manifestPlatforms(m);
      const platBrief = plat.length ? `\tplatforms: ${plat.join(", ")}` : "";
      deps.log(`    ${manifestId(m)}\t${manifestTitle(m)}\tverbs: ${verbs}${platBrief}${svcBrief}`);
    }
  }
  deps.log("\nOptional per-package config (packages/<tier-dir>/<id>/config.json; see config.example.json):");
  for (const m of manifests) {
    const tier = manifestRunTier(m) ?? "?";
    const rel = deps.relative(root, deps.join(m.dir, "config.json")).replace(/\\/g, "/");
    const resolved = resolveRepoFile(root, rel);
    let state = "(optional)";
    if (resolved.source === "public") state = "exists (hdc)";
    else if (resolved.source === "private") state = "exists (hdc-private)";
    deps.log(`  ${tier}\t${manifestId(m)}\t${rel}\t${state}`);
  }
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv
 */
async function cmdRun(deps, root, argv) {
  const { forward, extra } = splitRunArgs(argv);
  if (forward.length < 3) {
    die(deps, `run: need <tier> <package> <verb> (tiers: ${runTiersUsage()})`);
  }
  const manifests = discoverManifests(deps.packagesDir(root));
  const tierToken = forward[0];
  const m = resolveRunManifest(deps, manifests, tierToken, forward[1]);
  const inv = resolveRunInvocation(forward.slice(1), m);
  if ("error" in inv) die(deps, `run: ${inv.error}`);
  const { packageId, platform, verb } = inv;

  if (resolveSecretBackendMode(deps.env) === "vaultwarden") {
    const vault = createVaultAccess(vaultDepsFromCli(deps));
    try {
      await vault.unlock({});
    } catch (e) {
      die(deps, `run: vault unlock failed: ${/** @type {Error} */ (e).message || e}`);
    }
  }

  if (verb !== "query") {
    const runEnv = buildPackageRunEnv(deps, root, m);
    for (const key of envRequired(m)) {
      if (!runEnv[key]) {
        deps.warn(`warning: env ${key} is not set (declared env_required in manifest)`);
      }
    }
  }
  const spec = verbSpec(m, verb);
  if (!spec) die(deps, `run: package ${packageId} has no ${verb} script in manifest`);
  const cwd = runScriptDir(m, platform, verb);
  const script = deps.join(cwd, spec.script);
  if (!deps.existsSync(script)) die(deps, `run: missing script ${script}`);
  const pipeStdoutJson = verb === "query" || verb === "deploy" || verb === "teardown";
  const runEnv = buildPackageRunEnv(deps, root, m);
  const r = deps.spawnSync(deps.execPath, [script, ...extra], {
    cwd,
    stdio: pipeStdoutJson ? ["inherit", "pipe", "inherit"] : "inherit",
    env: runEnv,
    shell: false,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const status = r.status ?? 1;
  const stdoutStr =
    pipeStdoutJson && r.stdout !== undefined && r.stdout !== null
      ? typeof r.stdout === "string"
        ? r.stdout
        : String(r.stdout)
      : "";
  if (verb === "query" && stdoutStr) deps.stdoutWrite(stdoutStr);
  else if ((verb === "deploy" || verb === "teardown") && stdoutStr) deps.stdoutWrite(stdoutStr);
  throw new CliExit(status);
}

/**
 * @param {string[]} argv
 * @param {CliDeps} deps
 * @returns {Promise<number>}
 */
export async function runCli(argv, deps) {
  try {
    if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
      usage(deps);
      return 0;
    }
    const root = bootstrapEnv(deps);
    const cmd = argv[0];
    const rest = argv.slice(1);

    if (cmd === "help") {
      cmdHelp(deps, root, rest);
      return 0;
    }
    if (cmd === "list") {
      cmdList(deps, root);
      return 0;
    }
    if (cmd === "env") {
      cmdEnv(deps, root, rest);
      return 0;
    }
    if (cmd === "run") {
      await cmdRun(deps, root, rest);
    } else if (cmd === "secrets") {
      if (rest.length === 0) {
        die(
          deps,
          "secrets: need a subcommand (path, init, change-passphrase, set, list, get, dump, delete)",
        );
      }
      await cmdSecrets(deps, rest);
      return 0;
    } else if (cmd === "users") {
      if (rest.length === 0) {
        die(deps, "users: need a subcommand (bootstrap-hdc)");
      }
      await cmdUsers(deps, rest);
      return 0;
    } else if (cmd === "maintain") {
      if (rest.length === 0) {
        die(deps, "maintain: need a subcommand (daily)");
      }
      return await cmdMaintainDaily(deps, root, rest);
    } else {
      usage(deps);
      die(deps, `unknown command: ${cmd}`, 1);
    }
  } catch (e) {
    if (e instanceof CliExit) return e.code;
    throw e;
  }
}
