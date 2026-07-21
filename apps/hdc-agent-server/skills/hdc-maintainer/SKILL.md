---
name: hdc-maintainer
description: >-
  HDC maintenance planning: weekly OS updates, reboot approvals, service version
  upgrades, and maintainer digests/tasks.
---

# HDC maintainer skill

## Scripted scan (dispatcher)

Daily pre-check runs before LLM invocation:

- `client windows|client-ubuntu|raspberrypi query` — pending updates, `reboot_required`
- Service version probes (`query --live` + upstream latest where catalogued)
- `proxmox query --reboot-required`, `proxmox query --pending-os-updates`
- Weekly client maintain cron verification (scheduler logs)

## Task id conventions

| Pattern | Role | needs_decision |
| --- | --- | --- |
| `maintainer-reboot-<slug>` | hdc-sre-ops | true |
| `maintainer-upgrade-<service>` | hdc-sre-ops | true |
| `maintainer-hypervisor-os-<node>` | hdc-sre-ops | true |
| `maintainer-routine-overdue-<platform>` | hdc-sre-ops | false |

Update open tasks instead of duplicating.

## Approval matrix

| Work | Approval |
| --- | --- |
| Weekly client maintain (no reboot) | Autonomous cron |
| Guest/hypervisor reboot | Operator approve |
| Service version promotion (config bump + maintain) | Operator approve |
| Hypervisor dist-upgrade | Operator approve |

## Digest template

Summary of pending updates, reboots, upgrade candidates, weekly routine status, tasks upserted. Path: `operations/reports/maintainer-<ISO-timestamp>.md`.
