# Cloudflare DNS (hdc)

Public DNS zones are managed with the **cloudflare** infrastructure package (`packages/infrastructure/cloudflare/`). Internal zones remain on BIND (`packages/services/bind/`).

## API token

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens), create a **Custom token**.
2. Permissions (minimum):
   - **Zone** → **DNS** → **Edit**
   - **Zone** → **Zone** → **Read**
3. Zone resources: **All zones** (or include only zones you will manage).
4. Store the token in the hdc vault (never commit):

```bash
node tools/hdc/cli.mjs secrets set HDC_CLOUDFLARE_API_TOKEN
```

Do **not** use the Global API Key.

## Optional account id

If zone listing returns an empty set with a valid token, set your account id in `.env`:

```bash
# HDC_CLOUDFLARE_ACCOUNT_ID=your-account-id
```

Or set `cloudflare.account_id` in `packages/infrastructure/cloudflare/config.json`.

## Config

Copy `packages/infrastructure/cloudflare/config.example.json` to **hdc-private** as `config.json` (same path). Define `zones[]` only for zones hdc should **apply** records to. Other zones in the account appear as **unmanaged** in `query`.

## Commands

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare query --
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --dry-run
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --zone dukk.org
```

Use `--prune` only when you intend to **delete** live records that are not listed in config for a managed zone.

## Registrar migration

When ready to use Cloudflare as authoritative DNS for a public zone, update NS at your registrar to Cloudflare’s assigned nameservers. BIND apex zones (e.g. `dukk.org` with internal NS glue) can be narrowed or removed separately.
