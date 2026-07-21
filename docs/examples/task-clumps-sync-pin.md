# Example task: sync / pin hdc-clumps on the fleet host

Copy into hdc-private as `operations/tasks/<id>.md` (change `id` / dates / `status`).

## Track latest on main

```markdown
---
id: 2026-07-19-clumps-sync-latest
role: hdc-manager
priority: medium
status: pending
title: "Sync hdc-clumps to latest main"
created_at: 2026-07-19T00:00:00Z
updated_at: 2026-07-19T00:00:00Z
needs_decision: false
evidence:
  - "Operator ask: get latest clumps"
suggested_commands: []
---

Run `hdc_clumps_sync` with `action: sync`, `ref: main`, `persist: true`.
Record the resolved HEAD SHA in evidence / task-report.md.
```

## Pin to a tag or commit

```markdown
---
id: 2026-07-19-clumps-pin-tag
role: hdc-manager
priority: medium
status: pending
title: "Pin hdc-clumps to v1.2.3"
created_at: 2026-07-19T00:00:00Z
updated_at: 2026-07-19T00:00:00Z
needs_decision: false
evidence:
  - "Operator ask: stay on clumps v1.2.3"
suggested_commands: []
---

Run `hdc_clumps_sync` with `action: sync`, `ref: v1.2.3` (persist defaults true).
Future syncs without `ref` must stay on this pin.
```

## One-shot try (do not change pin)

```markdown
---
id: 2026-07-19-clumps-try-sha
role: hdc-manager
priority: low
status: pending
title: "Try hdc-clumps at commit abc1234"
created_at: 2026-07-19T00:00:00Z
updated_at: 2026-07-19T00:00:00Z
needs_decision: false
evidence: []
suggested_commands: []
---

Run `hdc_clumps_sync` with `action: sync`, `ref: abc1234`, `persist: false`.
Do not rewrite hdc-private `.hdc/clumps-repos.json`.
```
