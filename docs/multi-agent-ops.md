# Multi-Agent Operations — Architecture Proposal

**Status:** Adopted (2026-07-14). Formalizes and extends the agent team under `.cursor/agents/`
so a coordinated set of agents can **build, secure, monitor, deploy, and maintain** every system
in the home data center, with the operator approving anything risky. Implementation tracks
Phases 2–5 in this document (`hdc-engineer`, per-role hdc-mcp, LiteLLM A2A, `hdc-agents` fleet,
close-the-loop skills). **LXC deploy** of `hdc-agents-a` awaits operator approval of
`hdc-private/clumps/services/hdc-agents/plan.md`.

Key architectural decisions in this revision:

- **LiteLLM is the A2A registry and gateway.** Agents publish their A2A cards to the
  existing `litellm` deployment and discover each other through it. The standalone
  `a2a-registry` clump is deprecated.
- **Each agent runs as its own Docker container on PVE**, deployed and maintained by
  a new `hdc-agents` clump following the standard LXC + Docker Compose pattern.

## Problems to solve

1. **Maintain** deployed systems over time (updates, drift, certificate expiry, guest
   baseline) without the operator driving every run.
2. **Monitor** ~96 packages plus network gear and surface only actionable findings.
3. **Secure** the lab continuously: detect (Wazuh/CrowdSec/WAF), respond within
   pre-approved bounds, and propose hardening.
4. **Deploy** new services repeatably (plan → approve → deploy → wire DNS/proxy →
   monitor) instead of ad-hoc sessions.
5. **Build** and repair the automation itself — hdc CLI, clump scripts, schemas,
   tests — as the estate evolves.
6. Run agents as **always-on, individually restartable services** with central
   auth, routing, and spend tracking — not just IDE sessions and cron scripts.

## Design principles

- **Single source of truth.** Rules, skills, and agent definitions live in `.cursor/`.
  `CLAUDE.md` imports the rules; `.claude/skills/` and `.claude/agents/` are thin
  pointers. Containerized agents load the *same* canonical `.cursor/agents/{name}.md`
  at startup — one edit updates every runtime.
- **Hub-and-spoke orchestration.** The Manager is the only agent that assigns work and
  talks to the operator; specialists never trigger each other directly. A2A calls
  between agents go through LiteLLM, so every delegation is authenticated and logged.
- **Files as durable state, A2A as transport.** Tasks (`operations/tasks/*.md`),
  digests (`operations/reports/`), and proposals (`operations/proposals/`) in
  hdc-private remain the auditable system of record. A2A messages trigger work and
  return results; they never replace the task files.
- **Approval gates, not trust.** Destructive verbs (deploy, teardown, `--prune`,
  `inventory apply`) require task `status: approved` per
  `hdc-private/operations/delegation-policy.md`. Read-only roles are read-only by
  definition, not by mood.
- **No invented facts.** IPs from `operations/ip-allocations.md`, topology from
  inventory sidecars, capability from clump configs. Secrets are env-var **names**
  only; values stay in the encrypted vault.
- **Everything through the hdc CLI.** Agents act via `node apps/hdc-cli/cli.mjs …`
  (tracked, logged, reported) — inside containers via the allowlisted `hdc-mcp`
  surface — never ad-hoc SSH or one-off scripts.

## Architecture overview

*(Diagram lives outside this file so Markdown preview stays usable:
[multi-agent-ops-architecture.mmd](./multi-agent-ops-architecture.mmd) —
paste into [Mermaid Live](https://mermaid.live) or Kroki.)*

Hub-and-spoke summary:

- **Operator** (Discord / email / web UI / IDE) talks only to **hdc-manager**.
- **hdc-agents-a** runs one container per roster agent; all call **LiteLLM** for
  models and A2A publish/discover/route.
- Durable state lives in **hdc-private** `operations/` (tasks, reports, policy).
- **hdc-sre** / **hdc-engineer** reach the lab through **hdc-mcp** → hdc CLI.

## Agent roster

### Existing agents (formalized)

| Agent | Lifecycle role | Access | Trigger |
| --- | --- | --- | --- |
| `hdc-manager` | Orchestrate | Task files, Discord, A2A delegation | Hourly triage loop + A2A + on demand |
| `hdc-monitor` | **Monitor** | Query-only + digests/tasks | 4 h sweep + A2A |
| `hdc-sre` | **Deploy / Maintain** | Full hdc CLI on `approved` tasks | Per approved task (A2A from manager) |
| `hdc-security-expert` | **Secure** (detect/respond) | Query + pre-approved bouncer sync | 6 h sweep + incidents |
| `hdc-security-architect` | **Secure** (plan) | Read-only + `proposals/security/` | Weekly / after incidents |
| `hdc-network-architect` | **Build** (network design) | Read-only + `proposals/network/` | On demand (A2A) |
| `hdc-research` | **Build** (discovery) | Read-only + web | Weekly brief |
| `hdc-ops` | Legacy alias | — | Deprecated; defers to sre/manager |

### Proposed addition: `hdc-engineer`

The stub roles "HDC Software Engineer" and "HDC Deployment Engineer" map onto the
roster as follows:

- **Deployment Engineer → stays `hdc-sre`.** Greenfield deploys are already covered
  by `hdc-sre` + the `hdc-service-deploy` skill (discovery → `plan.md` → approval →
  deploy → dependency wiring). A separate deployer would split ownership of the same
  CLI surface for no gain.
- **Software Engineer → new `hdc-engineer`.** Today nobody owns the *automation
  codebase* itself. `hdc-sre` runs packages; `hdc-engineer` builds and repairs them:
  - Fix clump scripts that failed in `daily-maintain` or deploy reports (prefer extending
    `clumps/` — never dump root `tmp-*` scratchpads; ephemeral helpers only under
    `tools/scripts/tmp-*` per `.cursor/rules/hdc-automation.mdc`).
  - Extend the hdc CLI, schemas, and shared libs with tests
    (`.cursor/rules/hdc-testing.mdc`, coverage thresholds).
  - Implement planned-but-missing features (`docs lint`, `inventory apply`).
  - Scaffold new packages requested by research/manager (manifest, `config.example.json`,
    `.env.example`, schema, README) ready for `hdc-sre` to deploy.
  - Constraint: writes code and tests in the repo; **never** touches production —
    handing a tested package to `hdc-sre` is the boundary.

  Definition to add at `.cursor/agents/hdc-engineer.md` (+ `.claude/agents/` pointer),
  task role `hdc-engineer` in the task schema, and its own container in `hdc-agents`.

### Lifecycle coverage matrix

| Lifecycle | Sense | Decide | Act |
| --- | --- | --- | --- |
| **Build** | hdc-research (candidates), failure reports | Manager + operator | **hdc-engineer** (code), hdc-network-architect (design) |
| **Secure** | hdc-security-expert (Wazuh/CrowdSec/WAF) | hdc-security-architect proposals → Manager | hdc-security-expert (bounded response), hdc-sre (hardening deploys) |
| **Monitor** | hdc-monitor (uptime-kuma, proxmox, gatus) | Manager triage | hdc-sre (fix tasks) |
| **Deploy** | proxmox-resource-planning skill (capacity) | plan.md + operator approval | hdc-sre via hdc-service-deploy |
| **Maintain** | daily-maintain reports, query drift | delegation policy (autonomous vs approved) | `maintain daily` recipe + hdc-sre |

## Agent runtime: one Docker container per agent on PVE

Each roster agent runs as its **own Docker container** so it can be resourced,
restarted, upgraded, and revoked independently. Deployment follows the standard hdc
pattern — a new **`clumps/services/hdc-agents`** package:

- **Host:** `hdc-agents-a` LXC on Proxmox (Docker, `nesting=1`), sized per
  `proxmox-resource-planning` (start ~4 vCPU / 8 GiB; agents are I/O-bound on LLM
  calls, not CPU). Additional instances (`-b`) can pin containers to another
  hypervisor later without design changes.
- **Compose:** one service per agent (`hdc-manager`, `hdc-monitor`, `hdc-sre`,
  `hdc-security-expert`, `hdc-security-architect`, `hdc-network-architect`,
  `hdc-research`, `hdc-engineer`). Standard verbs: `deploy` (LXC + compose up),
  `maintain` (re-render, pull, `up -d`, guest baseline), `query --live` (container
  + agent-card health), `teardown`.
- **Image:** a single shared **`hdc/agent-runtime`** image (built on the guest like
  `a2a-registry` does today — no registry required). Contents:
  - Node.js 20 + the hdc repo (baked at build; `maintain` refreshes) and a read-only
    bind-mount of hdc-private for inventory/config; `operations/` mounted read-write
    only for roles that write digests/tasks.
  - A thin A2A server (new `apps/hdc-agent-server/`) that serves the agent card at
    `/.well-known/agent-card.json` and the A2A JSON-RPC endpoint, queues one task at
    a time, and executes each task by invoking the agent runtime headlessly
    (Claude Code `claude -p` with the matching `.claude/agents/{role}.md` subagent,
    or an ADK `LlmAgent` — both route model calls through LiteLLM `/v1`).
  - `hdc-mcp` (stdio, in-container) as the **only** tool surface. Per-role policy:
    read-only roles get `query` verbs; `hdc-sre` additionally gets `maintain`/`deploy`
    gated on task `status: approved` (the existing hdc-mcp policy layer extends from
    global allowlist to per-role allowlist via `HDC_AGENT_ROLE`).
- **Per-container env (names only; values from vault at render time):**
  `HDC_AGENT_ROLE`, `HDC_AGENT_CARD_URL`, `HDC_LITELLM_BASE_URL`,
  `HDC_AGENT_LITELLM_KEY_{ROLE}` (one virtual key per agent), `HDC_PRIVATE_ROOT`.
- **Identity and audit:** because every model call and every inter-agent A2A call
  carries the agent's own LiteLLM virtual key, LiteLLM's spend/logging answers "which
  agent did what, when, at what cost" — and revoking one key disables one agent.

The scheduled Cursor CLI automations on hdc-runner become the **fallback plane**: the
container fleet is primary, and `.cursor/automations/` definitions are retained so the
same roles can still run via `agent -p` if the fleet is down.

## A2A publishing and discovery via LiteLLM

The deployed **`litellm`** clump becomes the agent control plane, replacing the
standalone `a2a-registry` service (in-memory, no auth, loses registrations on
restart). LiteLLM already provides the missing pieces: persistent config + Postgres,
virtual-key auth, logging/spend, and an A2A gateway that fronts registered agents.

**Publish.** Extend the litellm clump config (`litellm.a2a_agents[]` in
`config.json`, rendered into LiteLLM's config by `litellm-config-render.mjs`) so each
agent container is registered declaratively:

```jsonc
// clumps/services/litellm/config.json (hdc-private) — sketch
"a2a_agents": [
  {
    "name": "hdc-monitor",
    "url": "http://hdc-agents-a.hdc.example:9201",   // container's A2A endpoint
    "description": "HDC monitoring: health queries, digests, SRE task creation"
  }
  // … one entry per agent, ports 9200 (manager) … 9207 (engineer)
]
```

`hdc-agents deploy/maintain` writes/updates these entries and runs
`litellm maintain` to re-render — registration survives restarts because it lives in
config (hdc-private) rather than in a runtime API call. Exact LiteLLM config keys are
pinned during implementation against the deployed `image_tag` (A2A gateway support is
present in current `main-stable`; verify the section name and card-passthrough
behavior at build time).

**Discover.** Agents never hold a static peer list. To delegate, the manager:

1. Lists registered agents from LiteLLM (agents API / agent cards) using its virtual
   key.
2. Filters by card capabilities (each card advertises its role and skills — e.g.
   `monitor.sweep`, `sre.execute-task`, `security.respond`).
3. Sends the A2A task to `https://litellm.example/a2a/{agent-name}` — LiteLLM authenticates,
   logs, and proxies to the target container.

The same flow works for external callers (operator tooling, other labs' agents):
one gateway URL, one auth model, full audit. The hdc-runner web UI keeps its Tasks
tab; its A2A endpoint remains for task approval but no longer serves as a registry.

**Deprecation.** `clumps/services/a2a-registry` is retired after migration
(teardown; keep the clump archived like nagios, or delete once the fleet is stable).

## Coordination protocol

Unchanged from `.cursor/skills/hdc-agent-team/SKILL.md`, restated as the contract all
runtimes must honor:

- **Task files** `operations/tasks/{id}.md` with YAML frontmatter: `id`, `role`,
  `priority` (critical/high/medium/low), `status`
  (`pending → approved → in_progress → blocked/done`), `needs_decision`, `evidence`,
  `suggested_commands`. Add `hdc-engineer` to the allowed roles.
- **A2A triggers, files decide.** An A2A message may *ask* an agent to act, but the
  agent still validates against the task file and delegation policy before any
  non-read action. Task state stays guest-authoritative in hdc-private.
- **Digests** to `operations/reports/{role}-{timestamp}.md`; **proposals** to
  `operations/proposals/{security,network}/`.
- **Escalation**: `needs_decision: true` → Manager notifies Discord
  (`notify-discord.mjs`); failures email via postfix-relay; approvals via web UI
  Tasks tab, `PATCH /api/tasks/:id`, or A2A.
- **Safety rails** (all agents, all runtimes):
  - Destructive verbs only with task `status: approved`.
  - Per-role hdc-mcp allowlists inside containers; read-only roles cannot invoke
    maintain/deploy at the tool layer, not just by prompt.
  - Selective-filter maintains never implicitly prune (`--prune` is explicit).
  - Secrets: vault only; env-var names in files; per-agent LiteLLM virtual keys;
    `.claude/settings.json` denies `secrets` CLI verbs and `.env`/vault reads.
  - stdout clean for JSON; progress on stderr; operation reports for every
    deploy/maintain/teardown.

## Gaps and proposed changes

| # | Gap | Proposal | Size |
| --- | --- | --- | --- |
| 1 | No owner for automation-code repair | Add `hdc-engineer` agent + task role + container | M |
| 2 | Claude Code couldn't see rules/skills/agents | **Done**: `CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, `.claude/settings.json` | — |
| 3 | Agents only run in IDE sessions / cron scripts | `hdc-agents` clump: per-agent Docker containers on PVE with `apps/hdc-agent-server` A2A wrapper | L |
| 4 | a2a-registry is in-memory, unauthenticated, and separate from model routing | Publish agents to **LiteLLM** as A2A registry/gateway; discover via agent cards; deprecate `a2a-registry` | M |
| 5 | No per-agent identity, audit, or kill switch | One LiteLLM virtual key per agent (model + A2A calls); revoke key = disable agent | S |
| 6 | hdc-mcp policy is global, not per-role | Extend policy layer with `HDC_AGENT_ROLE` allowlists | S–M |
| 7 | `docs lint` / `inventory apply` referenced but not implemented | `hdc-engineer` backlog item; until then schema-validate manually | M |
| 8 | No feedback loop from daily-maintain failures to fixes | Manager triage: failed daily-maintain steps → `role: hdc-engineer` tasks with report paths as evidence | S |
| 9 | Backup/restore verification has no explicit owner | Add to hdc-monitor runbook: PBS/Synology backup queries + restore-test task generation (monthly) | M |

## Rollout plan

**Phase 1 — dual-runtime foundation (done in this change).** `.claude/` pointer
layer, `CLAUDE.md` imports, project settings with secret-deny rules, docs updated.
Verify a Claude Code session picks up rules and can invoke `hdc-ops` /
`hdc-service-deploy`.

**Phase 2 — engineer role + per-role tooling.** Author
`.cursor/agents/hdc-engineer.md` + pointer; add the role to the task schema and
delegation policy; extend hdc-mcp with `HDC_AGENT_ROLE` allowlists (gap 6).

**Phase 3 — LiteLLM as A2A registry.** Add `a2a_agents[]` to the litellm config
schema and renderer; register the existing hdc-runner A2A endpoint as the first
entry; validate card discovery and proxied A2A calls through LiteLLM with a virtual
key; deprecate `a2a-registry`.

**Phase 4 — containerize the fleet.** Build `apps/hdc-agent-server` and the
`hdc/agent-runtime` image; create the `hdc-agents` clump (LXC + one container per
agent); start with the read-only roles (monitor, research, architects), then
security-expert, then sre/manager once per-role allowlists and approval checks are
proven. Each container publishes to LiteLLM on deploy.

**Phase 5 — close the loop.** Manager delegates via LiteLLM discovery instead of
static roster; enable monitor + security sweeps as container-native schedules;
backup-verification runbook; implement `docs lint`; review delegation policy to widen
the autonomous-maintain envelope as trust builds. Cursor CLI automations on
hdc-runner remain as fallback.

## Non-goals

- Replacing deterministic automation (`maintain daily`, `run-daily.mjs`) with LLM
  runs — deterministic stays deterministic; agents handle triage, judgment, and code.
- Letting any agent bypass the task/approval protocol, regardless of runtime or
  transport (IDE, cron, or A2A).
- Duplicating rule/skill/agent content per runtime — `.cursor/` definitions are
  mounted/baked into containers, pointed to from `.claude/`, and never forked.
- Exposing the A2A gateway to the public internet in v1 — LAN + VPN only; nginx-waf
  fronting is a later, explicit decision.
