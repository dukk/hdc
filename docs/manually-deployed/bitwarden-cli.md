# Bitwarden CLI for hdc secrets

hdc can store automation secrets in **Vaultwarden** (Bitwarden-compatible) instead of only the local encrypted file at `~/.hdc/vault.enc`. The integration uses the official **[Bitwarden CLI](https://bitwarden.com/help/cli/)** (`bw`), which handles Vaultwarden login, unlock, and client-side decryption.

## Install (Windows)

1. Download the CLI from [bitwarden.com/help/cli](https://bitwarden.com/help/cli/) or install via package manager if you use one.
2. Confirm it is on `PATH`:

   ```powershell
   bw --version
   ```

3. If `bw` is not on `PATH`, set in repo `.env` only when you have a real binary (not an npm `.cmd` shim on Windows — hdc auto-detects `@bitwarden/cli`):

   ```env
   HDC_BW_EXECUTABLE=C:/path/to/bw.exe
   ```

## Configure hdc

In repo `.env` (see [`.env.example`](../../.env.example)):

```env
HDC_SECRET_BACKEND=auto
HDC_VAULTWARDEN_URL=https://vault.dukk.org
HDC_VAULTWARDEN_EMAIL=you@example.com
```

Both `https://vault.dukk.org` and `https://vault.hdc.dukk.org` reach the same Vaultwarden instance; prefer `vault.dukk.org` for new setups.

| Mode | Behavior |
| --- | --- |
| `auto` (default) | Use Vaultwarden when URL + email are set; fall back to local vault if `bw` or server is unavailable |
| `vaultwarden` | Require Vaultwarden; fail if unlock fails |
| `local` | Only `~/.hdc/vault.enc` (legacy behavior) |

## First-time Vaultwarden setup

After [Vaultwarden is deployed](../../packages/services/vaultwarden/README.md):

1. Open `https://vault.dukk.org/admin` and create your account (or use an invitation).
2. Point `bw` at your server:

   ```powershell
   bw config server https://vault.dukk.org
   ```

3. Run any hdc command that needs secrets, or:

   ```powershell
   node tools/hdc/cli.mjs secrets unlock
   ```

4. Enter your **Vaultwarden master password** when prompted. hdc offers to save it as `HDC_VAULTWARDEN_MASTER_PASSWORD` in the **local** hdc vault (bootstrap only).

## How secrets map to Vaultwarden

- Each hdc secret is a **Login** item in Vaultwarden.
- The **item name** must equal the env key exactly, e.g. `HDC_PROXMOX_API_TOKEN`.
- The **password** field holds the secret value (username is set to the same key name for consistency).

Store a secret:

```powershell
node tools/hdc/cli.mjs secrets set HDC_PROXMOX_API_TOKEN
```

List keys:

```powershell
node tools/hdc/cli.mjs secrets list
```

Export values to files (requires unlock; plaintext on disk — use a directory outside the repo):

```powershell
node tools/hdc/cli.mjs secrets get HDC_PROXMOX_API_TOKEN --out $env:USERPROFILE\.hdc\export\HDC_PROXMOX_API_TOKEN
node tools/hdc/cli.mjs secrets dump --out-dir $env:USERPROFILE\.hdc\export
node tools/hdc/cli.mjs secrets dump --out-dir $env:USERPROFILE\.hdc\export --format env
```

`dump` omits local bootstrap keys unless you pass `--include-bootstrap`. See `node tools/hdc/cli.mjs help secrets dump`.

## Bootstrap keys (local hdc vault only)

These never sync to Vaultwarden:

| Key | Purpose |
| --- | --- |
| `HDC_VAULTWARDEN_MASTER_PASSWORD` | Optional stored master password for non-interactive unlock |
| `HDC_VAULTWARDEN_ADMIN_TOKEN` | Plain Vaultwarden **admin panel** password (hdc hashes to Argon2 for `ADMIN_TOKEN` on deploy/maintain) |

The local vault passphrase (`HDC_VAULT_PASSPHRASE` / `secrets init`) still protects `~/.hdc/vault.enc` when reading bootstrap keys.

## hdc-runner scheduled host

The [`hdc-runner`](../packages/services/hdc-runner/) service installs `bw` on the automation guest and receives `HDC_VAULTWARDEN_MASTER_PASSWORD` in `/opt/hdc-runner/.env` during `maintain` (sourced from the operator local vault). Cron jobs run as the `hdc` user with `HDC_SECRET_BACKEND=vaultwarden`. See [`packages/services/hdc-runner/README.md`](../packages/services/hdc-runner/README.md).

## Troubleshooting

- **`bw not found`** — Install CLI or set `HDC_BW_EXECUTABLE`. On Windows, npm installs `@bitwarden/cli` as a PowerShell/cmd shim; hdc invokes `node …/bw.js` directly so `shell: false` spawn works.
- **Unlock fails** — Verify URL, email, and master password; run `bw config server …` and `bw login` manually once.
- **`bw login` returns `{"statusCode":404}`** — Bitwarden CLI 2026.x calls `POST /identity/accounts/prelogin/password`, which requires **Vaultwarden ≥ 1.36.0**. Upgrade with `node tools/hdc/cli.mjs run service vaultwarden maintain --` (bump `vaultwarden.image_tag` in config first if pinned below 1.36.0).
- **Item not found** — Create with `secrets set <ENV_NAME>`; name must match exactly.
