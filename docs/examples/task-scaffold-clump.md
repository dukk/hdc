# Example task: scaffold clump for unknown capability

Copy into hdc-private as `operations/tasks/<id>.md` (change `id` / `status: pending`).
See also live template `example-scaffold-clump.md` (kept `status: done`).

```markdown
---
id: 2026-07-15-scaffold-foo
role: hdc-sre-engineer
priority: medium
status: pending
title: "Scaffold clump for foo service"
created_at: 2026-07-15T00:00:00Z
updated_at: 2026-07-15T00:00:00Z
needs_decision: false
evidence:
  - "Operator ask: automate foo"
suggested_commands: []
---

Build-only package scaffold. Use hdc_web_* / hdc_request_research as needed.
Do not deploy — hand off to hdc-manager (sync) then hdc-sre-ops (approved).
```
