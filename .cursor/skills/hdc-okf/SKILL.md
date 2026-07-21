---
name: hdc-okf
description: >-
  Promote durable learnings into Open Knowledge Format (OKF) ai-docs,
  and maintain indexes/logs. Use when updating ai-docs, recording a gotcha,
  writing an agent playbook, promoting session knowledge, or OKF authorship.
---

# HDC OKF (ai-docs) — IDE

Canonical fleet copy (same workflow): [`apps/hdc-agent-server/skills/hdc-okf/SKILL.md`](../../../apps/hdc-agent-server/skills/hdc-okf/SKILL.md).

Cursor checklist when editing `ai-docs/**`: [`.cursor/rules/hdc-okf-ai-docs.mdc`](../../rules/hdc-okf-ai-docs.mdc).

## Quick path

1. All agent OKF lives in **hdc-private** `ai-docs/` only.
2. Start at `../hdc-private/ai-docs/index.md` (or `ai-docs/index.md` when private is the workspace root).
3. Add/update concept with YAML `type` → fix parent `index.md` → append `log.md`.
4. Cite human `hdc/docs/` or authoritative `operations/` files; env var names only — no secrets.

See the fleet skill for type vocabulary, promote-vs-skip rules, and writer roles.
