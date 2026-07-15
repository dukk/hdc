import { discoverManifests, manifestByTierAndId, manifestId, manifestRunTier, manifestTitle, verbSpec } from "../../hdc-cli/manifests.mjs";
import { runCli } from "../../hdc-cli/lib/cli-app.mjs";
import { createVaultAccess, vaultDepsFromCli } from "../../hdc-cli/lib/vault-access.mjs";
import {
  AGENTS_DISCORD_WEBHOOK_KEY,
  formatDiscordContent,
  OPS_DISCORD_WEBHOOK_KEY,
  redactIpsFromText,
  resolveOpsDiscordInteractiveConfig,
  sendOpsDiscordMessage,
} from "../../hdc-cli/lib/ops-discord-notify.mjs";
import { runDailyMaintainWithResult } from "../../hdc-cli/lib/daily-maintain.mjs";

import { hdcPrivateRoot } from "../../hdc-cli/lib/private-repo.mjs";
import { createHdcMcpContext, toolErrorResult, toolTextResult } from "./hdc-context.mjs";
import { resolveMcpAuth } from "./api-keys.mjs";
import {
  assertAllowedRunVerb,
  assertApprovedTaskForDeploy,
  assertNoDestructiveRunFlags,
  assertToolAllowedForRole,
  normalizeTier,
  resolveAgentRole,
} from "./policy.mjs";
import { delegateAugmentSubtask } from "../../hdc-agent-server/lib/delegate-augment.mjs";
import { listAugmentorsForRole } from "../../hdc-agent-server/lib/litellm-a2a.mjs";
import {
  assertRepoAllowedForRole,
  defaultRepoForRole,
} from "../../hdc-agent-server/lib/augment-policy.mjs";
import { queueTopicFromAgent } from "../../hdc-agent-server/lib/research-topics.mjs";
import { primaryClumpsRoot } from "../../hdc-cli/manifests.mjs";
import { webFetch, webSearch } from "./web-tools.mjs";
import { validateClump } from "./clump-validate.mjs";

/**
 * Resolve auth (API key preferred) and pin HDC_AGENT_ROLE for this call.
 * @param {Record<string, unknown>} [args]
 * @returns {string} role
 */
function applyMcpAuth(args = {}) {
  const { deps, root } = createHdcMcpContext();
  const privateRoot =
    (args.private_root != null ? String(args.private_root) : "") ||
    hdcPrivateRoot(root, deps.env) ||
    "";
  const auth = resolveMcpAuth({
    env: deps.env,
    privateRoot,
    apiKey: args.api_key != null ? String(args.api_key) : undefined,
    resolveRole: resolveAgentRole,
  });
  process.env.HDC_AGENT_ROLE = auth.role;
  return auth.role;
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcList(args = {}) {
  void args;
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_list");
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
  const { deps, root, capture, resetCapture } = createHdcMcpContext();
  resetCapture();
  const code = await runCli(["list"], deps);
  const manifests = discoverManifests(deps.clumpsDir(root));
  const packages = manifests.map((m) => ({
    id: manifestId(m),
    tier: manifestRunTier(m),
    title: manifestTitle(m),
    verbs: ["deploy", "maintain", "query", "teardown"].filter((v) => verbSpec(m, v)),
  }));
  return toolTextResult({
    ok: code === 0,
    exitCode: code,
    packages,
    log: capture.logLines,
  });
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcHelp(args = {}) {
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_help");
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
  const topics = Array.isArray(args.topics) ? args.topics.map(String) : [];
  const { deps, capture, resetCapture } = createHdcMcpContext();
  resetCapture();
  const code = await runCli(["help", ...topics], deps);
  return toolTextResult({
    ok: code === 0,
    exitCode: code,
    topics,
    help: [...capture.logLines, ...capture.errorLines].join("\n"),
  });
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcMaintainDaily(args = {}) {
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_maintain_daily");
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
  /** @type {string[]} */
  const argv = [];
  if (args.dry_run === true) argv.push("--dry-run");
  if (args.skip_clients === true) argv.push("--skip-clients");
  if (args.skip_upgrades === true) argv.push("--skip-upgrades");
  if (args.no_report === true) argv.push("--no-report");
  if (typeof args.report_path === "string" && args.report_path.trim()) {
    argv.push("--report", args.report_path.trim());
  }
  if (Array.isArray(args.only)) {
    for (const ref of args.only) argv.push("--only", String(ref));
  }
  if (Array.isArray(args.skip)) {
    for (const ref of args.skip) argv.push("--skip", String(ref));
  }

  const { deps, root, capture, resetCapture } = createHdcMcpContext();
  resetCapture();
  const result = await runDailyMaintainWithResult(deps, root, argv);
  return toolTextResult({
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    dryRun: result.dryRun,
    collectedAt: result.collectedAt,
    reportPath: result.reportPath,
    results: result.results,
    log: capture.logLines,
    errors: capture.errorLines,
  });
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcRun(args = {}) {
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_run");
    const role = resolveAgentRole();
    const tier = normalizeTier(String(args.tier ?? ""));
    const clump = String(args.clump ?? "").trim();
    const verb = assertAllowedRunVerb(String(args.verb ?? ""), role);
    if (!clump) throw new Error("clump is required");

    const extra = Array.isArray(args.extra_args) ? args.extra_args.map(String) : [];
    assertNoDestructiveRunFlags(extra);

    const { deps, root, capture, resetCapture } = createHdcMcpContext();
    resetCapture();

    if (verb === "deploy") {
      const privateRoot = hdcPrivateRoot(root, deps.env);
      assertApprovedTaskForDeploy({
        verb,
        taskId: args.task_id != null ? String(args.task_id) : null,
        role,
        privateRoot,
      });
    }

    if (!args.dry_run) {
      const vault = createVaultAccess(vaultDepsFromCli(deps));
      await vault.unlock({});
    }

    const argv = ["run", tier, clump, verb];
    if (extra.length) {
      argv.push("--", ...extra);
    }
    const code = await runCli(argv, deps);

    let payload = null;
    const stdout = capture.stdout.trim();
    if (stdout) {
      try {
        payload = JSON.parse(stdout);
      } catch {
        payload = { raw_stdout: stdout.slice(0, 4000) };
      }
    }

    const manifests = discoverManifests(deps.clumpsDir(root));
    const m = manifestByTierAndId(manifests, tier, clump);

    return toolTextResult({
      ok: code === 0,
      exitCode: code,
      tier,
      clump,
      verb,
      title: m ? manifestTitle(m) : clump,
      payload,
      log: capture.logLines,
      errors: capture.errorLines,
    });
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcNotifyDiscord(args = {}) {
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_notify_discord");
    const message = String(args.message ?? "").trim();
    if (!message) throw new Error("message is required");
    const title = String(args.title ?? "HDC Ops").trim() || "HDC Ops";
    const silent = args.silent === true;
    const dryRun = args.dry_run === true;
    const decision = args.decision === true;
    const taskId = String(args.task_id ?? args.taskId ?? "").trim();
    if (decision && !taskId) throw new Error("task_id is required when decision is true");

    const content = formatDiscordContent(title, redactIpsFromText(message));

    if (dryRun) {
      const interactive = decision
        ? await resolveOpsDiscordInteractiveConfig({ env: process.env })
        : { enabled: false };
      return toolTextResult({
        ok: true,
        dry_run: true,
        content_length: content.length,
        content,
        decision: decision || undefined,
        task_id: taskId || undefined,
        interactive: interactive.enabled === true,
        mode: decision && interactive.enabled ? "bot" : "webhook",
      });
    }

    const { deps } = createHdcMcpContext();
    const vault = createVaultAccess(vaultDepsFromCli(deps));
    const result = await sendOpsDiscordMessage({
      content,
      decision,
      taskId,
      suppressNotifications: silent,
      webhookVaultKey: AGENTS_DISCORD_WEBHOOK_KEY,
      fallbackWebhookVaultKey: OPS_DISCORD_WEBHOOK_KEY,
      env: deps.env,
      getSecret: (key, opts) => vault.getSecret(key, opts),
    });
    return toolTextResult({ ok: true, sent: true, silent, mode: result.mode });
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * Env var name for a one-shot clump repo ref override.
 * @param {string} repoId
 */
export function clumpRepoRefEnvKey(repoId) {
  const id = String(repoId ?? "").trim().toUpperCase().replace(/-/g, "_");
  return `HDC_CLUMPS_REPO_${id}_REF`;
}

/**
 * Build argv for `hdc clumps init|sync`.
 * @param {Record<string, unknown>} [opts]
 * @returns {string[]}
 */
export function buildClumpsSyncArgv(opts = {}) {
  const action = String(opts.action ?? "sync").trim().toLowerCase();
  if (action !== "init" && action !== "sync") {
    throw new Error(`action must be "init" or "sync" (got ${JSON.stringify(opts.action)})`);
  }
  /** @type {string[]} */
  const argv = ["clumps", action];
  if (typeof opts.repo === "string" && opts.repo.trim()) {
    argv.push("--repo", opts.repo.trim());
  }
  if (opts.dry_run === true || opts.dryRun === true) argv.push("--dry-run");
  return argv;
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcClumpsSync(args = {}) {
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_clumps_sync");
    const action = String(args.action ?? "sync").trim().toLowerCase();
    if (action !== "init" && action !== "sync") {
      throw new Error(`action must be "init" or "sync" (got ${JSON.stringify(args.action)})`);
    }
    const repo = typeof args.repo === "string" ? args.repo.trim() : "";
    const ref = typeof args.ref === "string" ? args.ref.trim() : "";
    const argv = buildClumpsSyncArgv({
      action,
      repo: repo || undefined,
      dry_run: args.dry_run === true,
    });

    const { deps, capture, resetCapture } = createHdcMcpContext();
    resetCapture();

    /** @type {Record<string, string | undefined>} */
    const savedEnv = {};
    if (ref) {
      const repoId = repo || "hdc-clumps";
      const key = clumpRepoRefEnvKey(repoId);
      savedEnv[key] = deps.env[key];
      deps.env[key] = ref;
      process.env[key] = ref;
    }

    let code;
    try {
      code = await runCli(argv, deps);
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete deps.env[key];
          delete process.env[key];
        } else {
          deps.env[key] = value;
          process.env[key] = value;
        }
      }
    }

    return toolTextResult({
      ok: code === 0,
      exitCode: code,
      action,
      repo: repo || null,
      ref: ref || null,
      log: capture.logLines,
      errors: capture.errorLines,
    });
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcListAugmentors(args = {}) {
  try {
    const role = applyMcpAuth(args);
    assertToolAllowedForRole("hdc_list_augmentors", role);
    const { deps, root } = createHdcMcpContext();
    const privateRoot =
      (args.private_root != null ? String(args.private_root) : "") ||
      hdcPrivateRoot(root, deps.env) ||
      "";
    const repo =
      typeof args.repo === "string" && args.repo.trim()
        ? args.repo.trim()
        : defaultRepoForRole(role);
    if (!repo) {
      throw new Error("repo is required (or use an augmentor-delegating role)");
    }
    assertRepoAllowedForRole(role, repo);
    const augmentors = await listAugmentorsForRole({
      privateRoot,
      delegatorRole: role,
      repo,
      baseUrl: deps.env.HDC_LITELLM_BASE_URL,
      apiKey:
        deps.env.HDC_AGENT_LITELLM_KEY ||
        deps.env[`HDC_AGENT_LITELLM_KEY_${role.replace(/-/g, "_").toUpperCase()}`] ||
        deps.env.HDC_LITELLM_MASTER_KEY,
    });
    return toolTextResult({ ok: true, repo, role, augmentors });
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcDelegateAugment(args = {}) {
  try {
    const role = applyMcpAuth(args);
    assertToolAllowedForRole("hdc_delegate_augment", role);
    const { deps, root } = createHdcMcpContext();
    const privateRoot =
      (args.private_root != null ? String(args.private_root) : "") ||
      hdcPrivateRoot(root, deps.env) ||
      "";
    const parentTaskId = String(args.parent_task_id ?? args.parentTaskId ?? "").trim();
    if (!parentTaskId) throw new Error("parent_task_id is required");
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required");
    const repo =
      typeof args.repo === "string" && args.repo.trim()
        ? args.repo.trim()
        : defaultRepoForRole(role);
    assertRepoAllowedForRole(role, repo);
    const result = await delegateAugmentSubtask({
      privateRoot,
      delegatorRole: role,
      parentTaskId,
      repo,
      prompt,
      augmentorName:
        typeof args.augmentor_name === "string"
          ? args.augmentor_name
          : typeof args.augmentorName === "string"
            ? args.augmentorName
            : undefined,
      wait: args.wait === true,
      litellmBaseUrl: deps.env.HDC_LITELLM_BASE_URL,
      litellmApiKey:
        deps.env.HDC_AGENT_LITELLM_KEY ||
        deps.env[`HDC_AGENT_LITELLM_KEY_${role.replace(/-/g, "_").toUpperCase()}`] ||
        deps.env.HDC_LITELLM_MASTER_KEY,
    });
    return toolTextResult(result);
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * Queue a research topic for hdc-research (engineer / sre-engineer only).
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcRequestResearch(args = {}) {
  try {
    const role = applyMcpAuth(args);
    assertToolAllowedForRole("hdc_request_research", role);
    const { deps, root } = createHdcMcpContext();
    const privateRoot =
      (args.private_root != null ? String(args.private_root) : "") ||
      hdcPrivateRoot(root, deps.env) ||
      "";
    if (!privateRoot) {
      throw new Error("HDC_PRIVATE_ROOT (or resolved private root) is required");
    }
    const title = String(args.title ?? "").trim();
    if (!title) throw new Error("title is required");
    const topic = queueTopicFromAgent(privateRoot, {
      title,
      suggested_by: role,
      notes: typeof args.notes === "string" ? args.notes : typeof args.body === "string" ? args.body : "",
      url: typeof args.url === "string" ? args.url : "",
      priority: typeof args.priority === "string" ? args.priority : "medium",
      id: typeof args.id === "string" ? args.id : undefined,
    });
    return toolTextResult({
      ok: true,
      topic_id: topic.id,
      status: topic.status,
      title: topic.title,
      suggested_by: topic.suggested_by,
      path: `operations/research/topics/${topic.id}.md`,
    });
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * Fetch a public http(s) URL as truncated text (SSRF-hardened).
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcWebFetch(args = {}) {
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_web_fetch");
    const url = String(args.url ?? "").trim();
    if (!url) throw new Error("url is required");
    const result = await webFetch({ url });
    return toolTextResult(result);
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * Web search (DuckDuckGo HTML by default).
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcWebSearch(args = {}) {
  try {
    const role = applyMcpAuth(args);
    assertToolAllowedForRole("hdc_web_search", role);
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query is required");
    const { deps } = createHdcMcpContext();
    const result = await webSearch({
      query,
      limit: args.limit != null ? Number(args.limit) : undefined,
      apiKey: deps.env.HDC_WEB_SEARCH_API_KEY,
    });
    return toolTextResult(result);
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * Static clump package consistency validation.
 * @param {Record<string, unknown>} [args]
 */
export async function handleHdcValidateClump(args = {}) {
  try {
    applyMcpAuth(args);
    assertToolAllowedForRole("hdc_validate_clump");
    const { deps, root } = createHdcMcpContext();
    const tier = String(args.tier ?? "").trim();
    const clump = String(args.clump ?? args.id ?? "").trim();
    if (!tier) throw new Error("tier is required");
    if (!clump) throw new Error("clump is required");
    const clumpsRoot =
      (args.clumps_root != null ? String(args.clumps_root) : "") ||
      primaryClumpsRoot(root, deps.env);
    const result = validateClump({
      clumpsRoot,
      hdcRoot: root,
      tier,
      clump,
    });
    return toolTextResult(result);
  } catch (e) {
    return toolErrorResult(e instanceof Error ? e : String(e));
  }
}

/**
 * Build argv for maintain daily from a plain options object.
 * @param {Record<string, unknown>} [opts]
 * @returns {string[]}
 */
export function buildMaintainDailyArgv(opts = {}) {
  /** @type {string[]} */
  const argv = [];
  if (opts.dry_run === true || opts.dryRun === true) argv.push("--dry-run");
  if (opts.skip_clients === true || opts.skipClients === true) argv.push("--skip-clients");
  if (opts.skip_upgrades === true || opts.skipUpgrades === true) argv.push("--skip-upgrades");
  if (opts.no_report === true || opts.noReport === true) argv.push("--no-report");
  if (Array.isArray(opts.only)) {
    for (const ref of opts.only) argv.push("--only", String(ref));
  }
  if (Array.isArray(opts.skip)) {
    for (const ref of opts.skip) argv.push("--skip", String(ref));
  }
  return argv;
}
