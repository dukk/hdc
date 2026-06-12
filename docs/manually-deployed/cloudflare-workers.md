# Cloudflare Workers and Pages (hdc)

Workers scripts and Pages projects (including Pages Functions) are deployed with the **cloudflare-workers** infrastructure package (`packages/infrastructure/cloudflare-workers/`). Public DNS remains in the separate **cloudflare** package.

## Prerequisites

### Wrangler

Install Wrangler v4+ globally or per project:

```bash
npm install -g wrangler
wrangler --version
```

### API token

Reuse the same token as DNS sync (`HDC_CLOUDFLARE_API_TOKEN`). Extend permissions:

| Permission | Access |
| --- | --- |
| Account → Workers Scripts | Edit |
| Account → Workers Routes | Edit |
| Account → Cloudflare Pages | Edit |

Store in vault:

```bash
node tools/hdc/cli.mjs secrets set HDC_CLOUDFLARE_API_TOKEN
```

### Account id

Required for Workers/Pages API calls:

```bash
# HDC_CLOUDFLARE_ACCOUNT_ID=your-account-id
```

Or set `cloudflare_workers.account_id` in `packages/infrastructure/cloudflare-workers/config.json`.

## Project layout (hdc-private)

```
packages/infrastructure/cloudflare-workers/
  config.json
  workers/<id>/
    wrangler.jsonc
    package.json
    src/index.ts
  pages/<id>/
    package.json
    functions/
    dist/
```

Copy `packages/infrastructure/cloudflare-workers/config.example.json` to hdc-private as `config.json`.

## Bootstrap from live API

Import script names, routes, and Pages project names (not source code):

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare-workers query -- --import --yes
```

After import, create `workers/<id>/` and `pages/<id>/` trees with wrangler config and source, then deploy.

## Commands

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare-workers query --
node tools/hdc/cli.mjs run infrastructure cloudflare-workers deploy -- --dry-run
node tools/hdc/cli.mjs run infrastructure cloudflare-workers deploy -- --worker waitlist-mailer
node tools/hdc/cli.mjs run infrastructure cloudflare-workers maintain --
node tools/hdc/cli.mjs run infrastructure cloudflare-workers maintain -- --redeploy
node tools/hdc/cli.mjs run infrastructure cloudflare-workers teardown -- --worker example-worker --yes
```

## Secrets

Declare Worker secrets in config `workers[].secrets[]` with `vault_key` names. Deploy and maintain push values via the Cloudflare API (values are never logged). Set vault keys before deploy:

```bash
node tools/hdc/cli.mjs secrets set HDC_WAITLIST_API_KEY
```

## Daily maintain

`hdc maintain daily` runs **query only** on this package (drift check, no deploy).
