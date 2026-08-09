# Home network IP allocations (example)

**Fictional public template** — use RFC 5737 addresses only. Live site registry:
hdc-private `operations/ip-allocations.md` (never commit real site IPs to public hdc).

Agents must consult the **private** file before assigning addresses.

## Source of truth (read order)

1. **This file** (in hdc-private) — IP group boundaries and next-free guidance.
2. **Live assignments** — `operations/inventory/systems/{physical,virtual}/*.json`, bind/clump configs.
3. Spreadsheet (operator) — when boundaries change.

## Subnets (example site-wide)

| Network | Base | CIDR | Domain | VLAN | Notes |
| --- | --- | ---: | --- | ---: | --- |
| Servers | 192.0.2.0 | /24 | home.example.invalid | 10 | Documentation range |

## IP groups (Servers / 192.0.2.0/24)

### Example services

| Field | Value |
| --- | --- |
| CIDR range | `192.0.2.50` – `192.0.2.99` |
| Network | Servers (`192.0.2.0/24`) |
| Gateway | `192.0.2.1` |
| BIND zone | `home.example.invalid` |
| **Next free** | `192.0.2.51` |

#### Assignments

| IP | Host | Status | Notes |
| --- | --- | --- | --- |
| `192.0.2.50` | example-service-a | assigned | public inventory example |
