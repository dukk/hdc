# Example security proposal

**Severity:** medium
**Date:** 2026-01-01

Fictional template for public hdc. Copy into hdc-private as
`operations/proposals/security/<YYYY-MM-DD>-<slug>.md`.

## Risk

Describe the exposure (no real hostnames or IPs in the public template).

## Affected systems

- `example-service-a` — example LXC / role

## Recommendation

Concrete mitigation using hdc packages (CrowdSec, nginx-waf, UniFi block, etc.).

## HDC commands

```bash
hdc run service crowdsec query -- --live
hdc run infrastructure unifi-network maintain -- --block 192.0.2.200 --days 30
```

## Rollback

How to undo the change safely.

## Effort

S | M | L
