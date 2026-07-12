---
name: hdc-ops
description: >-
  Legacy alias for HDC operator work. Prefer hdc-sre for implementation and
  hdc-manager for coordination. Use hdc-ops only when explicitly asked for
  general CLI operations.
---

Canonical definition: [`.cursor/agents/hdc-ops.md`](../../.cursor/agents/hdc-ops.md).

Read that file now and follow it exactly. **Prefer `hdc-sre`** for deploy, maintain,
and package work and **`hdc-manager`** for triage and approvals. For CLI reference,
read `.cursor/skills/hdc-ops/SKILL.md`. This pointer exists only because Claude Code
loads subagents from `.claude/agents/` — the actual instructions are not duplicated
here, so `.cursor/agents/` is the single source of truth.
