# Pi-hole DNS filtering (`pi-hole`)

Deploy Pi-hole on Proxmox LXC (multi-instance), update blocklists, and query status.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (in hdc-private for production)
- **Inventory:** optional [`inventory/manual/systems/pi-hole-a.json`](../../../inventory/manual/systems/pi-hole-a.json), [`pi-hole-b.json`](../../../inventory/manual/systems/pi-hole-b.json)
- **Secrets:** set `defaults.pihole.webpassword` and `defaults.proxmox.lxc.password` in config (non-interactive deploy). Optional vault: `webpassword_vault_key` / `HDC_PIHOLE_API_TOKEN` for API query later.

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC provision + unattended Pi-hole install |
| `maintain` | Gravity update; optional core update; `--apply-network` to set static `ip_config` on existing CTs |
| `query` | Per-instance status via `pct exec` |

```bash
node tools/hdc/cli.mjs run service pi-hole deploy --
node tools/hdc/cli.mjs run service pi-hole maintain --
node tools/hdc/cli.mjs run service pi-hole query --
```

## Common flags

`--instance a|b`, `--system-id pi-hole-b`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-core-update` (maintain), `--apply-network` (maintain: stop CT, set Proxmox `net0` from `proxmox.lxc.ip_config` or `ip` + `proxmox.network.gateway`), `--webpassword` (override config), `--dry-run`, `--no-report`.

Static IP in config: use `deployments[].proxmox.lxc.ip_config` as `10.0.0.4/24,gw=10.0.0.1` (or `ip: 10.0.0.4/24` with `defaults.proxmox.network.gateway`). Not the QEMU-style `ip` field alone on deploy without gateway.

**Multi-VLAN DNS:** Set `defaults.pihole.listening_mode` to `ALL` (default in `config.example.json`) so clients outside the Pi-hole subnet (e.g. `10.1.0.0/24`) can query Pi-hole. `LOCAL` only answers for the same subnet as the CT.

## After deploy

1. Get IP: `node tools/hdc/cli.mjs run service pi-hole query --` or set `access.nodes[].ip` in inventory sidecars.
2. **Web admin:** `http://<guest-ip>/admin` (password from `pihole.webpassword` in config).
3. **DNS:** point clients or DHCP (e.g. UniFi) at both Pi-hole IPs for redundancy.

## Related

- [AGENTS.md — Pi-hole](../../../AGENTS.md)
