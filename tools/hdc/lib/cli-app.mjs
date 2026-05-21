import {
  discoverManifests,
  envRequired,
  inventoryDocs,
  formatManifestServiceInvoke,
  manifestById,
  manifestId,
  manifestServices,
  manifestTitle,
  verbSpec,
  VERBS,
} from "../manifests.mjs";
import { writeVault } from "../vault.mjs";
import { CliExit } from "./cli-exit.mjs";
import { splitRunArgs } from "./split-run-args.mjs";
import { collectHdcEnvRows } from "./hdc-env-report.mjs";
import { createVaultAccess, vaultDepsFromCli } from "./vault-access.mjs";
import { runUsersBootstrapHdc } from "./users-bootstrap-hdc.mjs";

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
  ${c} run <package> <verb> [-- <extra args...>]
  ${c} secrets path
  ${c} secrets init   # new vault: passphrase prompt, or HDC_VAULT_PASSPHRASE once
  ${c} secrets set <ENV_NAME> [--stdin | --value <s>]
  ${c} secrets delete <ENV_NAME>
  ${c} secrets list
  ${c} users bootstrap-hdc [--dry-run] [--sidecar <path> ...]
  ${c} env              # HDC_* variables (secrets redacted)

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
  ${c} help run [ <package> [ <verb> ] ]
  ${c} help secrets [ path | init | set | list | delete ]
  ${c} help users [ bootstrap-hdc ]
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
  ${c} help run proxmox query
  ${c} help secrets set

Topics mirror real commands: "run" is followed by a package id (from manifest.json under packages/<folder>/),
then a verb (${VERBS.join(", ")}). Package scripts live under packages/<package>/<verb>/.
`);
    return;
  }

  if (a0 === "env") {
    if (topics.length > 1) die(deps, `help: too many arguments after "env"`);
    const c = helpExe(deps);
    deps.log(`env — show HDC_* environment variables

Prints every variable in the current process whose name starts with ${JSON.stringify("HDC_")},
sorted by name. Values that look like secrets (names containing PASSWORD, TOKEN, etc.) are not
shown in full — only length — so you can safely copy this output into chats or tickets.

The repo ${JSON.stringify(".env")} file is loaded at CLI startup for most commands, but only for keys
that are not already defined in the parent environment (see ${c} secrets path and vault docs).

Examples:
  ${c} env
`);
    return;
  }

  if (a0 === "list") {
    if (topics.length > 1) die(deps, `help: too many arguments after "list"`);
    const c = helpExe(deps);
    deps.log(`list — show hdc packages (from packages/*/manifest.json)

Each row is a package id, title, and which verbs exist (deploy / maintain / query). These are the
hdc entrypoints (${c} run <package> <verb>).

Structured facts for automation live in optional per-package config.json files under
packages/infrastructure/<id>/ and packages/services/<id>/ (see each package's config.example.json).

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
  ${c} run <package> <verb> [-- <extra args...>]

- <package> is the manifest "id" (or the packages/ folder name if id is missing).
- <verb> must be one of: ${VERBS.join(", ")}.
- Everything after "--" is forwarded to the package script (not parsed by hdc).

The child process uses cwd packages/<folder>/<verb>/ and runs:
  <node> <script path> <extra args...>

When a query or deploy plugin exits 0 and prints JSON to stdout, hdc forwards that output to the
terminal unchanged. Package scripts do not update repo inventory paths.

Discover packages:
  ${c} list
Drill into one package or verb:
  ${c} help run <package>
  ${c} help run <package> <verb>
`);
      return;
    }
    if (topics.length > 3) die(deps, `help: too many arguments after "run ${a1} ${a2}"`);

    const manifests = discoverManifests(deps.packagesDir(root));
    const packageId = a1;
    const m = manifestById(manifests, packageId);
    if (!m) die(deps, `help run: unknown package ${JSON.stringify(packageId)}`);

    if (topics.length === 2) {
      const lines = [];
      lines.push(`run — package ${manifestId(m)} (${manifestTitle(m)})`);
      lines.push("");
      lines.push(`Manifest: ${deps.relative(root, m.path).replace(/\\/g, "/")}`);
      const req = envRequired(m);
      if (req.length) lines.push(`env_required (from manifest): ${req.join(", ")}`);
      else lines.push("env_required (from manifest): (none)");
      const invDocs = inventoryDocs(m);
      if (invDocs.length) lines.push(`inventory_docs: ${invDocs.join(", ")}`);
      lines.push("");
      lines.push("Verbs (see help run <package> <verb> for script path and preview):");
      for (const v of VERBS) {
        const spec = verbSpec(m, v);
        lines.push(spec ? `  ${v}\t${spec.script}` : `  ${v}\t(not configured)`);
      }
      const services = manifestServices(m);
      if (services.length) {
        lines.push("");
        lines.push("Services (capabilities exposed by this package):");
        const pkg = manifestId(m);
        const c = helpExe(deps);
        for (const svc of services) {
          const inv = formatManifestServiceInvoke(svc, pkg);
          const invokePart = svc.invoke ? ` → ${svc.invoke}` : "";
          lines.push(`  ${svc.id}\t${svc.verb}${invokePart}\t${svc.title}`);
          if (svc.summary) lines.push(`\t${svc.summary}`);
          lines.push(`\t${c} ${inv} …`);
        }
      }
      lines.push("");
      lines.push(`Example: ${helpExe(deps)} run ${manifestId(m)} <verb> [-- ...]`);
      deps.log(lines.join("\n"));
      return;
    }

    const verb = a2;
    if (!VERBS.includes(verb)) die(deps, `help run: verb must be one of: ${VERBS.join(", ")}`);
    const spec = verbSpec(m, verb);
    if (!spec) die(deps, `help run: package ${JSON.stringify(packageId)} has no ${verb} script in manifest`);
    const cwd = deps.join(m.dir, verb);
    const scriptAbs = deps.join(cwd, spec.script);
    const relScript = deps.relative(root, scriptAbs).replace(/\\/g, "/");
    const c = helpExe(deps);
    const queryNote =
      verb === "query" || verb === "deploy"
        ? `On exit 0, stdout from the script is written to the terminal as received (no hdc post-processing).\n\n`
        : "";
    deps.log(`run — package ${manifestId(m)} (${manifestTitle(m)}), verb ${verb}

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
function cmdEnv(deps, root) {
  const relDotenv = deps.relative(root, deps.join(root, ".env")).replace(/\\/g, "/");
  const dotenvPath = deps.join(root, ".env");
  const dotenvPresent = deps.existsSync(dotenvPath);
  deps.log(
    `HDC_* variables in the CLI process environment (.env: ${relDotenv} ${dotenvPresent ? "exists" : "missing"}; load skips keys already set outside .env).`,
  );
  const rows = collectHdcEnvRows(deps.env);
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
  for (const m of manifests) {
    const verbs = VERBS.filter((v) => verbSpec(m, v)).join(", ") || "(none)";
    const svc = manifestServices(m);
    const svcBrief = svc.length
      ? `\tservices: ${svc.map((s) => (s.invoke ? `${s.id}(${s.verb}/${s.invoke})` : `${s.id}(${s.verb})`)).join(", ")}`
      : "";
    deps.log(`  ${manifestId(m)}\t${manifestTitle(m)}\tverbs: ${verbs}${svcBrief}`);
  }
  deps.log("\nOptional per-package config (packages/<tier>/<id>/config.json; see config.example.json):");
  for (const m of manifests) {
    const cfg = deps.join(m.dir, "config.json");
    const rel = deps.relative(root, cfg).replace(/\\/g, "/");
    const state = deps.existsSync(cfg) ? "exists" : "(optional)";
    deps.log(`  ${manifestId(m)}\t${rel}\t${state}`);
  }
}

/**
 * @param {CliDeps} deps
 * @param {string} root
 * @param {string[]} argv
 */
function cmdRun(deps, root, argv) {
  const { forward, extra } = splitRunArgs(argv);
  const packageId = forward[0];
  const verb = forward[1];
  if (!packageId || !verb) die(deps, "run: need <package> <verb>");
  if (!VERBS.includes(verb)) die(deps, `run: verb must be one of: ${VERBS.join(", ")}`);
  const manifests = discoverManifests(deps.packagesDir(root));
  const m = manifestById(manifests, packageId);
  if (!m) die(deps, `run: unknown package ${JSON.stringify(packageId)}`);
  for (const key of envRequired(m)) {
    if (!deps.env[key]) {
      deps.warn(`warning: env ${key} is not set (declared env_required in manifest)`);
    }
  }
  const spec = verbSpec(m, verb);
  if (!spec) die(deps, `run: package ${packageId} has no ${verb} script in manifest`);
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
      cmdEnv(deps, root);
      return 0;
    }
    if (cmd === "run") {
      cmdRun(deps, root, rest);
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
