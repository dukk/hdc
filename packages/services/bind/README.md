# BIND DNS (`bind`)

Authoritative DNS on Proxmox QEMU VMs: primary/secondary pair, zone files from `config.json`, TSIG zone transfers.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (`zones[]` with records; `deployments[].proxmox.qemu.ip` for static cloud-init CIDR; no per-deployment `vmid`)
- **Inventory:** [`inventory/manual/systems/vm-dns-a.json`](../../../inventory/manual/systems/vm-dns-a.json), [`vm-dns-b.json`](../../../inventory/manual/systems/vm-dns-b.json)
- **TSIG:** Deploy auto-generates `bind.tsig_secret` in `config.json` (and syncs `HDC_BIND_TSIG_KEY` in the vault) when missing. Rotate with `--regenerate-tsig`. Manual: `dnssec-keygen -a HMAC-SHA256 -b 256 -n HOST .`
- **Forwarders:** `bind.forwarders` defaults to `1.1.1.1` and `1.0.0.1` for recursive queries (rendered into `named.conf.options`).

## Provisioning

- **Static IP:** each `proxmox-qemu` deployment must set `proxmox.qemu.ip` (e.g. `192.0.2.2/24`) plus matching `configure.ssh.host`.
- **VMID:** not stored in config. Deploy allocates the next free cluster VMID (from `defaults.proxmox.qemu.vmid_start`, default `100`) and rediscovers existing guests by `hostname` (Proxmox guest name).

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | Clone Ubuntu VMs, auto-allocate VMID, cloud-init static IP, install BIND (primary before secondary) |
| `maintain` | Re-push `named.conf.options` (forwarders) on all nodes; re-render zones on primary; verify SOA serial |
| `query` | `named` status; per-zone `dig SOA` |

```bash
node tools/hdc/cli.mjs run service bind deploy -- --destroy-existing
node tools/hdc/cli.mjs run service bind maintain --
```

## Common flags

`--instance a|b`, `--destroy-existing`, `--skip-provision`, `--skip-install`, `--regenerate-tsig`, `--dry-run`, `--no-report`.

## After deploy

1. **DNS service:** UDP/TCP port **53** on each VM IP (from `deployments[].proxmox.qemu.ip` or query).
2. **No web UI.** Test: `dig @<primary-ip> SOA <your-zone>`.
3. Point resolvers or downstream DNS at the primary/secondary IPs. Recursive queries use `bind.forwarders` (default Cloudflare `1.1.1.1` / `1.0.0.1`).
4. For Let's Encrypt DNS-01 elsewhere, reuse `HDC_BIND_TSIG_KEY` in nginx/nginx-waf packages.

## Related

- [AGENTS.md — BIND](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/bind.config.schema.json`](../../../tools/hdc/schema/bind.config.schema.json)
