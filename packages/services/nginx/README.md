# Nginx web hosting (`nginx`)

Reverse proxy and static hosting with Let's Encrypt. Optional Proxmox QEMU provision or configure-only on existing SSH hosts.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (`sites[]`)
- **Inventory:** [`inventory/manual/systems/vm-nginx-a.json`](../../../inventory/manual/systems/vm-nginx-a.json); [`inventory/manual/services/nginx.json`](../../../inventory/manual/services/nginx.json)
- **Vault:** `HDC_NGINX_LE_EMAIL` (required); `HDC_BIND_TSIG_KEY` when `letsencrypt.challenge` is `dns-01`

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | Provision VM (optional) + nginx + certbot; push `sites[]` |
| `maintain` | Re-push sites; `--renew-certs`; `--site <id>` |
| `query` | nginx status, config test, upstream probes, cert expiry |

```bash
node tools/hdc/cli.mjs run service nginx deploy -- --instance a
node tools/hdc/cli.mjs run service nginx maintain --
```

## Common flags

`--instance a`, `--destroy-existing`, `--skip-provision`, `--renew-certs`, `--site <id>`, `--dry-run`, `--skip-clamav`.

## After deploy

1. **Access:** open each site by `server_name` / URL in `sites[]` (HTTPS after cert issuance).
2. **Example:** if a site proxies to an app, browse `https://<hostname-from-config>`.
3. No single fixed port in config — depends on `listen` in each site block (typically 80/443 on the VM IP).

## Related

- [AGENTS.md — Nginx](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/nginx.config.schema.json`](../../../tools/hdc/schema/nginx.config.schema.json)
