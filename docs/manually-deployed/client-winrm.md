# WinRM for Windows home clients

`hdc run client windows maintain|query` uses **local PowerShell** on the operator PC to run `Invoke-Command` against each Windows host.

## On each Windows PC

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
