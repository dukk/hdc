---
name: hdc-monitor
description: >-
  HDC monitoring runbook: uptime-kuma, proxmox cluster snapshot, digest and
  task queue updates.
---

# HDC monitor skill

## Commands

Prefer hdc tools / CLI:

```bash
hdc run service uptime-kuma query -- --failing-only
hdc run service homepage query -- --failing-only
hdc run infrastructure proxmox query -- --failing-only
hdc run service uptime-kuma query -- --live
hdc run infrastructure proxmox query
hdc run service gatus query -- --live
```

The fleet dispatcher runs the three `--failing-only` probes before invoking you. When invoked, the prompt includes a markdown outage summary — treat it as the authoritative current failure set.

## Uptime Kuma maintain (when fixing drift)

Only with Manager approval unless reconciling monitors already in config.

## Evidence sources

- Scripted outage pre-check summary (dispatcher prompt)
- Prior digest: `operations/reports/monitor-*.md`
- Daily maintain reports
- Package reports under clumps

## Digest template

Summary (green/yellow/red), down/degraded, drift, tasks enqueued. Create or update one `.md` task per outage with stable ids (`monitor-outage-<slug>`).

## Monthly backup verification

Include PBS / Synology backup health; enqueue SRE restore-drill tasks when needed.
