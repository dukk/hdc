# Home Windows clients (`windows`)

Disk usage and Windows Update maintenance for PCs listed in [`config.json`](config.json), via WinRM. Can send Wake-on-LAN when a host is offline.

## Prerequisites

- **Config:** [`config.json`](config.json) from [`config.example.json`](config.example.json).
- **Inventory:** `inventory/manual/systems/*.json` with `automation_targets: ["client"]` and `access.nodes[].winrm`.
- **Vault:** `HDC_WINRM_USER_PASSWORD` (shared); optional per-host `HDC_WINRM_PASSWORD_<SUFFIX>` via `winrm_password_vault_suffix`.
- **Env:** `HDC_WINRM_USER` — for Microsoft accounts (MSA) use `MicrosoftAccount\you@outlook.com`; mixed deployments can set `auth.winrm_user` or `auth.winrm_user_env` per host (see [client-winrm.md](../../../docs/manually-deployed/client-winrm.md)).
- **WinRM:** auto-enabled via PsExec when port 5986 is closed (see [client-winrm.md](../../../docs/manually-deployed/client-winrm.md)); or configure manually.
- **PsExec:** Sysinternals [PsExec](https://learn.microsoft.com/en-us/sysinternals/downloads/psexec) on the operator PC (`PATH`, `HDC_PSEXEC_PATH`, or `winrm_bootstrap.psexec_path`).

## Commands

| Verb | Purpose |
|------|---------|
| `maintain` | Disk report + updates (PSWindowsUpdate); optional reboot |
| `query` | Disk + pending update count |

```bash
node tools/hdc/cli.mjs run client windows query --
node tools/hdc/cli.mjs run client windows maintain -- --host-id pc-example
node tools/hdc/cli.mjs help run client windows
```

## Common flags

`--host-id <id>`, `--dry-run`, `--skip-updates`, `--reboot`, `--no-wol`, `--no-winrm-bootstrap`, `--no-report`, `--report <path>`.

WoL settings: `wol` in this package config ([`client-wol.md`](../../../docs/manually-deployed/client-wol.md)).

## After deploy / Using the service

No hdc deploy step. Use the PC normally; run `maintain` on a schedule or after patches.

1. Target must be reachable on WinRM (typical `https://<ip>:5986`). If not, hdc bootstraps WinRM via PsExec when enabled (operator admin on the PC).
2. `query` returns JSON on stdout for scripting.
3. `--reboot` only on `maintain` when you accept a restart.

## Related

- [Clients overview](../README.md)
- [AGENTS.md — Home clients](../../../AGENTS.md)
