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
| `maintain` | Re-push CRS and sites; `--renew-certs`; `--sync-certs`; `--site <id>` |
| `query` | nginx, ModSecurity, CRS rule count, certs, upstream probes |

```bash
node tools/hdc/cli.mjs run service nginx-waf maintain --
node tools/hdc/cli.mjs run service nginx-waf query --
```

## Common flags

`--instance a|b`, `--destroy-existing`, `--skip-provision`, `--renew-certs`, `--sync-certs`, `--site <id>`, `--dry-run`.

## After deploy

1. Browse `https://<server-name-from-sites[]>` for each published site.
2. WAF logs: ModSecurity under `/var/log/nginx/` (on guest).
3. Use query output to confirm `SecRuleEngine` and cert expiry before go-live.

## Related

- [AGENTS.md — Nginx WAF](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/nginx-waf.config.schema.json`](../../../tools/hdc/schema/nginx-waf.config.schema.json)
