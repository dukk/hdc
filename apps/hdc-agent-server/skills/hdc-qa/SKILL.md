---
name: hdc-qa
description: >-
  Clump validation checklist, QA report template, and handoffs for hdc-qa.
---

# HDC QA skill

## Checklist (per package)

1. `hdc_validate_clump` with `tier` + `clump`
2. Fix blockers via engineer tasks (do not silently ignore errors)
3. Optional: `hdc_run` `query` / `health` when guest is live
4. Optional: `hdc_delegate_augment` for deep test/refactor slices
5. If a durable new failure mode was fixed, check whether `hdc-private/ai-docs/` needs a Gotcha/Playbook (`hdc-okf`) — flag in handoff if missing
6. Write report under `operations/reports/`

## Report template

```markdown
# QA: <clump id>

**Date:** <YYYY-MM-DD>
**Tier:** <tier>
**Validate ok:** true|false

## Findings

| Severity | Code | Message |
| --- | --- | --- |
| error|warning | … | … |

## Live probes

- query: …
- health: …

## Handoffs

- tasks opened: …
```

## Handoffs

| Finding | Role |
| --- | --- |
| Package script / manifest / example | `hdc-sre-engineer` |
| Missing schema / CLI (hdc platform) | Operator (escalate `needs_decision`) |
| Ready for deploy after green QA | `hdc-manager` → `hdc-sre-ops` (approved) |

## Augmentor

Default repo `hdc-clumps`. Use `hdc` when validating platform tests/schemas. Never ask augmentors to edit hdc-private.
