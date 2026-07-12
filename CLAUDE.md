# Claude Code Guidelines — Home Data Center (HDC)

Standards are defined **once**, in `.cursor/rules/` (the canonical source — Cursor's
glob-based rule engine reads it directly), and imported below so Claude Code loads the
identical content. Nothing here is hand-copied; edit `.cursor/rules/*.mdc` and both
tools pick up the change. See [AGENTS.md](AGENTS.md) for the full repo map, CLI
reference, and per-package documentation.

Cursor auto-attaches each rule only when editing files matching its `globs:`
frontmatter; Claude Code has no equivalent mechanism, so every imported rule below
applies repo-wide for the whole session regardless of scope.

## Always-on standards

@.cursor/rules/hdc-automation.mdc

@.cursor/rules/hdc-inventory-naming.mdc

## Path-specific standards

These carry a `globs:` scope in Cursor (noted per file); Claude Code just applies them
whenever the matching files are actually in play.

@.cursor/rules/hdc-automation-logging.mdc

@.cursor/rules/hdc-testing.mdc

@.cursor/rules/hdc-homepage-dashboard.mdc

@.cursor/rules/proxmox-qemu-guest-agent.mdc

@.cursor/rules/proxmox-resource-planning.mdc

**Archived (not imported):** [`.cursor/rules/hdc-nagios-monitoring.mdc`](.cursor/rules/hdc-nagios-monitoring.mdc)
— Nagios is decommissioned; read it only if restoring the `nagios` package.

## Skills

Canonical skill definitions live in `.cursor/skills/`. Claude Code requires its own
`SKILL.md` under `.claude/skills/<name>/`, so each of those is a thin pointer —
frontmatter only, plus one line telling Claude to read and follow the matching
`.cursor/skills/<name>/SKILL.md`. The checklists and templates are never duplicated.

| Skill | Use when |
|-------|----------|
| `hdc-ops` | Running hdc CLI operations: list, deploy, maintain, query |
| `hdc-service-deploy` | Deploying a new service package end-to-end (plan → approve → deploy) |
| `proxmox-resource-planning` | Sizing a new Proxmox VM/CT and checking cluster headroom |
| `hdc-manager` | Task triage, escalation, and delegation workflows |
| `hdc-monitor` | Monitoring runbook (uptime-kuma, proxmox query, digests) |
| `hdc-security` | Security queries and response (wazuh, crowdsec, nginx-waf) |
| `hdc-agent-team` | Shared agent-team conventions: task files, digests, paths |

## Subagents

Canonical agent definitions live in `.cursor/agents/`. Claude Code loads subagents
from `.claude/agents/`, so each file there is a thin pointer with matching
frontmatter that instructs the agent to read and follow the corresponding
`.cursor/agents/<name>.md`. See the "Agent team" section of
[AGENTS.md](AGENTS.md) and [docs/multi-agent-ops.md](docs/multi-agent-ops.md) for
the roster and orchestration model.

## Quality gate

```bash
npm install     # devDependencies only (Vitest)
npm run test    # after any apps/hdc-cli/ change
```

Before merging substantive CLI changes: `npm run test:coverage` (thresholds in
`vitest.config.mjs`).

## Maintaining this file

Adding a new Cursor rule? Add one `@.cursor/rules/<file>.mdc` line above (under
"Always-on" if `alwaysApply: true`, otherwise "Path-specific"). Adding a new Cursor
skill? Add a matching thin-pointer `.claude/skills/<name>/SKILL.md` (copy an existing
one and swap `name`/`description`) plus a row in the table above. Adding a new Cursor
agent? Add a matching thin-pointer `.claude/agents/<name>.md`.
