---
name: hdc-pull-private
description: >-
  Pulls guest-authoritative hdc-private operations content from hdc-agents
  /opt/hdc-private into the local hdc-private repo (tasks, task-report,
  dispatcher state, proposals, reports). Use when syncing agent fleet work
  from the guest, pulling hdc-private from agents, or before committing
  operations/tasks locally.
disable-model-invocation: true
---

# Pull hdc-private from hdc-agents

Operator workflow to bring **guest-authoritative** `operations/` content from hdc-agents-a into the workstation **hdc-private** repo. Pair with [hdc-ops](../hdc-ops/SKILL.md) for broader CLI ops.

## When to use

- After agent fleet work on hdc-agents-a (manager, monitor, dispatcher, web UI tasks)
- Before reviewing or committing `operations/tasks/` locally
- When local task files are stale relative to guest state

## Hard rules

1. **Guest-authoritative paths only** — never blind full-tree pull of `/opt/hdc-private/` (configs/inventory on guest may be stale vs workstation).
2. **No `--delete`** — the pull script merges guest files into local; it does not prune local-only files.
3. **Secrets:** never log vault values; task bodies may contain operator notes only.
4. **Relation to maintain:** `hdc run service hdc-agents maintain` pushes local → guest and **excludes** `operations/tasks/**`, `task-report.md`, `.dispatcher-state.json`. This skill is the inverse for operations only.

## Workflow

1. From hdc repo root, run:

```bash
node tools/scripts/pull-hdc-private-from-agents.mjs
```

2. Optional dry-run first:

```bash
node tools/scripts/pull-hdc-private-from-agents.mjs --dry-run
```

3. Review changes in hdc-private:

```bash
cd ../hdc-private && git status
```

4. Inspect `operations/tasks/` and `operations/task-report.md` before commit.

## Pulled paths

| Guest (`/opt/hdc-private/`) | Local (`hdc-private/`) |
|-------------------------------|--------------------------|
| `operations/tasks/` | `operations/tasks/` |
| `operations/task-report.md` | `operations/task-report.md` |
| `operations/.dispatcher-state.json` | `operations/.dispatcher-state.json` |
| `operations/proposals/` | `operations/proposals/` |
| `operations/reports/` | `operations/reports/` |

Missing remote paths are skipped with a warning (normal on first deploy).

## Flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Show transfers without writing |
| `--host <ip>` | Override guest IP |
| `--system-id hdc-agents-a` | Target system |
| `--instance a` | Deployment instance letter |

Guest IP resolution order: `--host` → live CT IP via Proxmox pct → inventory `access.nodes[0].ip`.

## Troubleshooting

| Issue | Action |
|-------|--------|
| SSH permission denied | Ensure `hdc` user SSH keys from guest baseline; try `ssh hdc@<ip>` |
| Cannot resolve IP | Pass `--host` from inventory or `hdc run service hdc-agents query -- --live` |
| Guest SSH down | Use Proxmox `pct exec <vmid>` manually to verify guest is up; fix guest before pull |
| `rsync` missing (Windows) | Script falls back to `tar+ssh` automatically |

## API alternative (tasks metadata only)

hdc-web-server `:9120` exposes `GET /api/tasks` for inspection. Prefer the pull script for git-syncable files under `operations/`.
