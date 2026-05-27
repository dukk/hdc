# WinRM for Windows home clients

`hdc run client windows maintain|query` uses **local PowerShell** on the operator PC to run `Invoke-Command` against each Windows host.

## Automatic WinRM bootstrap (PsExec)

When HTTPS WinRM (default port **5986**) is not accepting connections, hdc can enable WinRM on the target using [Sysinternals PsExec](https://learn.microsoft.com/en-us/sysinternals/downloads/psexec). This runs **before** query/maintain when:

- `winrm_bootstrap.enabled` is true in [`packages/clients/config.json`](../../packages/clients/config.json) (default), and
- you did not pass `--no-winrm-bootstrap`.

**Operator requirements:**

- Run hdc from **Windows** on a machine where your logon is in the **local Administrators** group on each target PC (PsExec uses your current Windows credentials; no extra password for bootstrap).
- Install PsExec and either add it to `PATH`, set `HDC_PSEXEC_PATH` in `.env`, or set `winrm_bootstrap.psexec_path` in client config.
- Remote PC must be reachable for PsExec (typically file sharing / admin$ on the LAN; same constraints as manual remote admin).

Bootstrap configures the WinRM service, `Enable-PSRemoting`, an **HTTPS listener on 5986**, and a firewall rule. Home-lab configs usually set `winrm.skip_ca_check: true` for the self-signed cert.

**WinRM sessions** still use `HDC_WINRM_USER` and vault `HDC_WINRM_PASSWORD_<SUFFIX>` — separate from PsExec auth.

## Manual setup (optional)

You can still configure WinRM by hand and disable auto-bootstrap (`winrm_bootstrap.enabled: false` or `--no-winrm-bootstrap`).

1. Enable **WinRM** and an HTTPS listener (port **5986** is the default in HDC config).
2. Allow the listener through Windows Firewall.
3. Create or use an account in the local Administrators group (or another account granted remote management rights).
4. For home-lab self-signed certs, set `winrm.skip_ca_check: true` in config (understand the MITM risk).

## Operator machine

- Run hdc from **Windows** (WinRM remoting is spawned via `powershell.exe` on the operator host).
- Store the remoting password in the vault, e.g. `node tools/hdc/cli.mjs secrets set HDC_WINRM_PASSWORD_PC_EXAMPLE`.
- Set `HDC_WINRM_USER` in `.env` (username only).

## Windows Update (maintain)

Maintain expects the **PSWindowsUpdate** PowerShell module on the target. Install once on the PC:

```powershell
Install-Module PSWindowsUpdate -Force
```

Without it, maintain reports a clear error and skips package installation.
