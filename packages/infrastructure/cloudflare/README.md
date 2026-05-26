# Cloudflare DNS (`cloudflare`)

Discover zones in your Cloudflare account and apply declarative DNS records from package config.

## Prerequisites

- **Config:** copy [`config.example.json`](config.example.json) to `config.json` in hdc-private (same path).
- **Vault:** `HDC_CLOUDFLARE_API_TOKEN` — API token with **Zone:Read** and **DNS:Edit**.
- **Optional env:** `HDC_CLOUDFLARE_ACCOUNT_ID` when listing zones requires an account filter.

See [`docs/manually-deployed/cloudflare.md`](../../../docs/manually-deployed/cloudflare.md) for token setup.

## Commands

| Verb | Purpose |
|------|---------|
| `query` | List account zones (after filter), unmanaged zones, and per-zone diff vs config (JSON on stdout) |
| `maintain` | Create/update (and optionally delete) DNS records for zones defined in config |

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare query --
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --dry-run
node tools/hdc/cli.mjs help run infrastructure cloudflare
```

## Config

- **`cloudflare.zone_filter`:** `all`, `include`, or `exclude` zone names (apex FQDN).
- **`zones[]`:** only zones listed here are **managed** (maintain applies records). Other account zones appear as `unmanaged` in query.
- **Records:** `type`, `name` (`@` for apex), `data`, optional `ttl`, `priority` (MX), `proxied` (A/AAAA/CNAME).

## Common flags

`--zone <name>`, `--dry-run`, `--prune` (delete live records not in config), `--no-report`, `--report <path>`.

## Related

- Internal authoritative DNS: [`packages/services/bind/`](../../services/bind/)
- [AGENTS.md](../../../AGENTS.md)
