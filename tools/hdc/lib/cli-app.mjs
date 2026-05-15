import {
  applyQueryToSidecar,
  automationTargetIds,
  AUTOMATION_TARGET_INVENTORY_FILENAME,
  findInventorySidecars,
  loadManualInventoryIdKindMap,
  mergeAutomatedSystemsFromPlugin,
  mergeQueryStdoutIntoAutomationInventory,
  tryParseJsonObject,
  validateSidecar,
} from "../inventory.mjs";
import {
  discoverManifests,
  envRequired,
  inventoryDocs,
  manifestById,
  manifestId,
  manifestTitle,
  verbSpec,
  VERBS,
} from "../manifests.mjs";
import { writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";
import { splitRunArgs } from "./split-run-args.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { runUsersBootstrapHdc } from "./users-bootstrap-hdc.mjs";
import {
  ensureLocalSystemAutomatedInventory,
  shouldSkipLocalSystemInventoryCollection,
} from "./local-system-automated-inventory.mjs";

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
 * @property {(root: string) => string} automationDir
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
  ${c} run <target> <verb> [-- <extra args...>]
  ${c} docs lint
  ${c} docs sync [--dry-run]
  ${c} inventory apply --sidecar <path> --from-json <path>
  ${c} secrets path
  ${c} secrets init   # new vault: passphrase prompt, or HDC_VAULT_PASSPHRASE once
  ${c} secrets set <ENV_NAME> [--stdin | --value <s>]
  ${c} secrets delete <ENV_NAME>
  ${c} secrets list
  ${c} users bootstrap-hdc [--dry-run] [--sidecar <path> ...]

verbs: ${VERBS.join(", ")}

More detail: ${c} help [ <command> [ <subcommand> ... ] ]
`);
}

const HELP_SCRIPT_PREVIEW_LINES = 28;

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
  ${c} help run [ <target> [ <verb> ] ]
  ${c} help docs [ lint | sync ]
  ${c} help inventory [ apply ]
  ${c} help secrets [ path | init | set | list | delete ]
  ${c} help users [ bootstrap-hdc ]`);
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
  ${c} help run proxmox query
  ${c} help secrets set

Topics mirror real commands: "run" is followed by an automation target id (from manifest.json),
then a verb (${VERBS.join(", ")}). Target scripts live under automation/<target>/<verb>/.
`);
    return;
  }

  if (a0 === "list") {
    if (topics.length > 1) die(deps, `help: too many arguments after "list"`);
    const c = helpExe(deps);
    deps.log(`list — show automation targets and inventory sidecars

Output has three sections:

1) Automation targets — each row is a plugin under automation/<name>/ (from manifest.json): id,
   title, and which verbs exist (deploy / maintain / query). These are the automation entrypoints
   (${c} run <target> <verb>).

2) Automation inventory — one path per target: automation/<name>/${AUTOMATION_TARGET_INVENTORY_FILENAME}.
   Shown as "exists" or "(created on first qualifying query)". After a successful query whose stdout
   is a single JSON object, hdc writes query_last and last_verified there (see ${c} help run).

3) Inventory sidecars — every *.inventory.json under inventory/manual/<kind>/ (repo-relative
   paths). A sidecar is structured data for equipment you run yourself (not fully driven by a
   single plugin): stable id, kind (system | network | target | services), access (nodes with IPs,
   Web UI / SSH URLs), tags, optional automation_targets (must name ids from section 1), notes, etc.
   Auth values are env var *names* only (e.g. HDC_PROXMOX_SSH_USER); never put secrets in JSON —
   use ${c} secrets … and reference keys from auth.

Optional sibling *.md files (e.g. systems/nas.md) are for human or agent notes only; hdc does not
read or write them.

Workflow after editing JSON: ${c} docs lint (or ${c} docs sync — same validation, no markdown changes).

For automation plugins, a successful ${c} run <target> query that prints one JSON object on stdout
updates automation/<target>/${AUTOMATION_TARGET_INVENTORY_FILENAME} automatically (query_last).
To merge query output into a *docs* sidecar instead, use ${c} inventory apply (see ${c} help inventory apply).

Examples:
  ${c} list
`);
    return;
  }

  if (a0 === "run") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`run — execute an automation plugin script

Usage:
  ${c} run <target> <verb> [-- <extra args...>]

- <target> is the manifest "id" (or the automation folder name if id is missing).
- <verb> must be one of: ${VERBS.join(", ")}.
- Everything after "--" is forwarded to the target script (not parsed by hdc).

The child process uses cwd automation/<folder>/<verb>/ and runs:
  <node> <script path> <extra args...>

When a query plugin exits 0 and prints a single JSON object to stdout (and nothing else you need
preserved), hdc writes/updates automation/<target>/${AUTOMATION_TARGET_INVENTORY_FILENAME} with
query_last set to that object and last_verified set to the current time. Other top-level keys in
that file are kept. If stdout is empty or not valid JSON, the file is left unchanged and hdc logs
a short warning. Valid JSON stdout also merges into inventory/automated/systems.json (per-plugin
sources plus optional systems[] entries).

On successful deploy, hdc always updates inventory/automated/systems.json (per-plugin deploy
timestamp); if stdout is a JSON object, it is merged the same way as query payloads.

Discover targets:
  ${c} list
Drill into one target or verb:
  ${c} help run <target>
  ${c} help run <target> <verb>

Inventory sidecars (structured facts for gear you run by hand) live under inventory/manual/
— the same ${c} list output explains them; see ${c} help list and ${c} help docs.
`);
      return;
    }
    if (topics.length > 3) die(deps, `help: too many arguments after "run ${a1} ${a2}"`);

    const manifests = discoverManifests(deps.automationDir(root));
    const target = a1;
    const m = manifestById(manifests, target);
    if (!m) die(deps, `help run: unknown target ${JSON.stringify(target)}`);

    if (topics.length === 2) {
      const lines = [];
      lines.push(`run — target ${manifestId(m)} (${manifestTitle(m)})`);
      lines.push("");
      lines.push(`Manifest: ${deps.relative(root, m.path).replace(/\\/g, "/")}`);
      const req = envRequired(m);
      if (req.length) lines.push(`env_required (from manifest): ${req.join(", ")}`);
      else lines.push("env_required (from manifest): (none)");
      const invDocs = inventoryDocs(m);
      if (invDocs.length) lines.push(`inventory_docs: ${invDocs.join(", ")}`);
      lines.push("");
      lines.push("Verbs (see help run <target> <verb> for script path and preview):");
      for (const v of VERBS) {
        const spec = verbSpec(m, v);
        lines.push(spec ? `  ${v}\t${spec.script}` : `  ${v}\t(not configured)`);
      }
      lines.push("");
      lines.push(`Example: ${helpExe(deps)} run ${manifestId(m)} <verb> [-- ...]`);
      deps.log(lines.join("\n"));
      return;
    }

    const verb = a2;
    if (!VERBS.includes(verb)) die(deps, `help run: verb must be one of: ${VERBS.join(", ")}`);
    const spec = verbSpec(m, verb);
    if (!spec) die(deps, `help run: target ${JSON.stringify(target)} has no ${verb} script in manifest`);
    const cwd = deps.join(m.dir, verb);
    const scriptAbs = deps.join(cwd, spec.script);
    const relScript = deps.relative(root, scriptAbs).replace(/\\/g, "/");
    const c = helpExe(deps);
    const invRel = deps
      .relative(root, deps.join(m.dir, AUTOMATION_TARGET_INVENTORY_FILENAME))
      .replace(/\\/g, "/");
    const autoRel = deps.relative(root, deps.join(root, "inventory", "automated", "systems.json")).replace(/\\/g, "/");
    const queryNote =
      verb === "query"
        ? `On exit 0, stdout is written to the terminal, then parsed; if it is one JSON object, hdc updates ${invRel} (query_last + last_verified) and merges into ${autoRel} when JSON is valid.\n\n`
        : verb === "deploy"
          ? `On exit 0, hdc updates ${autoRel} (deploy timestamp; optional JSON stdout merges like query).\n\n`
          : "";
    deps.log(`run — target ${manifestId(m)} (${manifestTitle(m)}), verb ${verb}

Manifest: ${deps.relative(root, m.path).replace(/\\/g, "/")}
Working directory (spawn cwd): ${deps.relative(root, cwd).replace(/\\/g, "/")}
Script (manifest): ${spec.script}
Script (repo path): ${relScript}

Invoke:
  ${c} run ${manifestId(m)} ${verb} [-- <args for ${spec.script}>]

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

  if (a0 === "docs") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`docs — inventory sidecars (JSON only for hdc)

Inventory sidecars live under inventory/manual/*/*.inventory.json. They hold machine-readable
facts about manually deployed systems. Companion *.md files beside a sidecar are optional and are
not read or written by hdc (use them for human or agent notes only).

${c} docs lint checks every sidecar JSON (see tools/hdc/schema/inventory.*.schema.json: system, network, target, services).

${c} docs sync runs the same JSON checks as lint; it does not modify any markdown files.

Examples:
  ${c} docs lint
  ${c} docs sync [--dry-run]

More:
  ${c} help docs lint
  ${c} help docs sync`);
      return;
    }
    if (topics.length > 2) die(deps, `help: too many arguments after "docs ${a1}"`);
    if (a1 === "lint") {
      const c = helpExe(deps);
      deps.log(`docs lint — validate inventory sidecars

Walks inventory/manual/*/*.inventory.json and flags problems before you commit.

Checks include: parseable JSON; schema_version 1; non-empty id; kind in system | network | target | services;
system.services refs (id of a kind services sidecar, optional nodes); duplicate ids across manual files;
kind target requires automation_target naming a manifest id; virtual systems require hosted_on_system_id;
optional automation_targets (system/network/services) entries must match automation/*/ manifest ids; auth fields must
look like HDC_* env names (not inline passwords); heuristic scan for PEM / huge base64 blobs.

Companion *.md files are not validated or required by hdc.

Examples:
  ${c} docs lint
`);
      return;
    }
    if (a1 === "sync") {
      const c = helpExe(deps);
      deps.log(`docs sync — validate inventory JSON (no markdown updates)

Runs the same checks as ${c} docs lint on each *.inventory.json under inventory/manual/. Optional
sibling *.md files are ignored by hdc.

Use --dry-run for the same validation and logging (no side effects either way).

Examples:
  ${c} docs sync
  ${c} docs sync --dry-run
`);
      return;
    }
    die(deps, `help docs: unknown subtopic ${JSON.stringify(a1)} (try: lint, sync)`);
  }

  if (a0 === "inventory") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`inventory — sidecar JSON maintenance

Automation targets also keep automation/<id>/${AUTOMATION_TARGET_INVENTORY_FILENAME}; that file is
updated automatically when ${c} run <id> query exits 0 with JSON stdout (no manual step).

Inventory sidecars (*.inventory.json under inventory/manual/) describe manually operated
systems. The apply subcommand is for tucking the *last* structured output from a query plugin into
the sidecar: it sets query_last to the JSON object from --from-json and sets last_verified to the
current UTC time, then re-validates like ${c} docs lint.

Use this when you captured query JSON and want it in an inventory/manual sidecar (human
system/network record).

Example:
  ${c} help inventory apply`);
      return;
    }
    if (topics.length > 2) die(deps, `help: too many arguments after "inventory ${a1}"`);
    if (a1 === "apply") {
      const c = helpExe(deps);
      deps.log(`inventory apply — merge query JSON into a sidecar

Usage:
  ${c} inventory apply --sidecar <path> --from-json <path>

--sidecar   Target inventory JSON (repo-relative or absolute), e.g.
            inventory/manual/systems/pve-a.inventory.json
--from-json File containing one JSON object (e.g. saved stdout from ${c} run <target> query).

The sidecar is read (or treated as empty if missing), then query_last is replaced with the parsed
object from --from-json and last_verified is set. The file is written back and validated the same
way as ${c} docs lint. (Per-target automation inventory under automation/<target>/${AUTOMATION_TARGET_INVENTORY_FILENAME}
is updated by successful query runs and does not use this command.)

End-to-end example (shell saves query output, merges into sidecar, refreshes docs):

  ${c} run proxmox query > /tmp/proxmox-query.json
  ${c} inventory apply \\
    --sidecar inventory/manual/systems/pve-a.inventory.json \\
    --from-json /tmp/proxmox-query.json
  ${c} docs lint

On Windows PowerShell you might use Set-Content or Out-File instead of > to capture UTF-8 JSON.

Single-command illustration (paths illustrative):
  ${c} inventory apply --sidecar inventory/manual/systems/x.inventory.json --from-json query-out.json
`);
      return;
    }
    die(deps, `help inventory: unknown subtopic ${JSON.stringify(a1)} (try: apply)`);
  }

  if (a0 === "secrets") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`secrets — encrypted vault for environment-style names

Subcommands:
  path    Print the vault file path.
  init    Create an empty vault (passphrase prompt, or HDC_VAULT_PASSPHRASE once).
  set     Set or update a key (ENV-style name).
  list    List keys.
  delete  Remove a key.

Examples:
  ${c} secrets path
  ${c} help secrets set
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
    if (sub === "list") {
      const c = helpExe(deps);
      deps.log(`secrets list — print sorted key names

Requires a readable vault and a working passphrase (typically HDC_VAULT_PASSPHRASE in .env).

Example:
  ${c} secrets list
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
    die(deps, `help secrets: unknown subtopic ${JSON.stringify(sub)} (try: path, init, set, list, delete)`);
  }

  if (a0 === "users") {
    if (topics.length === 1) {
      const c = helpExe(deps);
      deps.log(`users — host-local user operations

Subcommands:
  bootstrap-hdc  Create/update the "hdc" Linux user over SSH for matching inventory sidecars.

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

- With no --sidecar, hdc scans inventory/manual/**/*.inventory.json and selects sidecars
  whose tags include "proxmox" or "ubuntu" (case-insensitive), then uses access.nodes[].ssh plus
  auth.ssh_user_env to decide SSH targets.
- With one or more --sidecar paths, only those files are used (still requires SSH targets inside).

Non-dry-run requires vault unlock (passphrase / HDC_VAULT_PASSPHRASE) to store generated passwords.

Flags:
  --dry-run        Log what would happen; no vault writes and no ssh.
  --sidecar <path> Limit to specific inventory JSON files (repeatable).

Examples:
  ${c} users bootstrap-hdc --dry-run
  ${c} users bootstrap-hdc --sidecar inventory/manual/systems/p.inventory.json
`);
      return;
    }
    die(deps, `help users: unknown subtopic ${JSON.stringify(a1)} (try: bootstrap-hdc)`);
  }

  die(
    deps,
    `help: unknown topic ${JSON.stringify(a0)} (try: help, list, run, docs, inventory, secrets, users)`,
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
  deps.loadDotenv(deps.join(root, ".env"), false);
  return root;
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
  if (sub === "list") {
    if (!deps.existsSync(vaultPath)) {
      die(
        deps,
        `secrets list: no vault at ${vaultPath} (run secrets init or secrets set)`,
      );
    }
    const data = await access.readSecrets({ createIfMissing: false });
    if (data === null) {
      die(deps, "secrets list: vault is missing (unexpected)");
    }
    const keys = Object.keys(data).sort();
    if (keys.length === 0) deps.log("(empty)");
    else for (const k of keys) deps.log(k);
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
    if (!deps.existsSync(vaultPath)) die(deps, `secrets delete: no vault at ${vaultPath}`);
    const data = await access.readSecrets({ createIfMissing: false });
    if (data === null) die(deps, `secrets delete: no vault at ${vaultPath}`);
    if (!(key in data)) die(deps, `secrets delete: no entry ${JSON.stringify(key)}`);
    delete data[key];
    await access.writeSecrets(data);
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
    deps.log(`saved ${key} -> ${vaultPath}`);
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
 * @param {CliDeps} deps
 * @param {string} root
 */
function cmdList(deps, root) {
  const manifests = discoverManifests(deps.automationDir(root));
  deps.log("Automation targets (manifest.json):");
  for (const m of manifests) {
    const verbs = VERBS.filter((v) => verbSpec(m, v)).join(", ") || "(none)";
    deps.log(`  ${manifestId(m)}\t${manifestTitle(m)}\tverbs: ${verbs}`);
  }
  deps.log(`\nAutomation inventory (${AUTOMATION_TARGET_INVENTORY_FILENAME} next to manifest, updated after successful query with JSON stdout):`);
  for (const m of manifests) {
    const inv = deps.join(m.dir, AUTOMATION_TARGET_INVENTORY_FILENAME);
    const rel = deps.relative(root, inv).replace(/\\/g, "/");
    const state = deps.existsSync(inv) ? "exists" : "(created on first qualifying query)";
    deps.log(`  ${manifestId(m)}\t${rel}\t${state}`);
  }
  const autoSystems = deps.join(root, "inventory", "automated", "systems.json");
  deps.log(
    `\nRoot automated systems inventory: ${deps.relative(root, autoSystems).replace(/\\/g, "/")}\t${
      deps.existsSync(autoSystems) ? "exists" : "(created on first qualifying query/deploy merge)"
    }`,
  );
  const sidecars = findInventorySidecars(root);
  deps.log("\nInventory sidecars:");
  for (const p of sidecars) {
    deps.log(`  ${deps.relative(root, p).replace(/\\/g, "/")}`);
  }
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv
 */
function cmdRun(deps, root, argv) {
  const { forward, extra } = splitRunArgs(argv);
  const target = forward[0];
  const verb = forward[1];
  if (!target || !verb) die(deps, "run: need <target> <verb>");
  if (!VERBS.includes(verb)) die(deps, `run: verb must be one of: ${VERBS.join(", ")}`);
  const manifests = discoverManifests(deps.automationDir(root));
  const m = manifestById(manifests, target);
  if (!m) die(deps, `run: unknown target ${JSON.stringify(target)}`);
  for (const key of envRequired(m)) {
    if (!deps.env[key]) {
      deps.warn(`warning: env ${key} is not set (declared env_required in manifest)`);
    }
  }
  const spec = verbSpec(m, verb);
  if (!spec) die(deps, `run: target ${target} has no ${verb} script in manifest`);
  const cwd = deps.join(m.dir, verb);
  const script = deps.join(cwd, spec.script);
  if (!deps.existsSync(script)) die(deps, `run: missing script ${script}`);
  const pipeStdoutJson = verb === "query" || verb === "deploy";
  const r = deps.spawnSync(deps.execPath, [script, ...extra], {
    cwd,
    stdio: pipeStdoutJson ? ["inherit", "pipe", "inherit"] : "inherit",
    env: deps.env,
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
  else if (verb === "deploy" && stdoutStr) deps.stdoutWrite(stdoutStr);
  const targetId = manifestId(m);
  if (status === 0 && verb === "query") {
    const invPath = deps.join(m.dir, AUTOMATION_TARGET_INVENTORY_FILENAME);
    const merged = mergeQueryStdoutIntoAutomationInventory(invPath, stdoutStr);
    if (merged.ok) {
      deps.log(`wrote query snapshot -> ${deps.relative(root, invPath).replace(/\\/g, "/")}`);
    } else {
      deps.warn(`query: did not update ${AUTOMATION_TARGET_INVENTORY_FILENAME}: ${merged.reason}`);
    }
    const parsed = tryParseJsonObject(stdoutStr);
    if (parsed) {
      mergeAutomatedSystemsFromPlugin(root, targetId, "query", parsed);
      deps.log(
        `updated automated systems inventory -> ${deps.relative(root, deps.join(root, "inventory", "automated", "systems.json")).replace(/\\/g, "/")}`,
      );
    }
  }
  if (status === 0 && verb === "deploy") {
    const parsed = tryParseJsonObject(stdoutStr);
    mergeAutomatedSystemsFromPlugin(root, targetId, "deploy", parsed);
    deps.log(
      `updated automated systems inventory -> ${deps.relative(root, deps.join(root, "inventory", "automated", "systems.json")).replace(/\\/g, "/")}`,
    );
  }
  throw new CliExit(status);
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 */
function cmdDocsLint(deps, root) {
  const autoIds = automationTargetIds(root);
  const sidecars = findInventorySidecars(root);
  const { idToKind, duplicateIds } = loadManualInventoryIdKindMap(root, (p) => deps.readFileSync(p, "utf8"));
  /** @type {{ idToKind: Map<string, string> }} */
  const refCtx = { idToKind };
  let errors = 0;
  for (const id of duplicateIds) {
    deps.error(`duplicate inventory id across manual files: ${JSON.stringify(id)}`);
    errors++;
  }
  for (const p of sidecars) {
    let data;
    try {
      data = JSON.parse(deps.readFileSync(p, "utf8"));
    } catch (e) {
      deps.error(`${p}: invalid JSON`, e);
      errors++;
      continue;
    }
    const issues = validateSidecar(data, autoIds, refCtx);
    if (issues.length) {
      deps.error(`${p}:`);
      for (const i of issues) deps.error(`  - ${i}`);
      errors++;
    } else {
      deps.log(`ok ${p}`);
    }
  }
  if (sidecars.length === 0) {
    deps.log("no *.inventory.json files under inventory/manual/");
  }
  throw new CliExit(errors ? 1 : 0);
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {boolean} dryRun
 */
function cmdDocsSync(deps, root, dryRun) {
  const sidecars = findInventorySidecars(root);
  const autoIds = automationTargetIds(root);
  const { idToKind, duplicateIds } = loadManualInventoryIdKindMap(root, (p) => deps.readFileSync(p, "utf8"));
  /** @type {{ idToKind: Map<string, string> }} */
  const refCtx = { idToKind };
  let problems = 0;
  const prefix = dryRun ? "dry-run: " : "";
  for (const id of duplicateIds) {
    deps.error(`duplicate inventory id across manual files: ${JSON.stringify(id)}`);
    problems++;
  }
  for (const p of sidecars) {
    let data;
    try {
      data = JSON.parse(deps.readFileSync(p, "utf8"));
    } catch (e) {
      deps.error(`${p}: ${e}`);
      problems++;
      continue;
    }
    const issues = validateSidecar(data, autoIds, refCtx);
    if (issues.length) {
      deps.error(`${p}: fix lint errors before sync:`);
      issues.forEach((i) => deps.error(`  - ${i}`));
      problems++;
      continue;
    }
    deps.log(`${prefix}ok ${p} (companion .md not used by hdc)`);
  }
  if (sidecars.length === 0) {
    deps.log("no *.inventory.json files under inventory/manual/");
  }
  throw new CliExit(problems ? 1 : 0);
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv
 */
function cmdInventoryApply(deps, root, argv) {
  let sidecar = null;
  let fromJson = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sidecar") sidecar = argv[++i];
    else if (argv[i] === "--from-json") fromJson = argv[++i];
  }
  if (!sidecar || !fromJson) die(deps, "inventory apply: require --sidecar and --from-json");
  const sp = deps.isAbsolute(sidecar) ? sidecar : deps.resolve(root, sidecar);
  const jp = deps.isAbsolute(fromJson) ? fromJson : deps.resolve(root, fromJson);
  if (!deps.existsSync(sp)) die(deps, `sidecar not found: ${sp}`);
  if (!deps.existsSync(jp)) die(deps, `json not found: ${jp}`);
  applyQueryToSidecar(sp, jp);
  const data = JSON.parse(deps.readFileSync(sp, "utf8"));
  const { idToKind, duplicateIds } = loadManualInventoryIdKindMap(root, (p) => deps.readFileSync(p, "utf8"));
  if (duplicateIds.length) {
    deps.error("duplicate inventory ids in manual tree:");
    duplicateIds.forEach((id) => deps.error(`  - ${JSON.stringify(id)}`));
    throw new CliExit(1);
  }
  const issues = validateSidecar(data, automationTargetIds(root), { idToKind });
  if (issues.length) {
    deps.error("Sidecar failed validation after apply:");
    issues.forEach((i) => deps.error(`  - ${i}`));
    throw new CliExit(1);
  }
  deps.log(`updated ${sp}`);
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

    if (!shouldSkipLocalSystemInventoryCollection(argv, deps.env)) {
      ensureLocalSystemAutomatedInventory(deps, root);
    }

    if (cmd === "help") {
      cmdHelp(deps, root, rest);
      return 0;
    }
    if (cmd === "list") {
      cmdList(deps, root);
      return 0;
    }
    if (cmd === "run") {
      cmdRun(deps, root, rest);
    } else if (cmd === "docs" && rest[0] === "lint") {
      cmdDocsLint(deps, root);
    } else if (cmd === "docs" && rest[0] === "sync") {
      const dry = rest.includes("--dry-run");
      cmdDocsSync(deps, root, dry);
    } else if (cmd === "inventory" && rest[0] === "apply") {
      cmdInventoryApply(deps, root, rest.slice(1));
      return 0;
    } else if (cmd === "secrets") {
      if (rest.length === 0) {
        die(deps, "secrets: need a subcommand (path, init, set, list, delete)");
      }
      await cmdSecrets(deps, rest);
      return 0;
    } else if (cmd === "users") {
      if (rest.length === 0) {
        die(deps, "users: need a subcommand (bootstrap-hdc)");
      }
      await cmdUsers(deps, rest);
      return 0;
    } else {
      usage(deps);
      die(deps, `unknown command: ${cmd}`, 1);
    }
  } catch (e) {
    if (e instanceof CliExit) return e.code;
    throw e;
  }
}
