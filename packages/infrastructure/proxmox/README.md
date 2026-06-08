# Proxmox virtualization (`proxmox`)

HDC automation for Proxmox VE hypervisors: API provisioning (LXC/QEMU), host maintenance, and cluster inventory queries. Other service packages call into these capabilities indirectly.

## Prerequisites

- **Config:** copy [`config.example.json`](config.example.json) to `config.json` (gitignored).
- **Inventory:** hypervisors in `inventory/manual/systems/` with tag `proxmox` or `automation_targets: ["proxmox"]`; [`inventory/manual/targets/proxmox.json`](../../../inventory/manual/targets/proxmox.json).
- **Vault / env:** Proxmox API token and SSH credentials per `.env.example` (e.g. `HDC_PROXMOX_*`).

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | Subcommands: create LXC, clone QEMU VM, list templates |
| `maintain` | Host hygiene: templates, firewall, API token, service accounts, upgrades, scheduled backups, replication, HA, guest startup order, guest-agent report |
| `query` | Cluster/guest snapshot (JSON on stdout) |

```bash
node tools/hdc/cli.mjs run infrastructure proxmox maintain -- verify-templates
node tools/hdc/cli.mjs run infrastructure proxmox query --
node tools/hdc/cli.mjs run infrastructure proxmox deploy -- create-container
node tools/hdc/cli.mjs run infrastructure proxmox deploy -- create-vm
node tools/hdc/cli.mjs run infrastructure proxmox deploy -- list-templates
node tools/hdc/cli.mjs help run infrastructure proxmox
```

### Deploy / maintain capabilities

| Service id | Verb | Invoke | Summary |
|------------|------|--------|---------|
| `lxc-create` | deploy | `create-container` | Create LXC from ostemplate |
| `qemu-clone` | deploy | `create-vm` | Full clone from QEMU template (`agent=1` after clone) |
| `qemu-list-templates` | deploy | `list-templates` | List template VMIDs |
| `verify-templates` | maintain | — | SSH keys, APT sources, firewall, templates, NAS storage, scheduled backup jobs, replication jobs, HA groups/resources, guest startup order, host upgrades, QEMU guest agent report |
| `cluster-snapshot` | query | — | Hypervisors and guests JSON |

Bootstrap the local `hdc` user on Ubuntu hosts with `run infrastructure ubuntu maintain` or `users bootstrap-hdc` — not from `proxmox maintain`.

## Common flags

Pass after `--` (varies by subcommand). Shared: `--dry-run`, `--no-report`, `--report <path>`.

Maintain `verify-templates` writes a report under `packages/infrastructure/proxmox/reports/` in hdc-private when that repo is available, otherwise under public hdc.

## Scheduled backups

`proxmox maintain` ensures Proxmox **Datacenter → Backup** jobs for guests listed in service `deployments[]` when `provision.backups.enabled` is true (default).

### Config

Global profiles live in `provision.backups` in [`config.json`](config.json) (see [`config.example.json`](config.example.json)):

- **`weekly`** (default): `sun 03:00`, `keep-last=3`
- **`daily`**: once per day, `keep-last=7`
- **`hourly`**: every hour, `keep-daily=7,keep-last=3` (one backup per day for 7 days plus the last 3 hourly)

Set `default_storage` to a NAS datastore with **Backup** content (e.g. `nas-1`). Per-service overrides use `defaults.backup` or `deployments[].backup` in each service package config:

```json
"backup": { "profile": "hourly" }
```

Opt out with `"backup": { "enabled": false }`. Jobs are named `hdc-backup-<system_id>` and only hdc-prefixed jobs are updated or removed (`maintain --prune`).

### Rollout

1. Confirm `nas-1` (or your `default_storage`) includes **Backup** in Proxmox Datacenter → Storage → Content.
2. Copy `provision.backups` into hdc-private `packages/infrastructure/proxmox/config.json`.
3. Set service profiles (e.g. vaultwarden `hourly`, bind/nginx-waf `daily`).
4. Run `node tools/hdc/cli.mjs run infrastructure proxmox maintain -- --dry-run`, then without `--dry-run`.
5. Verify jobs in Proxmox UI under Datacenter → Backup.

Flags: `--skip-backups`, `--dry-run`, `--no-prune` (skip deleting stale `hdc-backup-*` jobs).

## Storage replication

`proxmox maintain` ensures Proxmox **Datacenter → Replication** jobs for guests with `replication` in service `deployments[]` when `provision.replication.enabled` is true (default).

Replication copies local-storage guests to a peer node on a schedule. Pair with HA (below) for automatic failover when a hypervisor fails.

### Config

Global profiles in `provision.replication` (see [`config.example.json`](config.example.json)):

- **`frequent`** (default): every 15 minutes (`*/15`)
- **`hourly`**: top of each hour (`*/00`)
- **`daily`**: once per day

Per-service overrides on `defaults.replication` or `deployments[].replication`:

```json
"replication": {
  "enabled": true,
  "target_host_id": "pve-c",
  "profile": "frequent"
}
```

Job ids use Proxmox format `{vmid}-{suffix}` (default suffix `0`). Hdc-managed jobs are tagged `comment: hdc-managed: <system_id>` and pruned with `maintain --prune`.

**Storage prerequisite:** Proxmox **pvesr** replication supports **ZFS local storage only** (`zfs`, `zfspool`). Guests on `lvmthin` / `local-lvm` cannot replicate — migrate DNS VM/CT disks to a ZFS pool on each node first. Each disk must also have `replicate=1` (hdc maintain sets this automatically on supported storage).

**Cross-peer DNS pattern:** replicate bind-a on `pve-b` → `pve-c`, bind-b on `pve-c` → `pve-b` (same for pi-hole-a/b). Until disks are on ZFS, maintain reports a clear skip reason instead of Proxmox HTTP 500.

Flags: `--skip-replication`, `--dry-run`, `--no-prune`.

## High availability (HA)

`proxmox maintain` ensures **Datacenter → HA** groups and resources when `provision.ha.enabled` is true (default). Requires cluster quorum, `ha-manager`, and **fencing** in production.

### Config

```json
"ha": {
  "enabled": true,
  "groups": {
    "hdc-dns": { "nodes": ["pve-b", "pve-c"] }
  },
  "defaults": {
    "group": "hdc-dns",
    "max_restart": 3,
    "max_relocate": 2,
    "state": "started"
  }
}
```

Per deployment:

```json
"ha": { "enabled": true }
```

Guests with HA should also have replication configured (maintain warns otherwise). Initial replication sync must complete before HA failover is reliable.

On **Proxmox VE 9+**, hdc uses **node-affinity rules** (`/cluster/ha/rules`) instead of legacy HA groups. HA resources are registered without a `group` field; the rule lists all managed resource sids.

Flags: `--skip-ha`, `--dry-run`, `--no-prune`.

## Guest startup order

`proxmox maintain` sets Proxmox **Start/Shutdown order** (`startup=order=…,up=…`) on priority guests when `provision.startup.enabled` is true (default).

### Config

Priorities live in `provision.startup` in [`config.json`](config.json) (see [`config.example.json`](config.example.json)):

```json
"startup": {
  "enabled": true,
  "default_up": 30,
  "manage_from_deployments": true,
  "priorities": {
    "bind": 1,
    "nginx-waf": 2,
    "postfix-relay": 3
  }
}
```

- Lower `order` starts first; guests with the same order start together.
- `default_up` is the delay in seconds before the next order group starts (30s default).
- Per-guest overrides: `proxmox.lxc.startup` / `proxmox.qemu.startup` in service config (or `defaults.proxmox.*`).
- Other guests keep `onboot` only; hdc does not clear existing startup order on unmanaged guests.

Service examples set explicit startup on bind (`order: 1`), nginx-waf (`order: 2`), and postfix-relay (`order: 3`) so deploy applies it immediately; maintain reconciles from service configs and the priorities map.

### Rollout

1. Copy `provision.startup` into hdc-private `packages/infrastructure/proxmox/config.json`.
2. Run `node tools/hdc/cli.mjs run infrastructure proxmox maintain -- --dry-run`, then without `--dry-run`.
3. Verify in Proxmox UI: VM/CT → Options → Start/Shutdown order.

Flags: `--skip-startup`, `--dry-run`.

## Service accounts (`provision.service_accounts[]`)

Declarative Proxmox **users** and **API tokens** for third-party consumers (separate from the hdc operator token on `root@pam`).

`proxmox maintain` on each cluster lead host:

1. Creates the PVE user when missing (`pveum user add`) and stores the password in vault (`password_vault_key`).
2. Creates the API token when missing (`pveum user token add --privsep 1`) and stores `user@realm!tokenid=secret` in vault (`token_vault_key`).
3. Ensures **user and token** ACL at `/` with the configured role (default built-in **PVEAuditor** for read-only widgets), both with propagate. Privilege-separated tokens need the owning user permission as well; token-only ACL returns a stripped `GET /cluster/resources` payload (no VM/LXC counts or node CPU/RAM), which breaks gethomepage Proxmox widgets.
4. Verifies the token against `GET /cluster/resources` and checks the response includes online nodes with `maxmem`/`maxcpu` and at least one non-template QEMU guest.

Example (see [`config.example.json`](config.example.json)):

```json
"service_accounts": [
  {
    "id": "homepage",
    "userid": "homepage@pam",
    "tokenid": "homepage",
    "role": "PVEAuditor",
    "password_vault_key": "HDC_PROXMOX_USER_HOMEPAGE_PASSWORD",
    "token_vault_key": "HDC_HOMEPAGE_PROXMOX_API_TOKEN"
  }
]
```

The **homepage** service references `id: homepage` and pushes widget credentials to the dashboard container.

Flags: `--skip-service-accounts`, `--regenerate-service-token <id>`, `--regenerate-service-password <id>`.

## After deploy / Using the service

This package manages **hypervisors**, not end-user apps.

1. **Proxmox web UI:** `https://<hypervisor-host>:8006` (host IP from inventory or `config.json`).
2. **SSH:** use keys/bootstrap from maintain; allowed LANs are enforced by host firewall during `verify-templates`.
3. **Guests:** use service packages (`pi-hole`, `ollama`, etc.) or `deploy create-container` / `create-vm` for one-off provisioning.

QEMU clones enable the guest agent in VM config; Linux guests get `qemu-guest-agent` when a service deploys over SSH. See [`.cursor/rules/proxmox-qemu-guest-agent.mdc`](../../../.cursor/rules/proxmox-qemu-guest-agent.mdc).

## Related

- [AGENTS.md — Proxmox](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/proxmox.config.schema.json`](../../../tools/hdc/schema/proxmox.config.schema.json)
- Resource planning: [`.cursor/skills/proxmox-resource-planning/SKILL.md`](../../../.cursor/skills/proxmox-resource-planning/SKILL.md)
