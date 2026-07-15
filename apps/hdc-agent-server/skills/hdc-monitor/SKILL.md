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
hdc run service uptime-kuma query -- --live
hdc run infrastructure proxmox query
hdc run service gatus query -- --live
```

## Uptime Kuma maintain (when fixing drift)

Only with Manager approval unless reconciling monitors already in config.

## Evidence sources

- Prior digest: `operations/reports/monitor-*.md`
- Daily maintain reports
- Package reports under clumps

## Digest template

Summary (green/yellow/red), down/degraded, drift, tasks enqueued. One `.md` per task under `operations/tasks/`.

## Monthly backup verification

Include PBS / Synology backup health; enqueue SRE restore-drill tasks when needed.
