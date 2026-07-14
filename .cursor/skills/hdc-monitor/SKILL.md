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
node apps/hdc-cli/cli.mjs run service uptime-kuma query -- --live
node apps/hdc-cli/cli.mjs run infrastructure proxmox query
```

Optional:

```bash
node apps/hdc-cli/cli.mjs run service gatus query -- --live
```

## Uptime Kuma maintain (when fixing drift)

Requires vault `HDC_UPTIME_KUMA_PASSWORD` and `.env` `HDC_UPTIME_KUMA_USERNAME`:

```bash
node apps/hdc-cli/cli.mjs run service uptime-kuma maintain --
node apps/hdc-cli/cli.mjs run service uptime-kuma maintain -- --monitor <id>
node apps/hdc-cli/cli.mjs run service uptime-kuma query -- --import-from-homepage --yes
```

Only run maintain with Manager approval unless reconciling monitors already in config.

## Evidence sources

- Prior digest: `hdc-private/operations/reports/monitor-*.md`
- Daily maintain: `apps/hdc-cli/reports/daily-maintain-*.md` (hdc-private when present)
- Package reports: `hdc-private/clumps/services/*/reports/`

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

## Monthly backup verification

1. Include PBS / Synology backup health in the digest (**Backup verification** section).
2. If backups are missing or restore untested > 30 days, enqueue SRE task for a restore drill (`status: pending`, Manager approves before destructive test).
3. Prefer `proxmox query` / maintain guest-backup sections and `synology-nas query --live` — do not invent NAS paths.
