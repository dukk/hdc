---
name: hdc-monitor
description: >-
  HDC monitoring runbook: uptime-kuma, proxmox cluster snapshot, digest and
  task queue updates. Use with hdc-monitor subagent or monitor automations.
disable-model-invocation: true
---

# HDC monitor skill

## Commands

From hdc repo root:

```bash
node tools/hdc/cli.mjs run service uptime-kuma query -- --live
node tools/hdc/cli.mjs run infrastructure proxmox query
```

Optional:

```bash
node tools/hdc/cli.mjs run service gatus query -- --live
```

## Uptime Kuma maintain (when fixing drift)

Requires vault `HDC_UPTIME_KUMA_PASSWORD` and `.env` `HDC_UPTIME_KUMA_USERNAME`:

```bash
node tools/hdc/cli.mjs run service uptime-kuma maintain --
node tools/hdc/cli.mjs run service uptime-kuma maintain -- --monitor <id>
node tools/hdc/cli.mjs run service uptime-kuma query -- --import-from-homepage --yes
```

Only run maintain with Manager approval unless reconciling monitors already in config.

## Evidence sources

- Prior digest: `hdc-private/operations/reports/monitor-*.md`
- Daily maintain: `tools/hdc/reports/daily-maintain-*.md` (hdc-private when present)
- Package reports: `hdc-private/packages/services/*/reports/`

## Digest template

```markdown
# Monitor digest — <timestamp>

## Summary
- Overall: green | yellow | red

## Down / degraded
- <service> — evidence

## Drift
- uptime-kuma: …

## Tasks enqueued
- <task-id>: …
```

Append matching entries as new files under `operations/tasks/` (one `.md` per task).
