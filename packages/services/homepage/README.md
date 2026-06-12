# Homepage (`homepage`)

Self-hosted [gethomepage.dev](https://gethomepage.dev/) dashboard on Proxmox LXC (Docker Compose). Service tiles and layout are defined in native YAML under `homepage/` and pushed to the container on deploy/maintain.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` — set `homepage.allowed_hosts[]`, `homepage.public_url`, `homepage.config_files`, `proxmox.host_id`, `proxmox.lxc.vmid`, static `ip_config`
- **Dashboard YAML:** copy `homepage/*.example.yaml` → `homepage/*.yaml` in hdc-private (paths relative to package root)
- **Inventory:** `inventory/manual/systems/homepage-a.json`; `inventory/manual/services/homepage.json`
- **nginx-waf (optional):** internal HTTPS at `https://hdc.dukk.org` with `internal_only` access policy
- **DNS:** BIND A `homepage-a`; apex `@` → nginx-waf-a for HTTPS entry

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + Docker Homepage (`ghcr.io/gethomepage/homepage`) |
| `maintain` | Re-push YAML config + `.env`; `docker compose pull` + `up -d`; guest Linux baseline |
| `query` | Config summary; `--live` for HTTP probe |
| `teardown` | Optional compose down, destroy LXC |

```bash
node tools/hdc/cli.mjs run service homepage deploy -- --instance a
node tools/hdc/cli.mjs run service homepage query -- --live
node tools/hdc/cli.mjs run service homepage maintain --
```

## Common flags

`--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-upgrade` (maintain), `--skip-clamav` (maintain), `--live` (query), `--skip-compose-down`, `--dry-run`, `--yes` (teardown).

## Config

- `homepage.config_files` — paths relative to `packages/services/homepage/` (`services`, `settings`, `bookmarks`, optional `widgets` YAML). hdc checks the public repo first, then hdc-private.
- `homepage.allowed_hosts[]` — required for `HOMEPAGE_ALLOWED_HOSTS` (comma-separated in container env)
- `homepage.public_url` — optional HTTPS URL shown in reports (e.g. `https://hdc.dukk.org`)

Edit `homepage/services.yaml` (and optional `settings.yaml` / `bookmarks.yaml` / `widgets.yaml`) in hdc-private and run `maintain` to refresh the dashboard. Use native gethomepage keys (`siteMonitor`, `disableIndexing`, etc.) — see [Homepage docs](https://gethomepage.dev/configs/services/). Header info bars (CPU, memory, disk, search, datetime) live in `widgets.yaml` — see [info widgets](https://gethomepage.dev/widgets/info/datetime/).

Trivy and WireGuard have no browser UI in this deployment; omit them from the dashboard or link only via `siteMonitor` if you add a health endpoint.

Non-HTTP services (BIND, databases, mail relays, etc.) do not answer HTTP — `siteMonitor` will always show a red dot. Use `ping` with the service IP for the Homepage status indicator (ICMP host reachability). Services with no web UI (step-ca) or HTTPS to a bare IP with a hostname certificate (step-ca, Wazuh, Greenbone, Proxmox) also fail `siteMonitor` from the Homepage container; use `ping` there too and rely on Proxmox widgets or Gatus for service-level checks. For actual service-port health and alerting, add Gatus endpoints (for example `tcp://10.0.0.2:53` for BIND, `https://10.0.0.190/health` with `client.insecure` for step-ca) in [`packages/services/gatus/config.json`](../gatus/config.example.json).

## Custom icons

Most tiles use [dashboard-icons](https://github.com/homarr-labs/dashboard-icons) names (kebab-case, optional `.png` suffix). Examples: `draw-io.png`, `isc-bind9.png`, `immich.png`.

Services without a dashboard-icons entry can use vendored PNGs under `homepage/icons/` (public hdc repo). Reference them in `services.yaml` as `/icons/<name>.png`. hdc syncs that directory to the guest on deploy/maintain and mounts it at `/app/public/icons` in the Homepage container.

Run `homepage maintain` after adding or changing icons. See `homepage/icons/README.md` for upstream sources.

## Proxmox widget

Read-only hypervisor metrics use a dedicated Proxmox service account (not the hdc operator token). The account needs **PVEAuditor** on `/` for both the **user** and the **API token** (privilege separation enabled); hdc `proxmox maintain` ensures both.

1. Add `provision.service_accounts[]` with `id: homepage` in [`packages/infrastructure/proxmox/config.json`](../../infrastructure/proxmox/config.example.json) (see proxmox README).
2. Enable `homepage.proxmox_widget` in homepage config (`service_account_id`, `hosts[]`).
3. Add `widget:` blocks to `homepage/services.yaml` using `{{HOMEPAGE_VAR_PROXMOX_*}}` placeholders.
4. Run `proxmox maintain` (or `homepage maintain`, which ensures the account first), then `homepage maintain` to push `.env` into the CT.

Vault: `HDC_HOMEPAGE_PROXMOX_API_TOKEN`, `HDC_PROXMOX_USER_HOMEPAGE_PASSWORD` (auto-generated).

Put Proxmox tiles in a dedicated **Virtualization** group in `services.yaml` (not mixed into Infrastructure). Use a **cluster overview** tile without `node` for aggregate VM/LXC counts and CPU/memory; add per-node tiles with `node: pve-*` for single-node metrics. Set `showStats: true` on tiles (or globally in `settings.yaml`) so widget stats are expanded by default. Example layout in `settings.yaml`:

```yaml
showStats: true
layout:
  Virtualization:
    style: row
    columns: 3
    icon: proxmox.png
```

See `homepage/services.example.yaml` for the cluster + node widget pattern.

## Pi-hole widget

DNS query stats for Pi-hole instances use the admin password from [`packages/services/pi-hole/config.json`](../pi-hole/config.example.json) `defaults.pihole.webpassword` (injected at maintain time, not stored in `services.yaml`).

1. Enable `homepage.pihole_widget` in homepage config (`version`, optional `instances[]`).
2. Add `widget:` blocks to `homepage/services.yaml` using `{{HOMEPAGE_VAR_PIHOLE_*}}` placeholders.
3. Run `homepage maintain` to push `.env` into the CT.

Widget `url` must be the Pi-hole base URL (LAN IP, no `/admin`). Set `version: 6` when running Pi-hole v6+.

## After deploy

1. **CT IP:** from deploy/query `upstream_url` (e.g. `http://10.0.0.49:3000`).
2. **Inventory:** set `access.nodes[0].ip` on `homepage-a.json`.
3. **BIND:** A `homepage-a`; A `@` → nginx-waf-a for apex HTTPS.
4. **nginx-waf:** site `hdc-homepage` upstream to CT IP; `internal_only` on `/`; `websocket: true`.
5. **Browse:** `http://10.0.0.49:3000` or `https://hdc.dukk.org` from LAN.

## Related

- Schema: [`tools/hdc/schema/homepage.config.schema.json`](../../../tools/hdc/schema/homepage.config.schema.json)
- [Homepage docs](https://gethomepage.dev/installation/)
