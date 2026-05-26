# Bitwarden CLI for hdc secrets

hdc can store automation secrets in **Vaultwarden** (Bitwarden-compatible) instead of only the local encrypted file at `~/.hdc/vault.enc`. The integration uses the official **[Bitwarden CLI](https://bitwarden.com/help/cli/)** (`bw`), which handles Vaultwarden login, unlock, and client-side decryption.

## Install (Windows)

1. Download the CLI from [bitwarden.com/help/cli](https://bitwarden.com/help/cli/) or install via package manager if you use one.
2. Confirm it is on `PATH`:

   ```powershell
   bw --version
   ```

3. If `bw` is not on `PATH`, set in repo `.env`:

   ```env
   HDC_BW_EXECUTABLE=C:/path/to/bw.exe
   ```

## Configure hdc

In repo `.env` (see [`.env.example`](../../.env.example)):

```env
HDC_SECRET_BACKEND=auto
HDC_VAULTWARDEN_URL=https://vault.hdc.dukk.org
HDC_VAULTWARDEN_EMAIL=you@example.com
```

| Mode | Behavior |
| --- | --- |
| `auto` (default) | Use Vaultwarden when URL + email are set; fall back to local vault if `bw` or server is unavailable |
| `vaultwarden` | Require Vaultwarden; fail if unlock fails |
| `local` | Only `~/.hdc/vault.enc` (legacy behavior) |

## First-time Vaultwarden setup

After [Vaultwarden is deployed](../../packages/services/vaultwarden/README.md):

1. Open `https://vault.hdc.dukk.org/admin` and create your account (or use an invitation).
2. Point `bw` at your server:

   ```powershell
   bw config server https://vault.hdc.dukk.org
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

## Bootstrap keys (local hdc vault only)

These never sync to Vaultwarden:

| Key | Purpose |
| --- | --- |
| `HDC_VAULTWARDEN_MASTER_PASSWORD` | Optional stored master password for non-interactive unlock |
| `HDC_VAULTWARDEN_ADMIN_TOKEN` | Vaultwarden admin panel (deploy/maintain) |

The local vault passphrase (`HDC_VAULT_PASSPHRASE` / `secrets init`) still protects `~/.hdc/vault.enc` when reading bootstrap keys.

## Troubleshooting

- **`bw not found`** — Install CLI or set `HDC_BW_EXECUTABLE`.
- **Unlock fails** — Verify URL, email, and master password; run `bw config server …` and `bw login` manually once.
- **Item not found** — Create with `secrets set <ENV_NAME>`; name must match exactly.
