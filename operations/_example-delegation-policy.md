# HDC agent delegation policy (example)

**Fictional public template.** Live policy: hdc-private `operations/delegation-policy.md`.
Operators edit the private file; agents read it before destructive work.

## Always autonomous (no approval)

- `hdc run … query` and `query --live`
- Read inventory, clump configs, and operation reports
- Write digests to `operations/reports/`
- Write proposals to `operations/proposals/{security,network}/`
- Create task files under `operations/tasks/` with status `pending`

## Autonomous with notify

- Routine `maintain` without `--prune` / `--destroy-existing`

## Requires operator approval (task status `approved`)

- `deploy`, `teardown`, `maintain --prune`, `maintain --destroy-existing`
- BIND / Cloudflare / nginx-waf / UniFi firewall changes (except documented auto-blocks)
- Guest or hypervisor reboot; service version promotion
- Any change to the **hdc** platform repo (fleet agents must not edit hdc)

## Escalation channels

Configure routes in hdc-agents notifications (see `docs/manually-deployed/manager-notifications.md`).

## Role boundaries

| Role | May | Must not |
| --- | --- | --- |
| hdc-manager | Triage, delegate, `hdc_clumps_sync` | Deploy without `approved` |
| hdc-sre-ops | Approved live ops (hdc-private) | Edit hdc platform or clumps scripts |
| hdc-sre-engineer | hdc-clumps package work | Live deploy / hdc platform edits |
| hdc-security-architect | `proposals/security/` | Live firewall changes |
| hdc-network-architect | `proposals/network/` | Live network changes |

Copy and customize this skeleton into hdc-private; keep site-specific approval rules private.
