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
HDC_VAULTWARDEN_URL=https://vault.example.invalid
HDC_VAULTWARDEN_EMAIL=you@example.com
HDC_VAULTWARDEN_ORGANIZATION_ID=<uuid>   # optional when org name resolves (default: HDC)
HDC_VAULTWARDEN_COLLECTION_ID=<uuid>     # required
```

**Alternative (API key login):** omit `HDC_VAULTWARDEN_EMAIL` and set a personal API key instead (Account Settings → Security → Keys in the Vaultwarden web UI):

```env
HDC_VAULTWARDEN_URL=https://vault.example.invalid
HDC_VAULTWARDEN_KEY_CLIENT_ID=user.xxxxx-xxxx-xxxx
HDC_VAULTWARDEN_KEY_CLIENT_SECRET=xxxxxxxxxxxxxx
HDC_VAULTWARDEN_COLLECTION_ID=<uuid>
```

Store the key values in the local hdc vault (recommended) or `.env`:

```powershell
hdc secrets set HDC_VAULTWARDEN_KEY_CLIENT_ID
hdc secrets set HDC_VAULTWARDEN_KEY_CLIENT_SECRET
```

API key login replaces email+password for `bw login` only. **`HDC_VAULTWARDEN_MASTER_PASSWORD` is still required** for `bw unlock` (vault decryption).

Resolve IDs after `secrets unlock`:

```powershell
bw list organizations
bw list org-collections --organizationid <orgId>
```

Set `HDC_VAULTWARDEN_ORGANIZATION_NAME=HDC` (default) to auto-resolve the organization when `HDC_VAULTWARDEN_ORGANIZATION_ID` is unset.

Both `https://vault.example.invalid` and `https://vault.home.example.invalid` reach the same Vaultwarden instance; prefer `vault.example.invalid` for new setups.

| Mode | Behavior |
| --- | --- |
| `auto` (default) | Use Vaultwarden when URL + (email or API key pair) are set; fall back to local vault if `bw` or server is unavailable |
| `vaultwarden` | Require Vaultwarden; fail if unlock fails |
| `local` | Only `~/.hdc/vault.enc` (legacy behavior) |

## First-time Vaultwarden setup

After [Vaultwarden is deployed](../../clumps/services/vaultwarden/README.md):

1. Open `https://vault.example.invalid/admin` and create your account (or use an invitation).
2. Point `bw` at your server:

   ```powershell
   bw config server https://vault.example.invalid
   ```

3. Run any hdc command that needs secrets, or:

   ```powershell
   hdc secrets unlock
   ```

4. Enter your **Vaultwarden master password** when prompted. hdc offers to save it as `HDC_VAULTWARDEN_MASTER_PASSWORD` in the **local** hdc vault (bootstrap only).

## How secrets map to Vaultwarden

- Each hdc secret is a **Login** item in the **HDC organization** (collection from `HDC_VAULTWARDEN_COLLECTION_ID`).
- The **item name** must equal the env key exactly, e.g. `HDC_PROXMOX_API_TOKEN`.
- The **password** field holds the secret value (username is set to the same key name for consistency).
- **Website URLs** (`login.uris[]`) point at HDC service UIs when applicable (public hostnames, nginx-waf aliases, and LAN `http://10.x:port` routes). Infra-only API keys (Cloudflare, AWS, SSH passwords, webhooks, …) intentionally have no website. Sync from clump configs:

```powershell
hdc secrets sync-uris -- --dry-run
hdc secrets sync-uris --
```

`secrets set` and `secrets push` also attach URIs when hdc can derive a URL for the key. Re-run `secrets sync-uris` after nginx-waf or service URL changes.

Migrate existing local vault secrets in one step:

```powershell
hdc secrets push -- --dry-run
hdc secrets push -- --force
```

`--force` overwrites organization items; default `--skip-existing` is safe for re-runs. Bootstrap keys are never pushed.

Store a secret:

```powershell
hdc secrets set HDC_PROXMOX_API_TOKEN
```

List keys:

```powershell
hdc secrets list
```

Export values to files (requires unlock; plaintext on disk — use a directory outside the repo):

```powershell
hdc secrets get HDC_PROXMOX_API_TOKEN --out $env:USERPROFILE\.hdc\export\HDC_PROXMOX_API_TOKEN
hdc secrets dump --out-dir $env:USERPROFILE\.hdc\export
hdc secrets dump --out-dir $env:USERPROFILE\.hdc\export --format env
```

`dump` omits local bootstrap keys unless you pass `--include-bootstrap`. See `hdc help secrets dump`.

## Bootstrap keys (local hdc vault only)

These never sync to Vaultwarden:

| Key | Purpose |
| --- | --- |
| `HDC_VAULTWARDEN_MASTER_PASSWORD` | Optional stored master password for non-interactive unlock |
| `HDC_VAULTWARDEN_KEY_CLIENT_ID` | Personal API key client id for `bw login --apikey` (bootstrap; local vault only) |
| `HDC_VAULTWARDEN_KEY_CLIENT_SECRET` | Personal API key client secret for `bw login --apikey` (bootstrap; local vault only) |
| `HDC_VAULTWARDEN_ADMIN_TOKEN` | Plain Vaultwarden **admin panel** password (hdc hashes to Argon2 for `ADMIN_TOKEN` on deploy/maintain) |

The local vault passphrase (`HDC_VAULT_PASSPHRASE` / `secrets init`) still protects `~/.hdc/vault.enc` when reading bootstrap keys.

## Performance

hdc minimizes Bitwarden CLI overhead:

- **Bulk reads** — `readSecrets` / `secrets dump` load the HDC collection with one `bw list items` call and parse decrypted passwords from the response (no per-item `get password` when the list payload includes them).
- **Session reuse** — After unlock, the `BW_SESSION` is cached for the hdc process and passed to spawned clump scripts (`hdc run`, `maintain daily`) so child processes skip login/unlock when the session is still valid.
- **In-process cache** — Repeated `getSecret` calls for the same key in one command reuse the cached value.

Operator tips for faster runs:

- Store **`HDC_VAULTWARDEN_MASTER_PASSWORD`** in the local hdc vault (via `secrets unlock`) so unlock is non-interactive.
- Prefer the **native `bw.exe`** over npm `@bitwarden/cli` when possible (`HDC_BW_EXECUTABLE` if needed).
- Put frequently used secrets in **clump `.env`** (hdc-private) when acceptable — hdc reads env vars before calling `bw`.
- Use **`HDC_SECRET_BACKEND=local`** on dev machines that do not need Vaultwarden.

## hdc-agents scheduled host

The [`hdc-agents`](../../clumps/services/hdc-agents/) service guest installs `bw` as needed and receives Vaultwarden secrets under `/opt/hdc-agents-meta/.env` during `maintain` (sourced from the operator local vault). Cron / schedule jobs run as the `hdc` user with `HDC_SECRET_BACKEND=vaultwarden`. See [`clumps/services/hdc-agents/`](../../clumps/services/hdc-agents/) and [`apps/hdc-web-server/`](../../apps/hdc-web-server/).

## Troubleshooting

- **`bw not found`** — Install CLI or set `HDC_BW_EXECUTABLE`. On Windows, npm installs `@bitwarden/cli` as a PowerShell/cmd shim; hdc invokes `node …/bw.js` directly so `shell: false` spawn works.
- **Unlock fails** — Verify URL, email, and master password; run `bw config server …` and `bw login` manually once.
- **`bw login` returns `{"statusCode":404}`** — Bitwarden CLI 2026.x calls `POST /identity/accounts/prelogin/password`, which requires **Vaultwarden ≥ 1.36.0**. Upgrade with `hdc run service vaultwarden maintain --` (bump `vaultwarden.image_tag` in config first if pinned below 1.36.0).
- **Item not found** — Create with `secrets set <ENV_NAME>`; name must match exactly.
