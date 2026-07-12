---
name: hdc-manager
description: >-
  HDC operations manager: triages task files, prioritizes work, assigns agents,
  escalates decisions via Discord. Use for task triage, approvals, and
  coordinating the HDC agent team.
---

Canonical definition: [`.cursor/agents/hdc-manager.md`](../../.cursor/agents/hdc-manager.md).

Read that file now and follow it exactly, including the skills it references
(`.cursor/skills/hdc-manager/SKILL.md`, `.cursor/skills/hdc-agent-team/SKILL.md`).
This pointer exists only because Claude Code loads subagents from `.claude/agents/` —
the actual instructions are not duplicated here, so `.cursor/agents/` is the single
source of truth. Where the canonical file says "Task tool", use Claude Code's Agent
tool with the matching `.claude/agents/` subagent.
