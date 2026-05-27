# Cloudflare (hdc)

Public DNS zones, Page Rules, and Email Routing rules are managed with the **cloudflare** infrastructure package (`packages/infrastructure/cloudflare/`). Internal zones remain on BIND (`packages/services/bind/`).

## API token

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens), create a **Custom token**.
2. Permissions (minimum for full sync):
   - **Zone** → **DNS** → **Edit**
   - **Zone** → **Zone** → **Read**
   - **Zone** → **Page Rules** → **Edit**
   - **Zone** → **Email Routing Rules** → **Edit**
3. Zone resources: **All zones** (or include only zones you will manage).
4. Store the token in the hdc vault (never commit):

```bash
node tools/hdc/cli.mjs secrets set HDC_CLOUDFLARE_API_TOKEN
```

Or set `HDC_CLOUDFLARE_API_TOKEN` in repo `.env` (takes precedence over vault when set).

Do **not** use the Global API Key.

## Optional account id

If zone listing returns an empty set with a valid token, set your account id in `.env`:

```bash
# HDC_CLOUDFLARE_ACCOUNT_ID=your-account-id
```

Or set `cloudflare.account_id` in `packages/infrastructure/cloudflare/config.json`.

## Config

Copy `packages/infrastructure/cloudflare/config.example.json` to **hdc-private** as `config.json` (same path).

## Bootstrap from live API

Import all zones matching `cloudflare.zone_filter` into hdc-private `config.json` (DNS only):

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare query -- --import-zones --yes
```

Merge page rules or email routing into zones already listed in config:

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare query -- --import-page-rules --yes
node tools/hdc/cli.mjs run infrastructure cloudflare query -- --import-email-routing --yes
```

Preview zones and records without writing:

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare query --
```

Inspect `discovered_zones[]` and per-zone diffs in the JSON on stdout.

## Commands

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare query --
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --dry-run
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --zone dukk.org
```

Use `--prune` only when you intend to **delete** live records or rules that are not listed in config for a managed zone key.

Use `--skip-page-rules` or `--skip-email-routing` on maintain for DNS-only runs.

## Page Rules and Email Routing

- **Page Rules** use the legacy Cloudflare API (`/zones/{id}/pagerules`). Cloudflare may block creating new Page Rules on some accounts; import and update existing rules first.
- **Email routing** syncs explicit rules and optional `email_routing.catch_all`. Forward actions require destination addresses verified under Cloudflare Email Routing (account settings). hdc does not auto-enable Email Routing DNS (`POST /email/routing/dns`) — keep MX/TXT in `records[]` declaratively if needed.

## Registrar migration

When ready to use Cloudflare as authoritative DNS for a public zone, update NS at your registrar to Cloudflare’s assigned nameservers. BIND apex zones (e.g. `dukk.org` with internal NS glue) can be narrowed or removed separately.
