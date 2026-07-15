---
name: hdc-research
description: >-
  Research topic lifecycle, report template, and index maintenance for hdc-research.
---

# HDC research skill

## Paths (hdc-private)

| Path | Purpose |
| --- | --- |
| `operations/research/index.md` | Running list — regenerate after each topic completes |
| `operations/research/suggestions.md` | Operator inbox (manager promotes to topics) |
| `operations/research/topics/<id>.md` | One topic per file (YAML frontmatter) |
| `operations/reports/research-topic-<id>-<YYYY-MM-DD>.md` | Ad-hoc topic report |
| `operations/reports/research-<YYYY-MM-DD>.md` | Weekly discovery brief |

## Topic status lifecycle

`suggested` → `queued` (manager/operator) → `in_progress` (research running) → `done` | `deferred` | `rejected`

## Topic frontmatter

Required: `id`, `title`, `status`, `priority`, `suggested_by`, `created_at`, `updated_at`.

Optional: `url`, `report`, `outcome` (`adopt` | `manual-only` | `defer` | `reject`).

## Ad-hoc report template

```markdown
# Research: <title>

**Topic:** `<id>`  
**Date:** <YYYY-MM-DD>  
**URL:** <link if any>

## Summary

## HDC fit

- Existing packages / overlap
- Automation feasibility (clumps vs manual)
- Resource / Proxmox constraints

## Risks and licensing

## Alternatives

## Recommendation

**Outcome:** adopt | manual-only | defer | reject

## Next steps
```

## Index maintenance

After each topic completes, rebuild `operations/research/index.md`:

| ID | Title | Status | Outcome | Report | Suggested by | Updated |

Link the Report column to the relative report path when present.

## Weekly brief sections

When no queued topics: candidates table, fit vs fleet, resources, integration path, recommendation per candidate.

## Manager handoff

For `outcome: adopt` or `manual-only`, create `operations/tasks/<id>.md` with `role: hdc-manager`, `priority: low`, evidence pointing at the report. Do **not** auto-create sre-engineer scaffold tasks — the manager routes unknown-capability / adopt work.

## Engineer-queued topics

Topics may arrive with `suggested_by: hdc-sre-engineer` or `hdc-engineer` (via `hdc_request_research`). Treat them like any other `queued` topic; cite their notes/URL in the report.
