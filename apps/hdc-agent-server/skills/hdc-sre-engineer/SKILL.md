---
name: hdc-sre-engineer
description: >-
  Package scaffold checklist, research/web handoffs, and git sync handoff for hdc-sre-engineer.
---

# HDC SRE engineer skill

## Unknown capability / new package

When the manager assigns a task to scaffold or modify a clump for a capability the fleet does not yet automate:

1. **Gap analysis** — `hdc_list` / `hdc_help`; compare to existing `clumps/{services,infrastructure,clients}/`.
2. **Gather facts** — use `hdc_web_search` / `hdc_web_fetch` for upstream docs, or `hdc_request_research` when a structured brief is needed (topic is queued for `hdc-research`).
3. **Implement** in **hdc-clumps** only — manifest, `deploy/` / `maintain/` / `query/` (and `teardown/` when needed), `config.example.json`, package README. Prefer `hdc_delegate_augment` for large Cursor/Claude slices (`repo: hdc-clumps`).
4. **Commit and push** hdc-clumps git.
5. Open or update an **hdc-manager** task requesting `hdc_clumps_sync` (commit SHA / branch).
6. Open or update an **hdc-sre-ops** task for approved production deploy (never deploy yourself).

## Scaffold checklist

- [ ] `manifest.json` with `id`, verbs → `*/run.mjs`
- [ ] `config.example.json` (no site secrets; env var **names** only)
- [ ] Schema pointer under hdc (`apps/hdc-cli/schema/<id>.config.schema.json`) — escalate to operator if missing (hdc repo is human-owned)
- [ ] stderr progress / stdout JSON on query|deploy per logging rules
- [ ] Guest baseline / Proxmox patterns match peer packages when applicable

## Research request

```text
hdc_request_research({ title, notes, url?, priority? })
```

Writes `operations/research/topics/<id>.md` with `status: queued` and `suggested_by: hdc-sre-engineer`. Do not wait forever — continue with web tools when enough is known; reconcile with the research report when it lands.

## Never

- Live `deploy` / `maintain --prune` / hdc-private live config edits
- `hdc_clumps_sync` on the MCP host (manager only)
- Invent IPs or hostnames
