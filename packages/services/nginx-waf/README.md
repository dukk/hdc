# Nginx WAF (`nginx-waf`)

Nginx with ModSecurity (OWASP CRS), reverse proxy `sites[]`, and Let's Encrypt with optional cert sync between HA nodes.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json`
- **Inventory:** [`inventory/manual/systems/vm-nginx-waf-a.json`](../../../inventory/manual/systems/vm-nginx-waf-a.json), [`vm-nginx-waf-b.json`](../../../inventory/manual/systems/vm-nginx-waf-b.json); [`inventory/manual/services/nginx-waf.json`](../../../inventory/manual/services/nginx-waf.json)
- **Vault:** `HDC_NGINX_WAF_LE_EMAIL` (required); `HDC_BIND_TSIG_KEY` for DNS-01 challenges

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | QEMU (optional) + nginx + ModSecurity + CRS; push sites; LE on cert-primary |
| `maintain` | Re-push CRS and sites; `--renew-certs`; `--sync-certs`; `--site <id>` (that site only; other vhosts unchanged) |
| `query` | nginx, ModSecurity, CRS rule count, certs, upstream probes |

```bash
node tools/hdc/cli.mjs run service nginx-waf maintain --
node tools/hdc/cli.mjs run service nginx-waf query --
```

## URL access by network source

Restrict specific URL paths so only clients on trusted networks reach the upstream; everyone else gets `401` or `404`.

**Global defaults** (`defaults.nginx_waf.trusted_cidrs`): RFC1918-style ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`). Override in `config.json` (e.g. `10.0.0.0/24` only).

**Per-site** (optional):

- `client_ip`: `remote_addr` (default) or `cloudflare` (uses `CF-Connecting-IP` + Cloudflare `set_real_ip_from` ranges on HTTPS).
- `trusted_cidrs`: replaces global list for that site when set.

**Per-location** `access` (only on paths you want restricted):

```json
{
  "path": "/api/",
  "proxy_headers": true,
  "access": { "policy": "internal_only", "deny_status": 404 }
}
```

- `path` uses nginx location syntax: prefix (`/api/`), exact (`= /health`), regex (`~ ^/admin`).
- Locations without `access` stay open to all clients.
- Put more specific paths before broader ones (same as normal nginx location order).

**Hairpin NAT:** LAN clients using the **public** hostname may not appear as `10.x` on the WAF. Use split-horizon DNS to the WAF internal IP, or add your gateway/router CIDR to `trusted_cidrs`.

Apply after editing: `node tools/hdc/cli.mjs run service nginx-waf maintain --` (all sites), or `maintain -- --site <id>` to update one site without touching other vhosts.

Run full `maintain` (no `--site`) after removing a site from `config.json` so stale `hdc-*.conf` files are pruned from the hosts.

## Common flags

`--instance a|b`, `--destroy-existing`, `--skip-provision`, `--renew-certs`, `--sync-certs`, `--site <id>` (partial update only), `--dry-run`.

## After deploy

1. Browse `https://<server-name-from-sites[]>` for each published site.
2. WAF logs: ModSecurity under `/var/log/nginx/` (on guest).
3. Use query output to confirm `SecRuleEngine` and cert expiry before go-live.

## Related

- [AGENTS.md — Nginx WAF](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/nginx-waf.config.schema.json`](../../../tools/hdc/schema/nginx-waf.config.schema.json)
