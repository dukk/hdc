---
name: hdc-okf
description: >-
  Promote durable learnings into Open Knowledge Format (OKF) ai-docs,
  and maintain indexes/logs. Use when updating ai-docs, recording a gotcha,
  writing an agent playbook, or promoting session knowledge for later recall.
---

# HDC OKF (ai-docs)

Google Open Knowledge Format v0.1: markdown concepts with YAML frontmatter under **`hdc-private/ai-docs/`** only. Human prose stays in `hdc/docs/`. Cursor checklist: `.cursor/rules/hdc-okf-ai-docs.mdc`.

## When to promote

**Promote** when the fact is durable and another agent would need it again:

- Multi-step procedure → `Playbook`
- Hard-won failure mode → `Gotcha`
- Stable ownership / policy → `Architecture` or `Reference`
- Lab-only quirk or IP procedure → `SiteFact`
- How we write OKF → `Convention`

**Do not promote:** session chatter, one-off task status, secret values, full IP tables (keep `operations/ip-allocations.md` authoritative), or long human guides (link via `# Citations`).

## Which bundle / writer

| Knowledge | Bundle | Writer |
| --- | --- | --- |
| All agent OKF (platform, package, site) | `hdc-private/ai-docs/` | Humans / IDE; `hdc-sre-ops` / `hdc-manager` / `hdc-sre-engineer` |

Fleet agents must not edit the **hdc** platform repo for code. Platform CLI/schema gaps → escalate with `needs_decision`.

## Steps to add or update a concept

1. Open `hdc-private/ai-docs/index.md` (progressive disclosure).
2. Create or edit `ai-docs/<section>/<slug>.md` (not `index.md` / `log.md`).
3. Frontmatter — required `type`; prefer `title`, `description`, `tags`, `timestamp`. Optional `resource` for the authoritative file URI/path.
4. Body — structured markdown. Within-bundle links: `/section/concept.md`.
5. Cite human `hdc/docs/` or `operations/` under `# Citations`.
6. Update the section `index.md` listing and root `index.md` if a new section/entry is needed.
7. Append a newest-first entry to `ai-docs/log.md` (ISO `YYYY-MM-DD`).
8. Env var **names** only; no secret values. Public trees still use RFC 5737 / `example.invalid`.

## Type vocabulary

`Convention` · `Architecture` · `Playbook` · `Reference` · `Gotcha` · `SiteFact`

## Close-out

- Never invent hostnames, IPs, or credentials.
- Prefer citing `docs/` or `operations/` over duplicating narrative.
- Package code changes still commit/push hdc-clumps and request manager `hdc_clumps_sync`; OKF updates live only in hdc-private (no clumps sync needed for knowledge).
