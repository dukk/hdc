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
| `maintain` | Host hygiene: templates, firewall, API token, upgrades, guest-agent report |
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
| `verify-templates` | maintain | — | SSH keys, APT sources, firewall, templates, NAS storage, host upgrades, QEMU guest agent report |
| `bootstrap-hdc-user` | maintain | — | Local `hdc` user on bootstrap hosts |
| `cluster-snapshot` | query | — | Hypervisors and guests JSON |

## Common flags

Pass after `--` (varies by subcommand). Shared: `--dry-run`, `--no-report`, `--report <path>`.

Maintain `verify-templates` writes a report under `packages/infrastructure/proxmox/reports/`.

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
