import {
  discoverManifests,
  discoverAllClumpManifests,
  primaryClumpsRoot,
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
  buildClumpRunEnv,
  collectGlobalEnvKeys,
  resolveEnvIncludes,
} from "./clump-env.mjs";
import {
  clearVaultPassphraseProcessCache,
  createVaultAccess,
  vaultDepsFromCli,
} from "./vault-access.mjs";
import { runUsersBootstrapHdc } from "./users-bootstrap-hdc.mjs";
import { hdcPrivateRoot, resolveRepoFile } from "./private-repo.mjs";
import {
  filterSecretsForExport,
  parseSecretsExportArgv,
  writeSecretExport,
} from "./secrets-export.mjs";
import {
  parseSecretsBackupArgv,
  restoreBootstrapBundle,
  runSecretsBackup,
  unlockLocalVaultPassphrase,
} from "./secrets-backup.mjs";
import { parseSecretsPushArgv, pushLocalSecretsToVaultwarden } from "./vaultwarden-sync.mjs";
import { resolveSecretBackendMode } from "./secret-backend.mjs";
import { vaultwardenCliDepsFromCli } from "./vaultwarden-cli.mjs";
import { isLocalOnlyVaultKey } from "./secret-backend.mjs";
import { cmdMaintainDaily } from "./daily-maintain.mjs";
import { runDocsLint } from "./docs-lint.mjs";
import { cliAppDir } from "../paths.mjs";
import { augmentPackageSpawnEnv } from "./package/spawn-env.mjs";
import {
  loadClumpsReposConfig,
  persistClumpRepoRef,
  readClumpRepoResolved,
  resolveClumpRoots,
  syncClumpRepo,
} from "./clump-repos.mjs";

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
 * @property {(root: string) => string} clumpsDir
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
  ${c} clumps list [--reference]
  ${c} clumps sync [--repo <id>] [--ref <branch|tag|sha>] [--persist|--no-persist] [--dry-run]
  ${c} clumps init   # same flags as sync
  ${c} run <tier> <clump> <verb> [-- <extra args...>]
  ${c} run <tier> <clump> <platform> <verb> [-- <extra args...>]   # when manifest lists "platforms"
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
  ${c} secrets sync-uris [--dry-run] [--key <ENV>] [--force]   # HDC service URLs on Login items
  ${c} secrets backup [--dest <dir> ...] [--retain <n>] [--dry-run]   # vault.enc + encrypted .env bundle
  ${c} secrets restore-bootstrap <file> --out-dir <dir> [--force]
  ${c} users bootstrap-hdc [--dry-run] [--sidecar <path> ...]
  ${c} maintain daily [--dry-run] [--skip-clients] [--skip-upgrades] [--only <tier>/<id>] [--skip <tier>/<id>] [--skip-vault-backup] [--skip-private-git-check] [--skip-lock] [--step-timeout-ms <n>] [--no-report] [--report <path>]
  ${c} docs lint        # AJV validate schemas + inventory / config.example.json
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
 * @param {string} clumpId
 * @returns {{ path: string, dir: string, raw: Record<string, unknown> }}
 */
function resolveRunManifest(deps, manifests, tierToken, clumpId) {
  const tierDir = parseRunTier(tierToken);
  if (!tierDir) {
    die(
      deps,
      `run: unknown tier ${JSON.stringify(tierToken)} (expected: ${runTiersUsage()})`,
    );
  }
  const m = manifestByTierAndId(manifests, tierToken, clumpId);
  if (m) return m;
  const other = manifestById(manifests, clumpId);
  if (other) {
    const actual = manifestRunTier(other);
    die(
      deps,
      `run: package ${JSON.stringify(clumpId)} is not under tier ${JSON.stringify(tierToken)}` +
        (actual ? ` (expected: ${actual})` : ""),
    );
  }
  die(deps, `run: unknown package ${JSON.stringify(clumpId)} under tier ${JSON.stringify(tierToken)}`);
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
  ${c} help run [ <tier> [ <clump> [ <verb> ] ] ]
  ${c} help secrets [ path | init | change-passphrase | set | list | get | dump | delete | unlock | push | sync-uris ]
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

Topics mirror real commands: "run" is followed by tier (client | infrastructure (infra) | service), clump id,
then a verb (${VERBS.join(", ")}). Clump scripts live under clumps/<tier-dir>/<clump>/<verb>/.
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
    deps.log(`list — show hdc packages (from clumps/*/manifest.json)

Each row is a clump id, title, and which verbs exist (deploy / maintain / query). These are the
hdc entrypoints (${c} run <tier> <clump> <verb>).

Structured facts for automation live in optional per-clump config.json files under
clumps/infrastructure/<id>/, clumps/services/<id>/, and clumps/clients/<id>/ (see each package's config.example.json).

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
  ${c} run <tier> <clump> <verb> [-- <extra args...>]
  ${c} run <tier> <clump> <platform> <verb> [-- <extra args...>]   # when manifest lists "platforms"

- <tier> is one of: ${runTiersUsage()} (maps to clumps/clients, clumps/infrastructure, clumps/services).
- <clump> is the manifest "id" (or the clumps/ folder name if id is missing).
- <verb> must be one of: ${VERBS.join(", ")}.
- Platform-routed packages require <platform> before <verb>; see ${c} help run <tier> <clump>.
- Everything after "--" is forwarded to the package script (not parsed by hdc).

The child process cwd is clumps/<tier-dir>/<clump>/<verb>/ (or .../<platform>/<verb>/ when platforms are set).

When a query or deploy plugin exits 0 and prints JSON to stdout, hdc forwards that output to the
terminal unchanged. Clump scripts do not update repo inventory paths.

Discover packages:
  ${c} list
Drill into one package or verb:
  ${c} help run <tier> <clump>
  ${c} help run <tier> <clump> <verb>
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

    const manifests = discoverAllClumpManifests(root, deps.env);
    const canonical = canonicalRunTier(tierToken);
    const tierManifests = manifests.filter((m) => manifestRunTier(m) === canonical);

    if (topics.length === 2) {
      const lines = [];
      lines.push(`run — tier ${tierToken} (clumps/${tierDir}/)`);
      lines.push("");
      if (!tierManifests.length) lines.push("(no clumps discovered)");
      else {
        lines.push("Packages:");
        for (const m of tierManifests) {
          const verbs = VERBS.filter((v) => verbSpec(m, v)).join(", ") || "(none)";
          lines.push(`  ${manifestId(m)}\t${manifestTitle(m)}\tverbs: ${verbs}`);
        }
      }
      lines.push("");
      lines.push(`Example: ${helpExe(deps)} help run ${tierToken} <clump>`);
      deps.log(lines.join("\n"));
      return;
    }

    const clumpId = a2;
    const m = resolveRunManifest(deps, manifests, tierToken, clumpId);
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
      lines.push("Verbs (see help run <tier> <clump> <verb> for script path and preview):");
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
    if (!spec) die(deps, `help run: package ${JSON.stringify(clumpId)} has no ${verb} script in manifest`);
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
  sync-uris  Set HDC service website URLs on Vaultwarden Login items (from clump configs).
  backup  Copy vault.enc plus an encrypted bundle of bootstrap .env files to backup dirs.
  restore-bootstrap  Decrypt a bootstrap bundle back into .env files (disaster recovery).

Examples:
  ${c} secrets path
  ${c} help secrets dump
  ${c} help secrets set
  ${c} help secrets push
  ${c} help secrets sync-uris
  ${c} help secrets backup
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
HDC_VAULTWARDEN_EMAIL or API key pair are set with HDC_SECRET_BACKEND auto or vaultwarden; otherwise local
~/.hdc/vault.enc). Local-only bootstrap keys are labeled when listed from Vaultwarden mode.

Example:
  ${c} secrets list
`);
      return;
    }
    if (sub === "unlock") {
      const c = helpExe(deps);
      deps.log(`secrets unlock — unlock Vaultwarden for this command session

Requires Bitwarden CLI (bw), HDC_VAULTWARDEN_URL, and HDC_VAULTWARDEN_EMAIL or API key pair
(HDC_VAULTWARDEN_KEY_CLIENT_ID + HDC_VAULTWARDEN_KEY_CLIENT_SECRET). Prompts for the
Vaultwarden master password unless HDC_VAULTWARDEN_MASTER_PASSWORD is in the local hdc vault.

Example:
  ${c} secrets unlock
`);
      return;
    }
    if (sub === "push") {
      const c = helpExe(deps);
      deps.log(`secrets push — copy local vault secrets into Vaultwarden HDC organization

Requires Bitwarden CLI (bw), HDC_VAULTWARDEN_URL, HDC_VAULTWARDEN_EMAIL or API key pair, and
HDC_VAULTWARDEN_COLLECTION_ID. Organization: HDC_VAULTWARDEN_ORGANIZATION_ID or auto-resolve by
HDC_VAULTWARDEN_ORGANIZATION_NAME (default HDC). Bootstrap keys (HDC_VAULTWARDEN_MASTER_PASSWORD,
HDC_VAULTWARDEN_ADMIN_TOKEN, HDC_VAULTWARDEN_KEY_CLIENT_ID, HDC_VAULTWARDEN_KEY_CLIENT_SECRET) stay in the local vault only.

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
    if (sub === "sync-uris") {
      const c = helpExe(deps);
      deps.log(`secrets sync-uris — set HDC service website URLs on Vaultwarden Login items

Derives URLs from clump configs, nginx-waf host names, and inventory LAN addresses.
Infra-only API keys (Cloudflare, AWS, SSH passwords, …) are left without website URLs.

Usage:
  ${c} secrets sync-uris [--dry-run] [--key <ENV_NAME>] [--force]

  --dry-run   List URI updates without writing to Vaultwarden.
  --key       Sync one env key only (item name must match exactly).
  --force     Overwrite URIs even when the item already has website URLs.

Examples:
  ${c} secrets sync-uris --dry-run
  ${c} secrets sync-uris --key HDC_UPTIME_KUMA_PASSWORD
  ${c} secrets sync-uris --force
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
    if (sub === "backup") {
      const c = helpExe(deps);
      deps.log(`secrets backup — off-workstation copies of the vault and bootstrap files

Copies vault.enc as-is (already AES-256-GCM encrypted) and writes an encrypted bundle
of bootstrap files (root .env plus every clump .env under hdc and hdc-private) to each
destination directory. The bundle is encrypted with the local vault passphrase.
Retention keeps the newest N files per prefix (hdc-vault-*, hdc-bootstrap-*).

Usage:
  ${c} secrets backup [--dest <dir> ...] [--retain <n>] [--dry-run]

Destinations default to HDC_VAULT_BACKUP_DIRS in .env (";"-separated paths, e.g. a NAS
share plus a second copy). Retention defaults to HDC_VAULT_BACKUP_RETAIN or 30.
When HDC_VAULT_BACKUP_DIRS is set, "maintain daily" runs this backup automatically.

Examples:
  ${c} secrets backup --dest \\\\nas-a\\backups\\hdc-vault
  ${c} secrets backup --retain 14 --dry-run
`);
      return;
    }
    if (sub === "restore-bootstrap") {
      const c = helpExe(deps);
      deps.log(`secrets restore-bootstrap — recover bootstrap .env files from a backup bundle

Decrypts an hdc-bootstrap-<timestamp>.enc bundle (written by "secrets backup") with the
vault passphrase and writes the contained .env files under --out-dir, preserving their
repo-relative layout (hdc/.env, hdc-private/clumps/<tier>/<id>/.env, ...).

Usage:
  ${c} secrets restore-bootstrap <file> --out-dir <dir> [--force]

Example:
  ${c} secrets restore-bootstrap hdc-bootstrap-2026-07-18T03-00-00.enc --out-dir ./restored
`);
      return;
    }
    die(
      deps,
      `help secrets: unknown subtopic ${JSON.stringify(sub)} (try: path, init, change-passphrase, set, list, get, dump, delete, unlock, push, backup, restore-bootstrap)`,
    );
  }

  if (a0 === "users") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`users — host-local user operations

Subcommands:
  bootstrap-hdc  Create/update the "hdc" Linux user over SSH for hosts listed in clump config or explicit JSON sidecars.

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

- With no --sidecar, hdc reads bootstrap_hosts from clumps/infrastructure/ubuntu/config.json and
  clumps/infrastructure/proxmox/config.json (if present). Each host entry uses the same shape as
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
  ${c} maintain daily [--skip-vault-backup] [--skip-private-git-check] [--skip-lock]
  ${c} maintain daily [--step-timeout-ms <n>]
  ${c} maintain daily -- [--only service/bind]   # flags after -- also accepted

Runs configured packages sequentially (continues on failure). Skips packages without
config.json. Applies routine updates (Docker pull, guest apt, DSM packages) but avoids
prune, rolling restarts, and reboots. Home clients run query only.

Built-in steps (skipped when using --only): fails the run when hdc-private has
uncommitted or unpushed changes (--skip-private-git-check to disable), and backs up
vault.enc + bootstrap .env bundle when HDC_VAULT_BACKUP_DIRS is set (--skip-vault-backup).

Writes an aggregated markdown report under apps/hdc-cli/reports/ (hdc-private when present).

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
 * @param {"get" | "dump"} sub
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
  if (sub === "sync-uris") {
    // Lazy: vault-key-uris pulls hdc/clump/* (not present in slim agent images).
    const { parseSecretsSyncUrisArgv, syncVaultKeyUris } = await import("./vaultwarden-sync-uris.mjs");
    const parsed = parseSecretsSyncUrisArgv(argv.slice(1));
    const vwCli = vaultwardenCliDepsFromCli(deps, deps.spawnSync);
    const result = await syncVaultKeyUris(access, vwCli, parsed);
    if (result.errorKeys.length > 0) {
      die(
        deps,
        `secrets sync-uris: ${result.errorKeys.length} key(s) failed (${result.errorKeys.join(", ")})`,
      );
    }
    if (parsed.dryRun) {
      deps.log(
        `[dry-run] would update ${result.updated} item URI(s); ${result.unchanged} unchanged; ${result.skipped} skipped (no HDC URL)`,
      );
    } else {
      deps.log(
        `secrets sync-uris: ${result.updated} updated, ${result.unchanged} unchanged, ${result.skipped} skipped (no HDC URL)`,
      );
    }
    return;
  }
  if (sub === "get" || sub === "dump") {
    await cmdSecretsExport(deps, sub, argv.slice(1));
    return;
  }
  if (sub === "backup") {
    const parsed = parseSecretsBackupArgv(argv.slice(1), deps.env);
    if (parsed.dests.length === 0) {
      die(
        deps,
        "secrets backup: no destination (use --dest <dir> or set HDC_VAULT_BACKUP_DIRS)",
      );
    }
    let passphrase = "";
    if (!parsed.dryRun) {
      try {
        passphrase = await unlockLocalVaultPassphrase(deps);
      } catch (e) {
        if (e instanceof CliExit) throw e;
        die(deps, `secrets backup: ${/** @type {Error} */ (e).message}`);
      }
    }
    const result = runSecretsBackup({
      vaultPath,
      passphrase,
      publicRoot: deps.repoRoot(),
      env: deps.env,
      dests: parsed.dests,
      retain: parsed.retain,
      dryRun: parsed.dryRun,
      log: deps.log,
      warn: deps.warn,
    });
    if (!result.ok) {
      die(deps, "secrets backup: one or more destinations failed");
    }
    return;
  }
  if (sub === "restore-bootstrap") {
    const file = argv[1] && !argv[1].startsWith("-") ? argv[1] : null;
    if (!file) die(deps, "secrets restore-bootstrap: need a bundle file path");
    const outIdx = argv.indexOf("--out-dir");
    const outDir = outIdx !== -1 ? (argv[outIdx + 1] ?? null) : null;
    if (!outDir) die(deps, "secrets restore-bootstrap: --out-dir <dir> is required");
    if (!deps.existsSync(file)) {
      die(deps, `secrets restore-bootstrap: no such file: ${file}`);
    }
    let passphrase = "";
    try {
      passphrase = await unlockLocalVaultPassphrase(deps);
    } catch (e) {
      if (e instanceof CliExit) throw e;
      die(deps, `secrets restore-bootstrap: ${/** @type {Error} */ (e).message}`);
    }
    try {
      const { written } = restoreBootstrapBundle({
        file,
        passphrase,
        outDir,
        force: argv.includes("--force"),
      });
      deps.log(`restored ${written.length} file(s) under ${deps.resolve(outDir)}`);
    } catch (e) {
      die(deps, /** @type {Error} */ (e).message);
    }
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
    const manifests = discoverAllClumpManifests(root, deps.env);
    const m = manifestByTierAndId(manifests, packageRun.tier, packageRun.id);
    if (!m) {
      die(deps, `env: no package ${packageRun.tier}/${packageRun.id}`);
    }
    const includes = resolveEnvIncludes(m, root, deps.env);
    const pkgRel = deps.relative(root, deps.join(m.dir, ".env")).replace(/\\/g, "/");
    deps.log(
      `Effective HDC_* for ${packageRun.tier}/${manifestId(m)} (global + ${includes.length ? `includes: ${includes.join(", ")} + ` : ""}${pkgRel}; redacted).`,
    );
    const runEnv = buildClumpRunEnv(deps, root, m);
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
    `Global HDC_* variables (.env: ${relDotenv} ${dotenvPresent ? "exists" : "missing"}; per-clump: clumps/<tier>/<id>/.env).`,
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
  const manifests = discoverAllClumpManifests(root, deps.env);
  deps.log("Clumps (manifest.json):");
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
  deps.log("\nOptional per-clump config (clumps/<tier-dir>/<id>/config.json; see config.example.json):");
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
async function cmdClumps(deps, root, argv) {
  const sub = argv[0] ?? "list";
  const config = loadClumpsReposConfig(root, deps.env);
  if (sub === "init" || sub === "sync") {
    const dryRun = argv.includes("--dry-run");
    const repoIdx = argv.indexOf("--repo");
    const onlyId = repoIdx >= 0 ? String(argv[repoIdx + 1] || "").trim() : "";
    const refIdx = argv.indexOf("--ref");
    const refOverride = refIdx >= 0 ? String(argv[refIdx + 1] || "").trim() : "";
    const noPersist = argv.includes("--no-persist");
    const explicitPersist = argv.includes("--persist");
    if (explicitPersist && !refOverride) {
      die(deps, "clumps sync: --persist requires --ref <branch|tag|sha>");
    }
    if (refIdx >= 0 && !refOverride) {
      die(deps, "clumps sync: --ref requires a branch, tag, or commit");
    }
    /** Persist by default when --ref is set; --no-persist keeps a one-shot checkout. */
    const shouldPersist = Boolean(refOverride) && !noPersist;

    const targets = config.repos
      .filter((r) => !onlyId || r.id === onlyId)
      .map((r) => (refOverride ? { ...r, ref: refOverride } : r));
    if (!targets.length) die(deps, `clumps: unknown repo ${JSON.stringify(onlyId)}`);
    let failed = false;
    /** @type {{ id: string; ref: string; resolved: string|null; action: string }[]} */
    const synced = [];
    for (const repo of targets) {
      const r = syncClumpRepo(config, repo, {
        dryRun,
        log: (line) => deps.log(`[hdc] ${line}`),
      });
      if (!r.ok) {
        failed = true;
        deps.error(
          `[hdc] clumps sync failed for ${repo.id} @ ${repo.ref} (${r.action})`,
        );
        continue;
      }
      synced.push({ id: repo.id, ref: r.ref, resolved: r.resolved, action: r.action });
      if (r.resolved) {
        deps.log(`[hdc] ${repo.id} resolved ${r.resolved.slice(0, 12)} @ ${r.ref}`);
      }
    }
    if (failed) die(deps, "clumps sync: one or more repos failed");

    if (shouldPersist && !dryRun) {
      try {
        for (const row of synced) {
          const written = persistClumpRepoRef(root, row.id, row.ref, deps.env);
          deps.log(`[hdc] persisted ${row.id} ref=${row.ref} → ${written.path}`);
        }
      } catch (e) {
        die(deps, e instanceof Error ? e.message : String(e));
      }
    } else if (shouldPersist && dryRun) {
      deps.log(`[hdc] would persist ref=${refOverride} for ${synced.map((s) => s.id).join(", ")}`);
    }
    return;
  }
  if (sub !== "list") die(deps, "clumps: need list, sync, or init");
  const showReference = argv.includes("--reference");
  deps.log("Clump repositories:");
  for (const repo of config.repos) {
    if (repo.mode === "reference" && !showReference) continue;
    const rootEntry = resolveClumpRoots(config, { ...deps.env, HDC_REPO_ROOT: root }).find(
      (r) => r.repoId === repo.id,
    );
    const count = rootEntry ? discoverManifests(rootEntry.root).length : 0;
    const head = rootEntry ? readClumpRepoResolved(rootEntry.root) : null;
    const headShort = head ? head.slice(0, 12) : null;
    const state = rootEntry
      ? `synced (${count} manifests${headShort ? `; HEAD ${headShort}` : ""})`
      : "missing — run: hdc clumps sync";
    deps.log(`  ${repo.id}\t${repo.mode}\t${repo.url} @ ${repo.ref}\t${state}`);
  }
}

async function cmdRun(deps, root, argv) {
  const { forward, extra } = splitRunArgs(argv);
  if (forward.length < 3) {
    die(deps, `run: need <tier> <clump> <verb> (tiers: ${runTiersUsage()})`);
  }
  const manifests = discoverAllClumpManifests(root, deps.env);
  const tierToken = forward[0];
  const m = resolveRunManifest(deps, manifests, tierToken, forward[1]);
  const inv = resolveRunInvocation(forward.slice(1), m);
  if ("error" in inv) die(deps, `run: ${inv.error}`);
  const { clumpId, platform, verb } = inv;

  if (resolveSecretBackendMode(deps.env) === "vaultwarden") {
    const vault = createVaultAccess(vaultDepsFromCli(deps));
    try {
      await vault.unlock({});
    } catch (e) {
      die(deps, `run: vault unlock failed: ${/** @type {Error} */ (e).message || e}`);
    }
  }

  if (verb !== "query") {
    const checkEnv = buildClumpRunEnv(deps, root, m);
    for (const key of envRequired(m)) {
      if (!checkEnv[key]) {
        deps.warn(`warning: env ${key} is not set (declared env_required in manifest)`);
      }
    }
  }
  const spec = verbSpec(m, verb);
  if (!spec) die(deps, `run: package ${clumpId} has no ${verb} script in manifest`);
  const cwd = runScriptDir(m, platform, verb);
  const script = deps.join(cwd, spec.script);
  if (!deps.existsSync(script)) die(deps, `run: missing script ${script}`);
  const pipeStdoutJson =
    verb === "query" || verb === "health" || verb === "deploy" || verb === "teardown";
  const clumpRunEnv = buildClumpRunEnv(deps, root, m);
  const runEnv = augmentPackageSpawnEnv(
    clumpRunEnv,
    cliAppDir(),
    primaryClumpsRoot(root, clumpRunEnv),
  );
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
    if (cmd === "clumps") {
      await cmdClumps(deps, root, rest);
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
    } else if (cmd === "docs") {
      if (rest[0] !== "lint") {
        die(deps, 'docs: need subcommand "lint"');
      }
      const strict = rest.includes("--strict");
      const result = runDocsLint({
        publicRoot: root,
        privateRoot: hdcPrivateRoot(root, deps.env),
        strict,
        log: (line) => deps.log(`[hdc] docs lint: ${line}`),
      });
      for (const err of result.errors) {
        const prefix = err.level === "warning" ? "warning" : "error";
        const fn = err.level === "warning" ? deps.warn : deps.error;
        fn(`[hdc] docs lint: ${prefix}: ${err.path}: ${err.message}`);
      }
      deps.log(
        `[hdc] docs lint: ${result.schemaCount} schema(s), ${result.checked} file(s) checked, ${result.errors.filter((e) => e.level === "error").length} error(s), ${result.errors.filter((e) => e.level === "warning").length} warning(s)`,
      );
      return result.ok ? 0 : 1;
    } else {
      usage(deps);
      die(deps, `unknown command: ${cmd}`, 1);
    }
  } catch (e) {
    if (e instanceof CliExit) return e.code;
    throw e;
  }
}
