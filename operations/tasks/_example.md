---
id: example-scaffold-clump
role: hdc-sre-engineer
priority: medium
status: done
title: "EXAMPLE — Scaffold clump for unknown capability (template)"
created_at: 2026-01-01T00:00:00Z
updated_at: 2026-01-01T00:00:00Z
needs_decision: false
evidence:
  - "Operator ask: add automation for <service>"
  - operations/reports/research-topic-<id>-<date>.md
suggested_commands: []
---

**Template only** (`status: done` so the dispatcher ignores it). Copy into hdc-private as
`operations/tasks/<id>.md` with a new id and `status: pending`.

## Intent

Scaffold or modify an hdc-clumps package for a capability the fleet does not yet automate.
Build only — do **not** run production deploy.

## Engineer steps

1. Gap analysis (`hdc_list` / existing clumps).
2. Gather facts: `hdc_web_search` / `hdc_web_fetch`, and/or `hdc_request_research`.
3. Implement in **hdc-clumps** (manifest, verbs, `config.example.json`).
4. If a config schema is missing under hdc, escalate to the operator (`needs_decision`).
5. Commit and push hdc-clumps; open **hdc-manager** task for `hdc_clumps_sync`.
6. Open **hdc-sre-ops** task for approved live deploy (operator must set `approved`).

See also [`docs/examples/task-scaffold-clump.md`](../../docs/examples/task-scaffold-clump.md).
