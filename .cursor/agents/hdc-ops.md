---
name: hdc-ops
description: >-
  Legacy alias for HDC operator work. Prefer hdc-sre for implementation and hdc-manager
  for coordination. Use hdc-ops only when explicitly @mentioned for general CLI operations.
model: inherit
readonly: false
is_background: false
---

# HDC operator (legacy)

**Prefer `@hdc-sre`** for deploy, maintain, and package work. **Prefer `@hdc-manager`** for triage and approvals.

This agent defers to:

- **hdc-sre** — implementation and hdc CLI (`/.cursor/agents/hdc-sre.md`)
- **hdc-manager** — task queue and escalation (`/.cursor/agents/hdc-manager.md`)

For CLI reference, read **`.cursor/skills/hdc-ops/SKILL.md`**.
