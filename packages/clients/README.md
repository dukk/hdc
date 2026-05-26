# Home clients

HDC packages for **physical workstations** and Pis: disk checks and OS updates over WinRM (Windows) or SSH (Linux). Not for Proxmox guests or NAS appliances.

## Shared config

Copy [`config.example.json`](config.example.json) to `config.json` (gitignored). Each host entry in `hosts[]` references inventory `system_id` and `access.nodes[]` (IP, MAC, `winrm` or `ssh`).

## Packages

| CLI id | Directory | Access |
|--------|-----------|--------|
| `windows` | [`windows/`](windows/) | WinRM (HTTPS 5986 typical) |
| `client-ubuntu` | [`ubuntu/`](ubuntu/) | SSH + apt |
| `raspberrypi` | [`raspberrypi/`](raspberrypi/) | SSH + apt (same behavior as client-ubuntu) |

```bash
node tools/hdc/cli.mjs run client windows query --
node tools/hdc/cli.mjs run client client-ubuntu maintain -- --host-id ws-example
node tools/hdc/cli.mjs run client raspberrypi maintain --
```

## Inventory

Manual systems with `automation_targets: ["client"]` under `inventory/manual/systems/`.

## Manual setup docs

- [WinRM](../../../docs/manually-deployed/client-winrm.md)
- [Wake-on-LAN](../../../docs/manually-deployed/client-wol.md)

## Related

- [AGENTS.md — Home clients](../../AGENTS.md)
- Schema: [`tools/hdc/schema/client.config.schema.json`](../../tools/hdc/schema/client.config.schema.json)
