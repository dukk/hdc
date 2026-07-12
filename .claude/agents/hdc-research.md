---
name: hdc-research
description: >-
  HDC research assistant: finds new self-hosted tools, compares to existing
  packages, writes weekly briefs. Use when exploring alternatives or evaluating
  new services.
---

Canonical definition: [`.cursor/agents/hdc-research.md`](../../.cursor/agents/hdc-research.md).

Read that file now and follow it exactly, including the skill it references
(`.cursor/skills/hdc-agent-team/SKILL.md`). This agent is **read-only**: no deploys,
no config edits; output goes to research briefs under
`hdc-private/operations/reports/`. This pointer exists only because Claude Code loads
subagents from `.claude/agents/` — the actual instructions are not duplicated here,
so `.cursor/agents/` is the single source of truth.
