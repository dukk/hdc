# WinRM for Windows home clients

`hdc run client windows maintain|query` uses **local PowerShell** on the operator PC to run `Invoke-Command` against each Windows host.

## Account types (MSA, local, Entra)

WinRM sessions authenticate with **username + password** (`Authentication: Negotiate`). PsExec bootstrap uses a **separate** credential path (your current Windows logon). Pick the WinRM username format that matches each target PC.

| Account type | Typical WinRM username | Password |
| --- | --- | --- |
| **Microsoft account (MSA)** — “Sign in with Microsoft” on a workgroup PC | `MicrosoftAccount\you@outlook.com` | Microsoft account password |
| **Local** administrator | `.\username` or `COMPUTERNAME\username` | Local account password |
| **Entra ID / Azure AD** (work/school on workgroup or joined PC) | `AzureAD\you@company.com` (confirm with `whoami` on the PC) | Work account password |

**MSA (common home setup):** All PCs signed in with the same Microsoft account can share one global `HDC_WINRM_USER`. On each target, run `whoami` locally — if it shows `microsoftaccount\you@outlook.com`, use `MicrosoftAccount\you@outlook.com` in `.env` (domain segment is case-insensitive in practice).

**Mixed deployments:** When hosts use different account types or different MSAs:

- Set a **global default** in `.env` (`HDC_WINRM_USER`) for the majority case.
- Override per host with `auth.winrm_user` in [`packages/clients/windows/config.json`](../../packages/clients/windows/config.json), or point `auth.winrm_user_env` at a host-specific env var (e.g. `HDC_WINRM_USER_LAN_4`).
- Use a **different password** on one host via `auth.winrm_password_vault_suffix` → vault `HDC_WINRM_PASSWORD_<SUFFIX>`.

**Dedicated local admin (optional):** A local account in Administrators (e.g. `.\hdc-remote`) avoids MSA username quirks and Entra join restrictions; use `auth.winrm_user` on MSA hosts only when you keep the MSA for interactive login.

### Verify WinRM credentials manually

On the operator PC (adjust username, IP, and SSL flags to match config):

```powershell
$sec = Read-Host -AsSecureString
$cred = New-Object PSCredential('MicrosoftAccount\you@outlook.com', $sec)
Invoke-Command -ComputerName 192.0.2.10 -Port 5986 -UseSSL -Credential $cred `
  -Authentication Negotiate `
  -SessionOption (New-CimSessionOption -SkipCACheck -SkipCNCheck) `
  -ScriptBlock { hostname }
```

Use the same username string in `HDC_WINRM_USER` or `auth.winrm_user` once this succeeds.

## Automatic WinRM bootstrap (PsExec)

When HTTPS WinRM (default port **5986**) is not accepting connections, hdc can enable WinRM on the target using [Sysinternals PsExec](https://learn.microsoft.com/en-us/sysinternals/downloads/psexec). This runs **before** query/maintain when:

- `winrm_bootstrap.enabled` is true in [`packages/clients/windows/config.json`](../../packages/clients/windows/config.json) (default), and
- you did not pass `--no-winrm-bootstrap`.

**Operator requirements:**

- Run hdc from **Windows** on a machine where your logon is in the **local Administrators** group on each target PC (PsExec uses your current Windows credentials; no extra password for bootstrap).
- With **MSA** PCs: the operator session is usually the same Microsoft account that is admin on the targets — PsExec then works without storing that password for bootstrap. WinRM still needs `HDC_WINRM_USER` + vault password (see above).
- Install PsExec and either add it to `PATH`, set `HDC_PSEXEC_PATH` in `.env`, or set `winrm_bootstrap.psexec_path` in client config.
- Remote PC must be reachable for PsExec (typically file sharing / admin$ on the LAN; same constraints as manual remote admin).

Bootstrap configures the WinRM service, `Enable-PSRemoting`, an **HTTPS listener on 5986**, and a firewall rule. Home-lab configs usually set `winrm.skip_ca_check: true` for the self-signed cert.

**WinRM sessions** still use `HDC_WINRM_USER` (or per-host `auth.winrm_user` / `auth.winrm_user_env`) and vault `HDC_WINRM_USER_PASSWORD` (shared default) — separate from PsExec auth.

## Manual setup (optional)

You can still configure WinRM by hand and disable auto-bootstrap (`winrm_bootstrap.enabled: false` or `--no-winrm-bootstrap`).

1. Enable **WinRM** and an HTTPS listener (port **5986** is the default in HDC config).
2. Allow the listener through Windows Firewall.
3. Use an account in the local Administrators group (MSA, local, or Entra — see table above).
4. For home-lab self-signed certs, set `winrm.skip_ca_check: true` in config (understand the MITM risk).

## Operator machine

- Run hdc from **Windows** (WinRM remoting is spawned via `powershell.exe` on the operator host).
- Store the shared remoting password once: `node tools/hdc/cli.mjs secrets set HDC_WINRM_USER_PASSWORD`.
- Set `HDC_WINRM_USER` in `.env` (MSA example: `MicrosoftAccount\you@outlook.com`).
- Per-host password override only when needed: `auth.winrm_password_vault_suffix` → `secrets set HDC_WINRM_PASSWORD_<SUFFIX>`.

## Windows Update (maintain)

Maintain expects the **PSWindowsUpdate** PowerShell module on the target. Install once on the PC:

```powershell
Install-Module PSWindowsUpdate -Force
```

Without it, maintain reports a clear error and skips package installation.
