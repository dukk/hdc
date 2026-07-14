---
name: hdc-agent-team
description: >-
  Shared conventions for the HDC agent fleet: task files, digests, escalation,
  and hdc-private operations paths. Use when any fleet agent runs.
---

# HDC agent team conventions

## Paths (hdc-private)

| Path | Purpose |
| --- | --- |
| `operations/tasks/<id>.md` | Canonical work queue (one task per file; YAML frontmatter) |
| `operations/task-report.md` | Manager-maintained status summary (auto-regenerated) |
| `operations/delegation-policy.md` | Approval rules |
| `operations/ip-allocations.md` | IP group boundaries and next-free addresses |
| `operations/reports/` | Monitor, security, research digests |
| `operations/proposals/security/` | Security architect output |
| `operations/proposals/network/` | Network architect output |

**Guest-authoritative:** Task files live on the hdc-agents guest (or shared hdc-private mount). Use hdc-web-server (`:9120`) or A2A for approvals.

Resolve hdc-private via sibling `../hdc-private` or `HDC_PRIVATE_ROOT`.

## Task file schema

Each task is `operations/tasks/<id>.md` with YAML frontmatter: `id`, `role`, `priority`, `status`, `title`, `created_at`, `updated_at`, `needs_decision`, `evidence`, `suggested_commands`.

**Status:** `pending` | `approved` | `in_progress` | `blocked` | `done`

**Priority:** `critical` | `high` | `medium` | `low`

**Role:** `hdc-manager` | `hdc-sre` | `hdc-monitor` | `hdc-security-expert` | `hdc-security-architect` | `hdc-network-architect` | `hdc-research` | `hdc-engineer`

## Agent roster (canonical)

| Agent | File |
| --- | --- |
| Manager | `apps/hdc-agent-server/agents/hdc-manager.md` |
| Monitor | `apps/hdc-agent-server/agents/hdc-monitor.md` |
| SRE | `apps/hdc-agent-server/agents/hdc-sre.md` |
| Security expert | `apps/hdc-agent-server/agents/hdc-security-expert.md` |
| Security architect | `apps/hdc-agent-server/agents/hdc-security-architect.md` |
| Network architect | `apps/hdc-agent-server/agents/hdc-network-architect.md` |
| Research | `apps/hdc-agent-server/agents/hdc-research.md` |
| Engineer | `apps/hdc-agent-server/agents/hdc-engineer.md` |

## Rules

- **Never invent** hostnames, IPs, VLANs, or credentials — use `operations/ip-allocations.md`, inventory, and clump configs.
- **Secrets:** env var names only; values in vault.
- **Destructive work** requires task status `approved` per `delegation-policy.md`.
- **No root scratch:** never write `tmp-*` at the hdc / hdc-private repo root.

## Digest filename pattern

- Monitor: `operations/reports/monitor-<ISO8601-basic>.md`
- Security: `operations/reports/security-<ISO8601-basic>.md`
- Research: `operations/reports/research-<YYYY-MM-DD>.md`
- Manager: `operations/reports/manager-triage-<YYYY-MM-DD>.md`

## Runtime

Primary: **hdc-agent-server** containers (LiteLLM tool loop + hdc-mcp-server). Scripted dispatcher scans for work; the model runs only when there is actionable work or novel digests.

Primary runtime: hdc-agent-server containers on hdc-agents-a; Tasks UI via hdc-web-server.

## Deprecated

`operations/task-queue.json` is deprecated — use per-task files under `operations/tasks/` instead.
