---
name: hdc-agent-team
description: >-
  Shared conventions for the HDC agent fleet: task files, digests, escalation,
  and hdc-private operations paths. Use when any fleet agent runs.
---

# HDC agent team conventions

## Repository ownership

| Repository | Primary agent | Owns |
| --- | --- | --- |
| **hdc** | `hdc-engineer` | CLI, schemas, shared runtime, agent fleet, tests |
| **hdc-clumps** | `hdc-sre-engineer` | Package scripts, manifests, `config.example.json` (git commit/push) |
| **hdc-private** | `hdc-sre-ops` | Live `config.json`, inventory, `operations/` |
| **Clump cache (MCP host)** | `hdc-manager` | `hdc_clumps_sync` (`init` / `sync`; optional `ref` rollback) |

Handoffs: package script failure → `hdc-sre-engineer` (commit/push git) → `hdc-qa` (validate) → `hdc-manager` (sync cache) → `hdc-sre-ops` (approved live run); CLI/runtime failure → `hdc-engineer`.

## Paths (hdc-private)

| Path | Purpose |
| --- | --- |
| `operations/tasks/<id>.md` | Canonical work queue (one task per file; YAML frontmatter) |
| `operations/task-report.md` | Manager-maintained status summary (auto-regenerated) |
| `operations/delegation-policy.md` | Approval rules |
| `operations/ip-allocations.md` | IP group boundaries and next-free addresses |
| `operations/reports/` | Monitor, security, research, QA digests |
| `operations/research/index.md` | Research topic index (status, outcome, report links) |
| `operations/research/suggestions.md` | Research suggestion inbox (manager triage) |
| `operations/research/topics/<id>.md` | Per-topic frontmatter + notes |
| `operations/proposals/security/` | Security architect output |
| `operations/proposals/network/` | Network architect output |

**Guest-authoritative:** Task files live on the hdc-agents guest (or shared hdc-private mount). Use hdc-web-server (`:9120`) or A2A for approvals.

Resolve hdc-private via sibling `../hdc-private` or `HDC_PRIVATE_ROOT`.

## Task file schema

Each task is `operations/tasks/<id>.md` with YAML frontmatter: `id`, `role`, `priority`, `status`, `title`, `created_at`, `updated_at`, `needs_decision`, `evidence`, `suggested_commands`.

Optional augmentor subtask fields: `parent_task_id`, `delegated_to`, `delegation_status` (`pending` | `in_progress` | `completed` | `failed`), `augmentor_run_id`. Subtask ids: `<parent-id>--aug-<slug>-<hash>`.

**Status:** `pending` | `approved` | `in_progress` | `blocked` | `done`

**Priority:** `critical` | `high` | `medium` | `low`

**Role:** `hdc-manager` | `hdc-sre-ops` | `hdc-sre-engineer` | `hdc-monitor` | `hdc-security-expert` | `hdc-security-architect` | `hdc-network-architect` | `hdc-research` | `hdc-engineer` | `hdc-qa`

## Agent roster (canonical)

| Agent | File |
| --- | --- |
| Manager | `apps/hdc-agent-server/agents/hdc-manager.md` |
| Monitor | `apps/hdc-agent-server/agents/hdc-monitor.md` |
| SRE ops | `apps/hdc-agent-server/agents/hdc-sre-ops.md` |
| SRE engineer | `apps/hdc-agent-server/agents/hdc-sre-engineer.md` |
| Platform engineer | `apps/hdc-agent-server/agents/hdc-engineer.md` |
| QA | `apps/hdc-agent-server/agents/hdc-qa.md` |
| Security expert | `apps/hdc-agent-server/agents/hdc-security-expert.md` |
| Security architect | `apps/hdc-agent-server/agents/hdc-security-architect.md` |
| Network architect | `apps/hdc-agent-server/agents/hdc-network-architect.md` |
| Research | `apps/hdc-agent-server/agents/hdc-research.md` |

## Rules

- **Never invent** hostnames, IPs, VLANs, or credentials — use `operations/ip-allocations.md`, inventory, and clump configs.
- **Secrets:** env var names only; values in vault.
- **Destructive work** requires task status `approved` per `delegation-policy.md`.
- **No root scratch:** never write `tmp-*` at the hdc / hdc-private repo root.
- **Hub-and-spoke:** specialists do not assign work to each other — **except** engineers may call `hdc_request_research` to queue a topic for hdc-research (manager still owns all other delegation).

## Digest filename pattern

- Monitor: `operations/reports/monitor-<ISO8601-basic>.md`
- Security: `operations/reports/security-<ISO8601-basic>.md`
- Research weekly: `operations/reports/research-<YYYY-MM-DD>.md`
- Research topic: `operations/reports/research-topic-<id>-<YYYY-MM-DD>.md`
- QA: `operations/reports/qa-<YYYY-MM-DD>.md` or `qa-<clump>-<YYYY-MM-DD>.md`
- Manager: `operations/reports/manager-triage-<YYYY-MM-DD>.md`

## Runtime

Primary: **hdc-agent-server** containers (LiteLLM tool loop + hdc-mcp-server). Scripted dispatcher scans for work; the model runs only when there is actionable work or novel digests.

Primary runtime: hdc-agent-server containers on hdc-agents-a; Tasks UI via hdc-web-server.

## Augmentor delegation

Fleet roles **hdc-engineer**, **hdc-sre-engineer**, **hdc-qa**, **hdc-research**, **hdc-security-expert**, **hdc-security-architect**, and **hdc-network-architect** may delegate code/analysis **subtasks** to external augmentors (Cursor Cloud on fleet, Cursor CLI / Claude Code on operator workstation) when registered in LiteLLM `a2a_agents[]`:

- `hdc_list_augmentors` — discover augmentors for `repo: hdc` or `hdc-clumps`
- `hdc_delegate_augment` — create subtask + A2A `message/send` via LiteLLM gateway

Parent agent keeps task ownership; augmentors edit only their declared repo (never hdc-private live state). See `docs/manually-deployed/hdc-augment-bridge.md`.

## Engineer research and web tools

When scaffolding unknown capabilities or filling platform gaps:

- `hdc_request_research` — queue `operations/research/topics/<id>.md` (`status: queued`) for hdc-research
- `hdc_web_search` / `hdc_web_fetch` — public web (SSRF-hardened); also available to hdc-research and hdc-qa
- `hdc_validate_clump` — static package checks (hdc-qa + engineers)

## Deprecated

`operations/task-queue.json` is deprecated — use per-task files under `operations/tasks/` instead.

Legacy role id **`hdc-sre`** → **`hdc-sre-ops`**.
