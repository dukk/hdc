---
name: hdc-agent-team
description: >-
  Shared conventions for the HDC Cursor subagent team: task files, digests, escalation,
  and hdc-private operations paths. Use when any hdc-manager/monitor/sre/security agent runs.
disable-model-invocation: true
---

# HDC agent team conventions

## Paths (hdc-private on hdc-runner guest)

| Path | Purpose |
| --- | --- |
| `operations/tasks/<id>.md` | Canonical work queue (one task per file; YAML frontmatter) |
| `operations/task-report.md` | Manager-maintained status summary (auto-regenerated) |
| `operations/delegation-policy.md` | Approval rules |
| `operations/ip-allocations.md` | IP group boundaries and next-free addresses (Servers network — see file) |
| `operations/reports/` | Monitor, security, research digests |
| `operations/proposals/security/` | Security architect output |
| `operations/proposals/network/` | Network architect output |

**Guest-authoritative:** Task files and `task-report.md` live on the **hdc-runner guest** at `/opt/hdc-private/operations/…`. The operator workstation does not hold live task state — use the hdc-runner web UI (`/api/tasks`) or A2A (`/a2a/tasks`) for approvals and status.

Resolve hdc-private via sibling `../hdc-private` or `HDC_PRIVATE_ROOT` in `.env` (on guest: `/opt/hdc-private`).

## Task file schema

Each task is `operations/tasks/<id>.md`:

```yaml
---
id: 2026-06-29-monitor-immich
role: hdc-sre
priority: high
status: pending
title: "Immich monitor down"
created_at: 2026-06-29T08:05:00Z
updated_at: 2026-06-29T08:05:00Z
needs_decision: false
evidence:
  - operations/reports/monitor-2026-06-29T08-00.md
suggested_commands:
  - node apps/hdc-cli/cli.mjs run service immich query -- --live
---
Task description body (markdown).
```

**Status:** `pending` | `approved` | `in_progress` | `blocked` | `done`

**Priority:** `critical` | `high` | `medium` | `low`

**Role:** `hdc-manager` | `hdc-sre` | `hdc-monitor` | `hdc-security-expert` | `hdc-security-architect` | `hdc-network-architect` | `hdc-research` | `hdc-engineer`

## Agent roster

| Agent | File |
| --- | --- |
| Manager | `.cursor/agents/hdc-manager.md` |
| Monitor | `.cursor/agents/hdc-monitor.md` |
| SRE | `.cursor/agents/hdc-sre.md` |
| Security expert | `.cursor/agents/hdc-security-expert.md` |
| Security architect | `.cursor/agents/hdc-security-architect.md` |
| Network architect | `.cursor/agents/hdc-network-architect.md` |
| Research | `.cursor/agents/hdc-research.md` |
| Engineer | `.cursor/agents/hdc-engineer.md` |

## Rules

- **Never invent** hostnames, IPs, VLANs, or credentials — use `operations/ip-allocations.md`, inventory, and clump configs.
- **Secrets:** env var names only; values in vault (`node apps/hdc-cli/cli.mjs secrets set …`).
- **CLI:** `node apps/hdc-cli/cli.mjs` from hdc repo root (Windows: `hdc.cmd`).
- **Destructive work** requires task status `approved` per `delegation-policy.md`.
- **No root scratch:** never write `tmp-*` (or similar) at the hdc / hdc-private repo root. Prefer `hdc run` / clump flags; ephemeral only in `tools/scripts/tmp-*`; see `.cursor/rules/hdc-automation.mdc`.

## Digest filename pattern

- Monitor: `operations/reports/monitor-<ISO8601-basic>.md` (e.g. `monitor-2026-06-29T08-00.md`)
- Security: `operations/reports/security-<ISO8601-basic>.md`
- Research: `operations/reports/research-<YYYY-MM-DD>.md`
- Manager: `operations/reports/manager-triage-<YYYY-MM-DD>.md`

## Delegation on hdc-runner

The manager runs hourly via Cursor CLI (`agent-manager-hourly` schedule). On the guest, the manager creates/updates task `.md` files and spawns worker `agent -p` runs for approved tasks. In the IDE, the manager may still use the Task tool for local sessions.

## Deprecated

`operations/task-queue.json` is deprecated — use per-task files under `operations/tasks/` instead.
