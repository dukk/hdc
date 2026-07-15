# Multi-Agent Operations — Architecture Proposal

**Status:** Adopted (2026-07-14; revised 2026-07-14 for server-owned harness).
Coordinates agents that **build, secure, monitor, deploy, and maintain** the lab with
operator approval for risky work. **Canonical defs** live under
[`apps/hdc-agent-server/`](../apps/hdc-agent-server/) (`agents/`, `skills/`, `rules/`,
`automations/`). Runtime is the LiteLLM OpenAI tool-loop in `hdc-agent-server`
(not Cursor). **LXC deploy** of `hdc-agents-a` awaits approval of
`hdc-private/clumps/services/hdc-agents/plan.md`.

Key architectural decisions:

- **LiteLLM is the A2A registry and gateway.** Agents publish cards to `litellm`;
  the standalone `a2a-registry` clump is deprecated.
- **Each agent runs as its own Docker container** via `clumps/services/hdc-agents`.
- **Scripted dispatcher first:** schedule ticks refresh task reports, notify manager
  events per `notifications.routes`, probe hdc queries, and A2A-delegate approved
  work — the model runs only when probes/digests change or triage is required.
- **Tasks / jobs UI:** hdc-web-server on hdc-agents-a `:9120` (no separate hdc-runner guest).

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

- **Single source of truth.** Fleet agent defs, skills, rules, and automation specs
  live under `apps/hdc-agent-server/`. IDE sessions may use thin pointers under
  `.cursor/agents/` and `.claude/agents/`. Containerized agents load
  `apps/hdc-agent-server/agents/{role}.md` (skills injected into the system prompt).
- **Hub-and-spoke orchestration.** The Manager is the only agent that assigns work and
  talks to the operator; specialists never trigger each other directly. A2A calls
  between agents go through LiteLLM (or compose DNS peer URLs from the dispatcher), so every delegation is authenticated and logged.
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
- **Everything through the hdc CLI.** Agents act via `hdc …`
  (tracked, logged, reported) — inside containers via the allowlisted `hdc-mcp`
  surface — never ad-hoc SSH or one-off scripts.
- **Spend control.** Scripted dispatcher skips the model on idle ticks; LiteLLM
  virtual keys attribute cost per role.

## Architecture overview

*(Diagram lives outside this file so Markdown preview stays usable:
[multi-agent-ops-architecture.mmd](./multi-agent-ops-architecture.mmd) —
paste into [Mermaid Live](https://mermaid.live) or Kroki.)*

Hub-and-spoke summary:

- **Operator** (Discord / email / web UI / IDE) talks only to **hdc-manager**.
  Inbound operator and Wazuh mail lands at `manager@hdc.dukk.org` (aliases for
  specialist roles forward there). Manager IMAP poll creates/updates tasks;
  trusted `dukk@dukk.org` may approve/reject by email when SPF/DKIM/DMARC pass.
  Fleet alerts send From the role alias or manager — not `noreply@`.
- **hdc-agents-a** runs one container per roster agent; all call **LiteLLM** for
  models and A2A publish/discover/route.
- Durable state lives in **hdc-private** `operations/` (tasks, reports, policy).
- **hdc-sre-ops** / **hdc-sre-engineer** / **hdc-engineer** reach diagnostics through **hdc-mcp** → hdc CLI (deploy/maintain only for **hdc-sre-ops** on approved tasks).

## Repository ownership

Three repositories map to three build/ops agents (see each repo README):

| Repository | Primary agent | Owns |
| --- | --- | --- |
| **hdc** | `hdc-engineer` | CLI, schemas, `hdc/package/*`, agent fleet, tests |
| **hdc-clumps** | `hdc-sre-engineer` | Package scripts, manifests, examples |
| **hdc-private** | `hdc-sre-ops` | Live config, inventory, `operations/` |

Handoffs: clump script failure → `hdc-sre-engineer`; CLI failure → `hdc-engineer`; approved production run → `hdc-sre-ops`.

## Agent roster

### Fleet agents

| Agent | Lifecycle role | Access | Trigger |
| --- | --- | --- | --- |
| `hdc-manager` | Orchestrate | Task files, per-route notifications, A2A delegation | Hourly triage loop + A2A + on demand |
| `hdc-monitor` | **Monitor** | Query-only + digests/tasks | 4 h sweep + A2A |
| `hdc-sre-ops` | **Deploy / Maintain** (live ops) | Full hdc CLI on `approved` tasks; hdc-private writes | Per approved task (A2A from manager) |
| `hdc-sre-engineer` | **Build** (packages) | hdc-clumps scripts; read-only `query` | Failure reports, package scaffolds |
| `hdc-engineer` | **Build** (platform) | hdc CLI/schemas/agent-server; read-only `query` | Failure reports, platform features |
| `hdc-security-expert` | **Secure** (detect/respond) | Query + pre-approved bouncer sync | 6 h sweep + incidents |
| `hdc-security-architect` | **Secure** (plan) | Read-only + `proposals/security/` | Weekly / after incidents |
| `hdc-network-architect` | **Build** (network design) | Read-only + `proposals/network/` | On demand (A2A) |
| `hdc-research` | **Build** (discovery) | Read-only + web | Queued topics + weekly brief; suggestions via web/email/inbox |
| `hdc-ops` | Legacy alias | — | Deprecated; defers to sre-ops/manager |

Legacy role id **`hdc-sre`** → **`hdc-sre-ops`** (port 9202 unchanged).

### Build roles (revised 2026-07-14)

- **`hdc-engineer`** owns the **hdc** platform (CLI, schemas, agent-server, tests). Never runs production deploy/maintain.
- **`hdc-sre-engineer`** owns **hdc-clumps** package automation. Never edits hdc-private or runs live deploy/maintain.
- **`hdc-sre-ops`** owns **hdc-private** live state and executes approved deploy/maintain via hdc-service-deploy.

Definitions: `apps/hdc-agent-server/agents/{hdc-engineer,hdc-sre-engineer,hdc-sre-ops}.md` (+ IDE pointers). Containers: ports 9207 (engineer), 9208 (sre-engineer), 9202 (sre-ops).

### Lifecycle coverage matrix

| Lifecycle | Sense | Decide | Act |
| --- | --- | --- | --- |
| **Build** | hdc-research (candidates), failure reports | Manager + operator | **hdc-engineer** (platform), **hdc-sre-engineer** (packages), hdc-network-architect (design) |
| **Secure** | hdc-security-expert (Wazuh/CrowdSec/WAF) | hdc-security-architect proposals → Manager | hdc-security-expert (bounded response), hdc-sre-ops (hardening deploys) |
| **Monitor** | hdc-monitor (uptime-kuma, proxmox, gatus) | Manager triage | hdc-sre-ops (fix tasks), hdc-sre-engineer (script fixes) |
| **Deploy** | proxmox-resource-planning skill (capacity) | plan.md + operator approval | hdc-sre-ops via hdc-service-deploy |
| **Maintain** | daily-maintain reports, query drift | delegation policy (autonomous vs approved) | `maintain daily` recipe + hdc-sre-ops |

## Agent runtime: one Docker container per agent on PVE

Each roster agent runs as its **own Docker container** so it can be resourced,
restarted, upgraded, and revoked independently. Deployment follows the standard hdc
pattern — a new **`clumps/services/hdc-agents`** package:

- **Host:** `hdc-agents-a` LXC on Proxmox (Docker, `nesting=1`), sized per
  `proxmox-resource-planning` (start ~4 vCPU / 8 GiB; agents are I/O-bound on LLM
  calls, not CPU). Additional instances (`-b`) can pin containers to another
  hypervisor later without design changes.
- **Compose:** one service per agent (`hdc-manager`, `hdc-monitor`, `hdc-sre-ops`,
  `hdc-sre-engineer`, `hdc-security-expert`, `hdc-security-architect`, `hdc-network-architect`,
  `hdc-research`, `hdc-engineer`). Standard verbs: `deploy` (LXC + compose up),
  `maintain` (re-render, pull, `up -d`, guest baseline), `query --live` (container
  + agent-card health), `teardown`.
- **Image:** a single shared **`hdc/agent-runtime`** image (built on the guest like
  `a2a-registry` does today — no registry required). Contents:
  - Node.js 20 + the hdc repo (baked at build; `maintain` refreshes) and a read-only
    bind-mount of hdc-private for inventory/config; `operations/` mounted read-write
    only for roles that write digests/tasks.
  - A thin A2A server (`apps/hdc-agent-server/`) that serves the agent card,
    queues one task at a time, runs a **scripted dispatcher** on a timer, and
    executes LLM turns via LiteLLM `/v1/chat/completions` + hdc-mcp tool handlers
    (skills from `apps/hdc-agent-server/skills/` injected into the system prompt).
  - `hdc-mcp` policy via `HDC_AGENT_ROLE` (deploy gated on approved tasks).
- **Per-container env (names only; values from vault at render time):**
  `HDC_AGENT_ROLE`, `HDC_AGENT_CARD_URL`, `HDC_LITELLM_BASE_URL`,
  `HDC_AGENT_LITELLM_KEY_{ROLE}` (one virtual key per agent), `HDC_PRIVATE_ROOT`.
- **Identity and audit:** every model call and inter-agent A2A call carries the
  agent's LiteLLM virtual key.

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
  // … one entry per agent, ports 9200 (manager) … 9208 (sre-engineer)
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
one gateway URL, one auth model, full audit. **hdc-web-server** on hdc-agents-a
`:9120` provides the Tasks tab and job API; A2A registry/discovery is LiteLLM only.

**Deprecation.** `clumps/services/a2a-registry` is retired after migration
(teardown; keep the clump archived like nagios, or delete once the fleet is stable).

## Coordination protocol

Unchanged from `apps/hdc-agent-server/skills/hdc-agent-team/SKILL.md`, restated as the contract all
runtimes must honor:

- **Task files** `operations/tasks/{id}.md` with YAML frontmatter: `id`, `role`,
  `priority` (critical/high/medium/low), `status`
  (`pending → approved → in_progress → blocked/done`), `needs_decision`, `evidence`,
  `suggested_commands`. Allowed roles include `hdc-engineer`, `hdc-sre-engineer`, and `hdc-sre-ops`.
- **A2A triggers, files decide.** An A2A message may *ask* an agent to act, but the
  agent still validates against the task file and delegation policy before any
  non-read action. Task state stays guest-authoritative in hdc-private.
- **Digests** to `operations/reports/{role}-{timestamp}.md`; **proposals** to
  `operations/proposals/{security,network}/`.
- **Escalation**: `needs_decision: true` → Manager dispatcher notifies per
  `notifications.routes.needs_decision` (default Discord via `notify.mjs`; also
  email, Slack, Teams, Telegram — see `docs/manually-deployed/manager-notifications.md`).
  Discord may include **Approve** / **Deny** buttons when the hdc-ops app is
  configured (`application_id`, `public_key`, bot token, `channel_id`), handled by
  hdc-web-server `POST /api/discord/interactions`. Email decisions use mailbox
  reply subjects `APPROVE <task-id>` / `REJECT <task-id>`. Scheduled job failures
  email via postfix-relay; approvals also via web UI Tasks tab, `PATCH /api/tasks/:id`,
  or A2A.
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
`apps/hdc-agent-server/agents/hdc-engineer.md` + IDE pointer; add the role to the task schema and
delegation policy; extend hdc-mcp with `HDC_AGENT_ROLE` allowlists (gap 6).

**Phase 3 — LiteLLM as A2A registry.** Add `a2a_agents[]` to the litellm config
schema and renderer; register hdc-agents fleet endpoints (manager `:9200` …);
validate card discovery and proxied A2A calls through LiteLLM with a virtual
key; deprecate `a2a-registry`.

**Phase 4 — containerize the fleet.** Build `apps/hdc-agent-server` and the
`hdc/agent-runtime` image; create the `hdc-agents` clump (LXC + one container per
agent); start with the read-only roles (monitor, research, architects), then
security-expert, then sre/manager once per-role allowlists and approval checks are
proven. Each container publishes to LiteLLM on deploy.

**Phase 5 — close the loop.** Manager delegates via LiteLLM discovery instead of
static roster; enable monitor + security sweeps as container-native schedules;
backup-verification runbook; implement `docs lint`; review delegation policy to widen
the autonomous-maintain envelope as trust builds. Tasks UI remains hdc-web-server
on the hdc-agents guest.

## Non-goals

- Replacing deterministic automation (`maintain daily`, `run-daily.mjs`) with LLM
  runs — deterministic stays deterministic; agents handle triage, judgment, and code.
- Letting any agent bypass the task/approval protocol, regardless of runtime or
  transport (IDE, cron, or A2A).
- Duplicating rule/skill/agent content per runtime — `.cursor/` definitions are
  mounted/baked into containers, pointed to from `.claude/`, and never forked.
- Exposing the A2A gateway to the public internet in v1 — LAN + VPN only; nginx-waf
  fronting is a later, explicit decision.
