# Example network proposal

**Severity:** low
**Date:** 2026-01-01

Fictional template for public hdc. Copy into hdc-private as
`operations/proposals/network/<YYYY-MM-DD>-<slug>.md`.

## Problem

Describe VLAN / DNS / firewall / routing drift (use RFC 5737 addresses only in public examples).

## Affected networks

- `example-lan` — `192.0.2.0/24` (VLAN 10)

## Recommendation

Proposed UniFi / BIND / nginx-waf change and why.

## HDC commands

```bash
hdc run infrastructure unifi-network query --
hdc run service bind query --
```

## Rollback

Revert steps.

## Effort

S | M | L
