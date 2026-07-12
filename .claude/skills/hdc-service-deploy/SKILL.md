---
name: hdc-service-deploy
description: >-
  Configures and deploys HDC service packages via the hdc CLI: interactive
  discovery (IP, Proxmox node, VM vs LXC vs Synology), writes plan.md for
  approval, runs deploy with script fixes on failure, and optional dependency
  packages (bind, nginx-waf, cloudflare, synology-nas). Use when deploying a
  service, scaffolding a new package, fixing a deploy script, or wiring reverse
  proxy and DNS for an app.
---

Canonical definition: [`.cursor/skills/hdc-service-deploy/SKILL.md`](../../../.cursor/skills/hdc-service-deploy/SKILL.md).

Read that file now and follow its checklist and templates exactly, including its
companion files `dependencies.md` and `plan-template.md` in the same directory. This
pointer exists only because Claude Code requires a `SKILL.md` at this path — the
actual content is not duplicated here, so `.cursor/skills/hdc-service-deploy/` is the
single source of truth.
