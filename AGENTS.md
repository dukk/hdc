# Home Data Center (HDC)

Automation and documentation for a manually deployed home data center. Agents operate and extend this repo via the **hdc** CLI and JSON inventory sidecars.

## Role

- Use structured facts from inventory and package configs — **do not invent** hostnames, IPs, bridges, VLANs, pool names, or credentials.
- Prefer tracked automation under `packages/` over one-off shell installs.
- Only create git commits when the user explicitly asks.

## Quick start

- **Node.js 18+** — the CLI uses built-in modules only; no `npm install` is required to run hdc.
- **Invoke hdc** (repo root):
  - Windows: `hdc.cmd <command>`
  - Cross-platform: `node tools/hdc/cli.mjs <command>`
  - macOS/Linux (after `chmod +x hdc`): `./hdc <command>`
- **Secrets:** copy [`.env.example`](.env.example) to `.env` (gitignored). API keys and passwords live in the encrypted vault at `~/.hdc/vault.enc` (see `secrets` commands below). Auth fields in inventory reference **env var names only**, never values.
- **hdc-private:** Clone the private repo beside hdc (`../hdc-private`) or set `HDC_PRIVATE_ROOT`. Package `config.json` and inventory JSON use the same paths; hdc checks the public repo first, then hdc-private. Seed package configs from examples: `node tools/hdc/scripts/bootstrap-hdc-private-configs.mjs` (skips existing files; `--force` to overwrite). Shared loaders: [`tools/hdc/lib/private-repo.mjs`](tools/hdc/lib/private-repo.mjs), [`tools/hdc/lib/package-config.mjs`](tools/hdc/lib/package-config.mjs).

### Package config JSONC (comments + includes)

Package `config.json` files (not inventory sidecars) support **JSONC** when loaded via [`loadPackageConfigFromPackageRoot`](tools/hdc/lib/package-config.mjs):

- **Comments:** `//` line comments and `/* block */` comments; trailing commas allowed.
- **Includes:** `{ "$hdc.include": "relative/path.json" }` or `{ "$hdc.include": { "file": "relative/path.json" } }`.
  - Paths resolve relative to the **including file’s directory** (public hdc first, then hdc-private).
  - In an **array**, an included JSON **object** inserts one element; an included **array** splices/flattens into the parent array.
  - An object with `$hdc.include` must not contain other keys (no merge in v1).
  - Circular includes are rejected.

Preprocessor: [`tools/hdc/lib/json-config-preprocess.mjs`](tools/hdc/lib/json-config-preprocess.mjs). Writes via `writeResolvedRepoJson` remain strict JSON (comments are not preserved). Opt out when loading: `loadPackageConfigFromPackageRoot(root, { preprocess: false })`.

Example (split Cloudflare zones):

```jsonc
{
  "zones": [
    { "$hdc.include": "zones/dukk.org.json" }
  ]
}
```

## Repository map

| Path | Role |
| --- | --- |
| [`tools/hdc/`](tools/hdc/) | Node.js CLI (`cli.mjs`) and shared libraries |
| [`packages/<package>/`](packages/) | Plugins: `manifest.json` plus `deploy/`, `maintain/`, `query/` (`run.mjs`) |
| [`inventory/manual/`](inventory/manual/) | Authoritative sidecars in **hdc-private** (`systems/`, `networks/`, `services/`, `targets/`); public repo: [`systems/_example.json`](inventory/manual/systems/_example.json) only |
| [`inventory/automated/`](inventory/automated/) | Overlay in **hdc-private** (per-file under `systems/`, `networks/`, `policies/`) |
| [`docs/manually-deployed/`](docs/manually-deployed/) | Human-oriented markdown for gear hdc does not manage end-to-end |

Optional companion `*.md` next to inventory JSON is for humans/agents; **hdc does not read or write those files**.

## CLI (implemented)

Commands from [`tools/hdc/lib/cli-app.mjs`](tools/hdc/lib/cli-app.mjs):

| Command | Purpose |
| --- | --- |
| `help [topic …]` | Hierarchical usage |
| `list` | Packages and manifest metadata |
| `run <tier> <package> <verb> [-- <args>]` | Run a package script (`deploy`, `maintain`, `query`); tier: `client`, `infrastructure`, or `service` |
| `run <tier> <package> <platform> <verb> [-- <args>]` | When manifest lists `platforms` (legacy platform-routed layout) |
| `secrets path \| init \| change-passphrase \| set \| list \| get \| dump \| delete` | Encrypted vault for `HDC_*` secrets; `get`/`dump` write plaintext to files (unlock required) |
| `users bootstrap-hdc [--dry-run] [--sidecar <path> …]` | Ensure local `hdc` Linux user on bootstrap hosts |
| `env` | Print `HDC_*` variables (sensitive values redacted) |

Examples:

```bash
node tools/hdc/cli.mjs list
node tools/hdc/cli.mjs run infrastructure proxmox query
node tools/hdc/cli.mjs run service pi-hole deploy -- --help
node tools/hdc/cli.mjs help run infrastructure proxmox maintain
```

**Not implemented in the CLI today:** `docs lint`, `docs sync`, and `inventory apply` appear in [README.md](README.md) and some `.cursor/rules/` files — treat as planned workflow until wired in `cli-app.mjs`. Validate inventory JSON against schemas under [`tools/hdc/schema/`](tools/hdc/schema/) instead.

## Inventory

- **Manual sidecars:** `inventory/manual/{systems,networks,services,targets}/*.json`, discriminated by `kind`: `system`, `network`, `target`, or `services`.
- **Systems** may list `services: [{ "id": "<id>", "nodes"?: ["…"] }]` pointing at `kind: "services"` records under `inventory/manual/services/` (by id only).
- **Targets:** `kind: "target"` with `automation_target` set to a package manifest id (e.g. `proxmox`, `unifi-network`).
- **Schemas:** [`inventory.schema.json`](tools/hdc/schema/inventory.schema.json) (union), plus `inventory.system.schema.json`, `inventory.network.schema.json`, `inventory.target.schema.json`, `inventory.services.schema.json`, `inventory.policy.schema.json`.
- **Automated overlay:** plugins may write under `inventory/automated/`; use `resolveSystemById` in code when merging manual and automated facts.

### System id naming

Filename stem must equal `id` (`<id>.json`). Follow [`.cursor/rules/hdc-inventory-naming.mdc`](.cursor/rules/hdc-inventory-naming.mdc):

| Workload | Prefix | Example |
| --- | --- | --- |
| Physical host / hypervisor | *(none)* | `hypervisor-a`, `nas-primary` |
| VM | `vm-` | `vm-minecraft-a` |
| LXC (Pi-hole) | *(none)* | `pi-hole-a` |
| LXC container | *(none)* | `adguard-a` |
| Other virtual | `virt-` | `virt-vpn-endpoint-a` |

Multi-instance suffixes use **letters** (`-a`, `-b`), not numbers (`-1`, `-2`). Proxmox is authoritative for `system_class` when it disagrees with other sources.

## Packages

- Each package: [`packages/<folder>/manifest.json`](packages/) with `id`, optional `inventory_docs`, and `verbs` mapping to `deploy/run.mjs`, `maintain/run.mjs`, or `query/run.mjs`.
- **Infrastructure** (shared capabilities): `proxmox`, `unifi-network`, `ubuntu`, `synology-nas`, `cloudflare`, `azure-entra`, `gcp-oauth`.
- **Services** (apps on guests): e.g. `pi-hole`, `uptime-kuma`, `scanopy`, `yacy`, `gatus`, `open-webui`, `vaultwarden`, `n8n`, `nextcloud`, `postiz`, `immich`, `solidtime`, `nagios`, `homeassistant`, `bind`, `nginx`, `nginx-waf`, `kafka`, `cassandra`, `postgresql`, `splunk`, `step-ca`, `jenkins`, `minecraft`, `ollama`, `lms`, `llama-cpp`, `postfix-relay`, `audiobookshelf`.
- **Clients** (home PCs/workstations): `windows`, `client-ubuntu`, `raspberrypi` under `packages/clients/` — shared [`packages/clients/config.json`](packages/clients/config.json). (`client-ubuntu` id avoids clash with infrastructure `ubuntu`.)

### Package script logging

When changing `packages/**/*.mjs`:

- **stderr** — user-visible progress, prompts, warnings.
- **stdout** — machine-only; on `query` / `deploy`, often a single JSON object at exit.
- **Secrets** — use `readLineQuestion(prompt, { mask: true })` from [`tools/hdc/lib/readline-masked.mjs`](tools/hdc/lib/readline-masked.mjs); never log tokens or passphrases.

See [`.cursor/rules/hdc-automation-logging.mdc`](.cursor/rules/hdc-automation-logging.mdc).

### Operation reports (deploy / maintain / teardown)

After `deploy`, `maintain`, or `teardown`, packages write a markdown report under `packages/<package>/reports/<verb>-<timestamp>.md` in **hdc-private when that repo is available** (sibling `../hdc-private` or `HDC_PRIVATE_ROOT`), otherwise under the public hdc tree (gitignored in both repos). Shared helpers: [`packages/lib/operation-report.mjs`](packages/lib/operation-report.mjs). Skip with `--no-report`; override path with `--report <path>`. `query` does not write reports.

### Guest baseline (local admin + ClamAV)

Linux **Proxmox guest** `maintain` scripts apply a shared baseline via [`packages/lib/guest-linux-baseline.mjs`](packages/lib/guest-linux-baseline.mjs):

1. **Local sudo admin** — username from `HDC_ADMIN_USER` in repo `.env`; password in vault as `HDC_ADMIN_USER_PASSWORD` (prompted once per run, then reused). Helpers: [`packages/lib/admin-user-ensure.mjs`](packages/lib/admin-user-ensure.mjs), [`packages/lib/linux-local-admin-user.mjs`](packages/lib/linux-local-admin-user.mjs). Skip with `--skip-admin-user`.
2. **ClamAV** — install/enable via [`packages/lib/clamav-ensure.mjs`](packages/lib/clamav-ensure.mjs). Skip with `--skip-clamav`.

Coexists with the per-host `hdc` automation user from `node tools/hdc/cli.mjs users bootstrap-hdc` (`HDC_USER_HDC_PASSWORD_*`).

- **Out of scope:** Proxmox hypervisors (`proxmox maintain`), Synology NAS (`synology-nas`), home clients (`packages/clients/*`), and `ubuntu maintain` (bootstrap `hdc` only). **Nagios** LXC guests get the local admin user only (no ClamAV).
- **Stub services** (`minecraft`, `jenkins`, `audiobookshelf`): baseline when `config.json` defines SSH or LXC targets; otherwise reports that baseline was not applied.

Example: set `HDC_ADMIN_USER` in `.env`, then `node tools/hdc/cli.mjs run service postgresql maintain --`

## Pi-hole in this repo

- **Config:** [`packages/services/pi-hole/config.json`](packages/services/pi-hole/config.json) (copy from [`config.example.json`](packages/services/pi-hole/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/pi-hole-a.json`](inventory/manual/systems/pi-hole-a.json), [`pi-hole-b.json`](inventory/manual/systems/pi-hole-b.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC provision + unattended Pi-hole install (`deployments[]`; `--instance a` / `--system-id pi-hole-b`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Gravity update + optional core update (`--skip-core-update`) |
| `query` | Per-instance status via `pct exec`; optional API summary when `HDC_PIHOLE_API_TOKEN` (or `_A` / `_B`) is in vault |

Vault: `HDC_PIHOLE_WEBPASSWORD` (required for deploy); `HDC_PIHOLE_API_TOKEN` optional for query.

## Uptime Kuma in this repo

- **Config:** [`packages/services/uptime-kuma/config.json`](packages/services/uptime-kuma/config.json) (copy from [`config.example.json`](packages/services/uptime-kuma/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/uptime-kuma-a.json`](inventory/manual/systems/uptime-kuma-a.json); service sidecar [`inventory/manual/services/uptime-kuma.json`](inventory/manual/services/uptime-kuma.json).
- **Schema:** [`tools/hdc/schema/uptime-kuma.config.schema.json`](tools/hdc/schema/uptime-kuma.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC provision + Uptime Kuma install from GitHub release tarball (Node 22, Chromium, systemd on port 3001; `--instance a`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Upgrade when `uptime_kuma.release` is behind latest (or pinned tag); `--skip-upgrade` for restart/health only |
| `query` | `systemctl`, HTTP probe, installed version via `pct exec` |
| `teardown` | Destroy LXC (`--dry-run`, `--yes`, `--instance`) |

No vault secrets required for v1 — complete first-run admin setup in the web UI after deploy. Optional future: `HDC_UPTIME_KUMA_API_TOKEN` for API query.

Example: `node tools/hdc/cli.mjs run service uptime-kuma deploy --`

## SolidTime in this repo

- **Config:** [`packages/services/solidtime/config.json`](packages/services/solidtime/config.json) (copy from [`config.example.json`](packages/services/solidtime/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/solidtime-a.json`](inventory/manual/systems/solidtime-a.json); service sidecar [`inventory/manual/services/solidtime.json`](inventory/manual/services/solidtime.json).
- **Schema:** [`tools/hdc/schema/solidtime.config.schema.json`](tools/hdc/schema/solidtime.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (Ubuntu 22.04) + SolidTime from GitHub tarball (`deployments[]`; `--instance a`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Upgrade to `solidtime.version` in config (`--check-latest`, `--version <tag>`, `--skip-upgrade`) |
| `query` | Caddy/PHP/PostgreSQL/HTTP health via `pct exec` |
| `teardown` | Destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_SOLIDTIME_DB_PASSWORD` (optional — auto-generated on first deploy if missing). Register the first account via the web UI after deploy.

Example: `node tools/hdc/cli.mjs run service solidtime deploy --`

## BIND DNS in this repo

- **Config:** [`packages/services/bind/config.json`](packages/services/bind/config.json) (copy from [`config.example.json`](packages/services/bind/config.example.json); keep local config out of git). Authoritative zone records live in `zones[]` objects (`id`, `zone_type`, `records`, optional `subnet` for reverse). Set static `deployments[].proxmox.qemu.ip` per node; no guest `vmid` in config (auto-allocated at deploy). Recursive upstream: plain `bind.forwarders` (default `1.1.1.1`, `1.0.0.1`) or **ODoH** via `bind.forward_upstream.mode: "odoh"` (installs **dnscrypt-proxy** on each VM; BIND forwards to `listen`, default `127.0.0.1:5300`; Cloudflare target `odoh-cloudflare` + configurable `relay`, default `odohrelay-crypto-sx`). ODoH is experimental (RFC 9230).
- **Inventory:** [`inventory/manual/systems/vm-bind-a.json`](inventory/manual/systems/vm-bind-a.json), [`vm-bind-b.json`](inventory/manual/systems/vm-bind-b.json).
- **Schema:** [`tools/hdc/schema/bind.config.schema.json`](tools/hdc/schema/bind.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Rebuild QEMU guests from Ubuntu template (optional `--destroy-existing`), cloud-init static IP from config, auto VMID, BIND primary then secondary (`deployments[]`; `--instance a\|b`) |
| `maintain` | Re-push dnscrypt-proxy (ODoH) and named options (forwarders) on all nodes; re-render zone files on primary (timestamp SOA serial); verify SOA serial match on secondary |
| `query` | `named` service status and per-zone `dig SOA` on each node |

TSIG: deploy auto-generates `bind.tsig_secret` in `config.json` and syncs vault `HDC_BIND_TSIG_KEY` when missing; `--regenerate-tsig` to rotate.

Example: `node tools/hdc/cli.mjs run service bind deploy -- --destroy-existing`

## PostgreSQL in this repo

- **Config:** [`packages/services/postgresql/config.json`](packages/services/postgresql/config.json) (copy from [`config.example.json`](packages/services/postgresql/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-postgres-a.json`](inventory/manual/systems/vm-postgres-a.json), [`vm-postgres-b.json`](inventory/manual/systems/vm-postgres-b.json); service sidecar [`inventory/manual/services/postgresql.json`](inventory/manual/services/postgresql.json).
- **Schema:** [`tools/hdc/schema/postgresql.config.schema.json`](tools/hdc/schema/postgresql.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, apt PostgreSQL install over SSH (`deployments[]` roles: `standalone`, `primary`, `standby`; primary/standalone before standby; `--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`) |
| `maintain` | Re-apply config on selected/all nodes; optional package upgrade (omit `--skip-package-upgrade` to run `apt-get upgrade` for PostgreSQL packages) |
| `query` | `postgresql` service status, `pg_isready`, version, recovery/replication lag on standbys |

Vault: `HDC_POSTGRESQL_SUPERUSER_PASSWORD` (required; optional per-instance `HDC_POSTGRESQL_SUPERUSER_PASSWORD_A`, …); `HDC_POSTGRESQL_REPLICATION_PASSWORD` when any deployment has `role: standby`.

Example: `node tools/hdc/cli.mjs run service postgresql deploy -- --instance a`

## step-ca in this repo

- **Config:** [`packages/services/step-ca/config.json`](packages/services/step-ca/config.json) (copy from [`config.example.json`](packages/services/step-ca/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-step-ca-a.json`](inventory/manual/systems/vm-step-ca-a.json); service sidecar [`inventory/manual/services/step-ca.json`](inventory/manual/services/step-ca.json).
- **Schema:** [`tools/hdc/schema/step-ca.config.schema.json`](tools/hdc/schema/step-ca.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, apt `step-cli`/`step-ca`, non-interactive `step ca init` when missing, systemd under `/etc/step-ca` (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-existing`) |
| `maintain` | Re-push `ca.json` and password file, optional package upgrade, restart `step-ca` (omit `--skip-package-upgrade` to refresh packages) |

Vault: `HDC_STEP_CA_PASSWORD` (required; optional per-instance `HDC_STEP_CA_PASSWORD_A`). Distribute `/etc/step-ca/certs/root_ca.crt` to clients manually after deploy.

Example: `node tools/hdc/cli.mjs run service step-ca deploy --`

## Cassandra in this repo

- **Config:** [`packages/services/cassandra/config.json`](packages/services/cassandra/config.json) (copy from [`config.example.json`](packages/services/cassandra/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-cassandra-a.json`](inventory/manual/systems/vm-cassandra-a.json), [`vm-cassandra-b.json`](inventory/manual/systems/vm-cassandra-b.json), [`vm-cassandra-c.json`](inventory/manual/systems/vm-cassandra-c.json); service sidecar [`inventory/manual/services/cassandra.json`](inventory/manual/services/cassandra.json).
- **Schema:** [`tools/hdc/schema/cassandra.config.schema.json`](tools/hdc/schema/cassandra.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, Apache Cassandra apt install over SSH; 3-node cluster in bootstrap order (seeds first; `--instance a\|b\|c`, `--destroy-existing`, `--skip-provision`) |
| `maintain` | Re-push `cassandra.yaml` / rackdc / JVM options; optional `--rolling-restart` (nodetool drain + restart per node) |
| `query` | `cassandra` service status and `nodetool status` per node |

Vault: `HDC_CASSANDRA_SUPERUSER_PASSWORD` (required when `cassandra.authenticator` is `PasswordAuthenticator`).

Example: `node tools/hdc/cli.mjs run service cassandra deploy -- --destroy-existing`

## Redis Cluster in this repo

- **Config:** [`packages/services/redis/config.json`](packages/services/redis/config.json) (copy from [`config.example.json`](packages/services/redis/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-redis-a.json`](inventory/manual/systems/vm-redis-a.json), [`vm-redis-b.json`](inventory/manual/systems/vm-redis-b.json), [`vm-redis-c.json`](inventory/manual/systems/vm-redis-c.json); service sidecar [`inventory/manual/services/redis.json`](inventory/manual/services/redis.json).
- **Schema:** [`tools/hdc/schema/redis.config.schema.json`](tools/hdc/schema/redis.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, apt Redis install over SSH; 3-master cluster bootstrap via `redis-cli --cluster create` when all nodes deploy (`--instance a\|b\|c`, `--destroy-existing`, `--skip-provision`, `--skip-cluster-bootstrap`) |
| `maintain` | Re-apply `redis.conf` on each node; optional apt upgrade (`--skip-apt`); `redis-cli --cluster check` when all 3 nodes selected |
| `query` | Per-node `PING` and `CLUSTER INFO`; cluster check when all 3 nodes configured |

Vault: `HDC_REDIS_PASSWORD` (required for deploy/maintain/query).

Example: `node tools/hdc/cli.mjs run service redis deploy --`

## Valkey Cluster in this repo

- **Config:** [`packages/services/valkey/config.json`](packages/services/valkey/config.json) (copy from [`config.example.json`](packages/services/valkey/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-valkey-a.json`](inventory/manual/systems/vm-valkey-a.json), [`vm-valkey-b.json`](inventory/manual/systems/vm-valkey-b.json), [`vm-valkey-c.json`](inventory/manual/systems/vm-valkey-c.json); service sidecar [`inventory/manual/services/valkey.json`](inventory/manual/services/valkey.json).
- **Schema:** [`tools/hdc/schema/valkey.config.schema.json`](tools/hdc/schema/valkey.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, apt Valkey install over SSH; 3-master cluster bootstrap via `valkey-cli --cluster create` when all nodes deploy (`--instance a\|b\|c`, `--destroy-existing`, `--skip-provision`, `--skip-cluster-bootstrap`) |
| `maintain` | Re-apply `valkey.conf` on each node; optional apt upgrade (`--skip-apt`); `valkey-cli --cluster check` when all 3 nodes selected |
| `query` | Per-node `PING` and `CLUSTER INFO`; cluster check when all 3 nodes configured |

Vault: `HDC_VALKEY_PASSWORD` (required for deploy/maintain/query). Guests need Ubuntu 24.04+ (or another release with `valkey` in default apt).

Example: `node tools/hdc/cli.mjs run service valkey deploy --`

## Nginx WAF in this repo

- **Config:** [`packages/services/nginx-waf/config.json`](packages/services/nginx-waf/config.json) (copy from [`config.example.json`](packages/services/nginx-waf/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-nginx-waf-a.json`](inventory/manual/systems/vm-nginx-waf-a.json), [`vm-nginx-waf-b.json`](inventory/manual/systems/vm-nginx-waf-b.json); service sidecar [`inventory/manual/services/nginx-waf.json`](inventory/manual/services/nginx-waf.json).
- **Schema:** [`tools/hdc/schema/nginx-waf.config.schema.json`](tools/hdc/schema/nginx-waf.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Optional Proxmox QEMU provision or configure-only; install nginx, libmodsecurity3, ModSecurity-nginx, OWASP CRS (`/etc/modsecurity/hdc-waf.conf`); push `sites[]`; LE certs on cert-primary + peer sync |
| `maintain` | Re-apply OWASP CRS config + push `sites[]` to all nodes (default); `--renew-certs`; `--sync-certs`; `--site <id>` updates only that site (other vhosts unchanged); full maintain prunes sites removed from config |
| `query` | `nginx` status, config test, ModSecurity module + CRS rule count + `SecRuleEngine`, cert expiry, upstream probes |

**Per-location network access:** `defaults.nginx_waf.trusted_cidrs[]` (RFC1918 defaults); per-site `client_ip` (`remote_addr` or `cloudflare`); `locations[].access` with `policy: internal_only` and `deny_status` `401` or `404` for URL-pattern restrictions (nginx `location` path syntax).

Vault: `HDC_NGINX_WAF_LE_EMAIL` (required for deploy); `HDC_BIND_TSIG_KEY` when `letsencrypt.challenge` is `dns-01`.

Example: `node tools/hdc/cli.mjs run service nginx-waf maintain --`

## Nginx web hosting in this repo

- **Config:** [`packages/services/nginx/config.json`](packages/services/nginx/config.json) (copy from [`config.example.json`](packages/services/nginx/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-nginx-a.json`](inventory/manual/systems/vm-nginx-a.json); service sidecar [`inventory/manual/services/nginx.json`](inventory/manual/services/nginx.json).
- **Schema:** [`tools/hdc/schema/nginx.config.schema.json`](tools/hdc/schema/nginx.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Optional Proxmox QEMU provision or configure-only; install nginx + certbot; push `sites[]` (reverse proxy, same shape as nginx-waf without WAF); LE certs per node |
| `maintain` | Re-push `sites[]` to all nodes (default); `--renew-certs`; `--site <id>` updates only that site (other vhosts unchanged); full maintain prunes sites removed from config |
| `query` | `nginx` status, config test, enabled sites, upstream probes, cert expiry |

Vault: `HDC_NGINX_LE_EMAIL` (required for deploy); `HDC_BIND_TSIG_KEY` when `letsencrypt.challenge` is `dns-01`.

Example: `node tools/hdc/cli.mjs run service nginx deploy -- --instance a`

## Splunk in this repo

- **Config:** [`packages/services/splunk/config.json`](packages/services/splunk/config.json) (copy from [`config.example.json`](packages/services/splunk/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-splunk-a.json`](inventory/manual/systems/vm-splunk-a.json); service sidecar [`inventory/manual/services/splunk.json`](inventory/manual/services/splunk.json).
- **Schema:** [`tools/hdc/schema/splunk.config.schema.json`](tools/hdc/schema/splunk.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Single Splunk Free node on Proxmox QEMU: clone Ubuntu template, optional data disk for `/opt/splunk/var`, install `.deb`, accept Free license, set admin password (`deployments[]`; `--destroy-existing`, `--skip-provision`, `--skip-install`) |
| `maintain` | Re-push `server.conf` / `inputs.conf`; optional Splunk package upgrade (omit `--skip-package-upgrade`) |
| `query` | `splunk status`, version, HTTP/mgmt port probes, var disk usage |

Set `splunk.version` and `splunk.build` in config (build id from Splunk download page deb filename). Exactly one `standalone` deployment — no clustering (Splunk Free).

Vault: `HDC_SPLUNK_ADMIN_PASSWORD` (required for deploy).

Example: `node tools/hdc/cli.mjs run service splunk deploy -- --destroy-existing`

## Kafka in this repo

- **Config:** [`packages/services/kafka/config.json`](packages/services/kafka/config.json) (copy from [`config.example.json`](packages/services/kafka/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-kafka-a.json`](inventory/manual/systems/vm-kafka-a.json), [`vm-kafka-b.json`](inventory/manual/systems/vm-kafka-b.json), [`vm-kafka-c.json`](inventory/manual/systems/vm-kafka-c.json); service sidecar [`inventory/manual/services/kafka.json`](inventory/manual/services/kafka.json).
- **Schema:** [`tools/hdc/schema/kafka.config.schema.json`](tools/hdc/schema/kafka.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Three-node KRaft cluster on Proxmox QEMU: clone Ubuntu template, cloud-init static IP, install Apache Kafka tarball, format storage, start `kafka.service` (`deployments[]`; `--instance a\|b\|c`; `--destroy-existing`, `--skip-provision`, `--skip-existing`) |
| `maintain` | Re-push `server.properties`, skip format when already formatted, rolling `systemctl restart kafka` |
| `query` | Per-broker `systemctl` + `kafka-broker-api-versions.sh` against localhost |

Set `kafka.cluster_id` in config (UUID from `kafka-storage.sh random-uuid`). No vault secrets for v1 (PLAINTEXT listeners).

Example: `node tools/hdc/cli.mjs run service kafka deploy --`

## Ollama in this repo

- **Config:** [`packages/services/ollama/config.json`](packages/services/ollama/config.json) (copy from [`config.example.json`](packages/services/ollama/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-ollama-a.json`](inventory/manual/systems/vm-ollama-a.json) (QEMU + GPU on hypervisor-d); `ollama-b/c` for LXC instances.
- **Schema:** [`tools/hdc/schema/ollama.config.schema.json`](tools/hdc/schema/ollama.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC (`ollama-*`) or QEMU (`vm-ollama-*`): clone/provision, optional `proxmox.qemu.hostpci[]` GPU passthrough, cloud-init, SSH install (`install.gpu_backend`: `nvidia` or `intel`); pulls `ollama.models[]` after install unless `--skip-models` |
| `maintain` | Sync `proxmox.*.memory_mb` / `cores` on live guests (no destroy); sync `defaults.ollama.models[]` / per-deployment `ollama.models[]` (`ollama pull` / `ollama rm` with `--prune` only); guest Linux baseline on LXC/QEMU; `--dry-run`, `--skip-models`, `--skip-resources`, `--no-reboot`, `--reboot` |
| `query` | Config / deployment summaries; `--live` lists installed models (HTTP `/api/tags` or remote exec) |
| `teardown` | Destroy LXC or QEMU guest (`--instance a`, `--yes`, `--dry-run`) |

Set desired models under `defaults.ollama.models[]` and/or per `deployments[]` entry (strings or `{ "name": "llama3.2:latest" }`). Per-node lists override defaults after merge. Removal of models not in config requires **`maintain --prune`** (not implicit on deploy).

**GPU passthrough (ollama-a on hypervisor-d):** Use `mode: proxmox-qemu`, `system_id: vm-ollama-a`, and `hostpci[]` with the PCI BDF from `lspci` on hypervisor-d. Complete VFIO/IOMMU host setup manually before deploy. If migrating from LXC vmid 470, run `teardown --instance a --yes` first.

Examples:

```bash
node tools/hdc/cli.mjs run service ollama deploy -- --instance a --destroy-existing
node tools/hdc/cli.mjs run service ollama maintain -- --prune --dry-run
node tools/hdc/cli.mjs run service ollama query -- --live
```

## Scanopy in this repo

- **Config:** [`packages/services/scanopy/config.json`](packages/services/scanopy/config.json) (copy from [`config.example.json`](packages/services/scanopy/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/scanopy-a.json`](inventory/manual/systems/scanopy-a.json); service sidecar [`inventory/manual/services/scanopy.json`](inventory/manual/services/scanopy.json).
- **Schema:** [`tools/hdc/schema/scanopy.config.schema.json`](tools/hdc/schema/scanopy.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (4 vCPU, 4 GiB RAM, 32 GiB rootfs) + official Docker Compose stack (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | `docker compose pull` + `up -d` in `/opt/scanopy` |
| `query` | Config summary; `--live` for Docker/HTTP probe on port 60072 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_SCANOPY_POSTGRES_PASSWORD` (Postgres password for the compose stack).

Example: `node tools/hdc/cli.mjs run service scanopy deploy --`

## YaCy in this repo

- **Config:** [`packages/services/yacy/config.json`](packages/services/yacy/config.json) (copy from [`config.example.json`](packages/services/yacy/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/yacy-a.json`](inventory/manual/systems/yacy-a.json); service sidecar [`inventory/manual/services/yacy.json`](inventory/manual/services/yacy.json).
- **Schema:** [`tools/hdc/schema/yacy.config.schema.json`](tools/hdc/schema/yacy.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (privileged, Docker) + `yacy/yacy_search_server` Compose in `/opt/yacy`; admin password via `passwd.sh` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-admin-password`) |
| `maintain` | Re-push `.env`, `docker compose pull` + `up -d`; guest Linux baseline; re-apply admin password unless `--skip-admin-password`; `--skip-upgrade` skips image pull |
| `query` | Config summary; `--live` for Docker/HTTP probe on port 8090 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_YACY_ADMIN_PASSWORD` (required for deploy/maintain unless `--skip-admin-password`). Default YaCy UI login is `admin` with this password after deploy.

Example: `node tools/hdc/cli.mjs run service yacy deploy --`

## Immich in this repo

- **Config:** [`packages/services/immich/config.json`](packages/services/immich/config.json) (copy from [`config.example.json`](packages/services/immich/config.example.json); keep local config out of git).
- **Modes:** `synology-docker` (official compose on Synology via [`synology-nas`](packages/infrastructure/synology-nas/) lib; `system_id` `immich-a`, `synology.instance` `a`) or `proxmox-qemu` / `configure-only` (Ubuntu VM + SSH; `vm-immich-a`).
- **Inventory:** [`inventory/manual/systems/immich-a.json`](inventory/manual/systems/immich-a.json) (NAS Docker), optional [`vm-immich-a.json`](inventory/manual/systems/vm-immich-a.json); [`nas-a.json`](inventory/manual/systems/nas-a.json); service sidecar [`inventory/manual/services/immich.json`](inventory/manual/services/immich.json).
- **Schema:** [`tools/hdc/schema/immich.config.schema.json`](tools/hdc/schema/immich.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | **Synology:** fetch release compose, push `.env` + stack to `/volume1/docker/immich` (`synology-docker`). **Proxmox:** QEMU clone + SSH install (`proxmox-qemu`; `--destroy-existing`, `--skip-provision`, …) |
| `maintain` | Re-push `.env`, `docker compose pull` + `up -d` (omit `--skip-upgrade`). ClamAV baseline on Proxmox guests only (`--skip-clamav`) |
| `query` | Config summary; `--live` for compose health + `/api/server/ping` on port 2283 |
| `teardown` | Synology: `docker compose down`. Proxmox: optional compose down then destroy QEMU (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `immich.public_url` (e.g. `https://immich.dukk.org`) for `IMMICH_SERVER_URL` in `.env` behind nginx-waf. Synology: `upload_location` / `db_data_location` under `/volume1/docker/immich/`. Proxmox: optional `data_disk_gb`; pin `proxmox.qemu.vmid`, `ip`, `configure.ssh.host`.

**HTTPS:** nginx-waf `sites[]` upstream `http://<nas-ip>:2283`; Cloudflare A `immich` → WAF WAN IP. Prerequisite: `node tools/hdc/cli.mjs run infrastructure synology-nas maintain -- --instance a`.

Vault: `HDC_IMMICH_DB_PASSWORD` (required for deploy/maintain).

Example: `node tools/hdc/cli.mjs run service immich deploy -- --instance a`

## Gatus in this repo

- **Config:** [`packages/services/gatus/config.json`](packages/services/gatus/config.json) (copy from [`config.example.json`](packages/services/gatus/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/gatus-a.json`](inventory/manual/systems/gatus-a.json); service sidecar [`inventory/manual/services/gatus.json`](inventory/manual/services/gatus.json).
- **Schema:** [`tools/hdc/schema/gatus.config.schema.json`](tools/hdc/schema/gatus.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (1 vCPU, 512 MiB RAM, 4 GiB rootfs) + Gatus built from GitHub release tarball (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `config.yaml` from `gatus.endpoints[]`; optional binary upgrade (omit `--skip-upgrade`) |
| `query` | Config summary; `--live` for systemd + HTTP probe on port 8080 |
| `teardown` | Destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Set `gatus.version` (e.g. `v5.36.0`) and `gatus.endpoints[]` in config. Alerting secrets may use `${ENV}` in `config_yaml_extra` (store values in vault; no `env_required` for v1).

Example: `node tools/hdc/cli.mjs run service gatus deploy --`

## Nagios in this repo

- **Config:** [`packages/services/nagios/config.json`](packages/services/nagios/config.json) (copy from [`config.example.json`](packages/services/nagios/config.example.json); keep local config out of git).
- **BIND source:** `bind_config_path` (default `packages/services/bind/config.json`) — forward-zone A records become Nagios hosts with PING checks.
- **Inventory:** [`inventory/manual/systems/nagios-a.json`](inventory/manual/systems/nagios-a.json), [`nagios-b.json`](inventory/manual/systems/nagios-b.json), [`nagios-c.json`](inventory/manual/systems/nagios-c.json); service sidecar [`inventory/manual/services/nagios.json`](inventory/manual/services/nagios.json); hypervisors [`hypervisor-b.json`](inventory/manual/systems/hypervisor-b.json), [`hypervisor-c.json`](inventory/manual/systems/hypervisor-c.json), [`hypervisor-d.json`](inventory/manual/systems/hypervisor-d.json).
- **Schema:** [`tools/hdc/schema/nagios.config.schema.json`](tools/hdc/schema/nagios.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-b` / `hypervisor-c` / `hypervisor-d` at `192.0.2.120`–`122`, apt `nagios4`, push generated `conf.d/hdc-generated.cfg` from BIND (`deployments[]`; `--instance a\|b\|c`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Regenerate from BIND and push to all or selected instances; `--apply-upgrades` for apt upgrade |
| `query` | Deployment summary + BIND host counts; `--live` for systemd/config per CT |

No vault secrets for v1. Web UI: `http://192.0.2.120/nagios4` (and `.121`, `.122`) after deploy.

Example: `node tools/hdc/cli.mjs run service nagios deploy --`

## Open WebUI in this repo

- **Config:** [`packages/services/open-webui/config.json`](packages/services/open-webui/config.json) (copy from [`config.example.json`](packages/services/open-webui/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/open-webui-a.json`](inventory/manual/systems/open-webui-a.json); service sidecar [`inventory/manual/services/open-webui.json`](inventory/manual/services/open-webui.json).
- **Schema:** [`tools/hdc/schema/open-webui.config.schema.json`](tools/hdc/schema/open-webui.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (2 vCPU, 4 GiB RAM, 16 GiB rootfs) + Docker Open WebUI pointing at `open_webui.ollama_backends[]` via `OLLAMA_BASE_URLS` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env` from config, `docker compose pull` + `up -d` (omit `--skip-upgrade` for image refresh) |
| `query` | Config summary; `--live` for Docker/HTTP probe on `host_port` (default 3000) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_OPEN_WEBUI_SECRET_KEY` (required for deploy/maintain). Set `ollama_backends[].url` to reachable Ollama APIs (e.g. `http://192.0.2.25:11434` for `vm-ollama-a`); does not bundle Ollama — use the `ollama` package for inference hosts.

Example: `node tools/hdc/cli.mjs run service open-webui deploy --`

## Vaultwarden in this repo

- **Config:** [`packages/services/vaultwarden/config.json`](packages/services/vaultwarden/config.json) (copy from [`config.example.json`](packages/services/vaultwarden/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vaultwarden-a.json`](inventory/manual/systems/vaultwarden-a.json); service sidecar [`inventory/manual/services/vaultwarden.json`](inventory/manual/services/vaultwarden.json).
- **Schema:** [`tools/hdc/schema/vaultwarden.config.schema.json`](tools/hdc/schema/vaultwarden.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 16 GiB rootfs) + Docker Vaultwarden (`vaultwarden.domain` must be `https://…` for nginx-waf; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env` from config, `docker compose pull` + `up -d`, ClamAV baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/alive` on `vaultwarden.domain` |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_VAULTWARDEN_ADMIN_TOKEN` (required for deploy/maintain; stays in **local** hdc vault). After deploy, add BIND A record and nginx-waf `sites[]` upstream to the CT IP (port 80). Does not configure nginx-waf automatically.

**hdc secret backend:** When `HDC_VAULTWARDEN_URL` and `HDC_VAULTWARDEN_EMAIL` are set, `HDC_SECRET_BACKEND=auto` (default) routes `getSecret` / `secrets set` through **Bitwarden CLI (`bw`)** against Vaultwarden. Login items are named exactly like env keys (`HDC_PROXMOX_API_TOKEN`, …). Bootstrap keys stay local only: `HDC_VAULTWARDEN_MASTER_PASSWORD`, `HDC_VAULTWARDEN_ADMIN_TOKEN`. Unlock: masked master-password prompt, or `secrets unlock`; opt-in save master password to local vault. See [`docs/manually-deployed/bitwarden-cli.md`](docs/manually-deployed/bitwarden-cli.md).

Example: `node tools/hdc/cli.mjs run service vaultwarden deploy -- --instance a`

## n8n in this repo

- **Config:** [`packages/services/n8n/config.json`](packages/services/n8n/config.json) (copy from [`config.example.json`](packages/services/n8n/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/n8n-a.json`](inventory/manual/systems/n8n-a.json); service sidecar [`inventory/manual/services/n8n.json`](inventory/manual/services/n8n.json).
- **Schema:** [`tools/hdc/schema/n8n.config.schema.json`](tools/hdc/schema/n8n.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker n8n with SQLite (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env` from config, `docker compose pull` + `up -d`, ClamAV baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/healthz` on port 5678 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `n8n.public_url` (`https://…`) when using nginx-waf for webhooks and UI; omit for HTTP on the CT IP only. Vault: `HDC_N8N_ENCRYPTION_KEY` (required for credential encryption; auto-generated on first deploy if missing). After deploy, add BIND A record and nginx-waf `sites[]` upstream to `http://<ct-ip>:5678` when using a public hostname.

Example: `node tools/hdc/cli.mjs run service n8n deploy -- --instance a`

## Home Assistant in this repo

- **Config:** [`packages/services/homeassistant/config.json`](packages/services/homeassistant/config.json) (copy from [`config.example.json`](packages/services/homeassistant/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-homeassistant-a.json`](inventory/manual/systems/vm-homeassistant-a.json); service sidecar [`inventory/manual/services/homeassistant.json`](inventory/manual/services/homeassistant.json).
- **Schema:** [`tools/hdc/schema/homeassistant.config.schema.json`](tools/hdc/schema/homeassistant.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU on configured host (e.g. `pve-h`): import HAOS OVA qcow2, USB passthrough for Zigbee/Z-Wave (`deployments[]`; `--instance a`, `--destroy-existing`, `--usb-id`, `--no-wait-http`) |
| `maintain` | HTTP probe on port 8123; `--reapply-usb` to refresh USB mapping |
| `query` | Config summary; `--live` for Proxmox guest + HTTP probe |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Pin `homeassistant.release` (HAOS version). Set static IP in HA UI if deploy HTTP wait fails. nginx-waf may already point `ha.dukk.org` at `http://10.0.0.30:8123`. No vault secrets for v1.

Example: `node tools/hdc/cli.mjs run service homeassistant deploy -- --instance a --destroy-existing`

## Windows desktop in this repo

- **Config:** [`packages/services/windows-desktop/config.json`](packages/services/windows-desktop/config.json) (copy from [`config.example.json`](packages/services/windows-desktop/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-win11-a.json`](inventory/manual/systems/vm-win11-a.json); service sidecar [`inventory/manual/services/windows-desktop.json`](inventory/manual/services/windows-desktop.json).
- **Schema:** [`tools/hdc/schema/windows-desktop.config.schema.json`](tools/hdc/schema/windows-desktop.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU on `pve-b` (or configured host): Win11 from ISO + generated `autounattend.xml`, OVMF/TPM/VirtIO, OEM MSDM/SLIC passthrough (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-oem`, `--skip-install`, `--wait-install`) |
| `maintain` | Re-dump and re-apply OEM ACPI tables + SMBIOS on the guest |
| `query` | Config summary; `--live` for VM power state and OEM probe on hypervisor |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_WINDOWS_DESKTOP_ADMIN_PASSWORD` (required). Place Windows 11 and virtio-win ISOs on the node (`proxmox.iso.windows_volid`, `virtio_volid`). **One** OEM-licensed Windows VM per hypervisor.

Example: `node tools/hdc/cli.mjs run service windows-desktop deploy -- --instance a --wait-install`

## Nextcloud in this repo

- **Config:** [`packages/services/nextcloud/config.json`](packages/services/nextcloud/config.json) (copy from [`config.example.json`](packages/services/nextcloud/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/nextcloud-a.json`](inventory/manual/systems/nextcloud-a.json); service sidecar [`inventory/manual/services/nextcloud.json`](inventory/manual/services/nextcloud.json).
- **Schema:** [`tools/hdc/schema/nextcloud.config.schema.json`](tools/hdc/schema/nextcloud.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (4 vCPU, 8 GiB RAM, 64 GiB rootfs, privileged + nesting) + Nextcloud AIO mastercontainer via Docker Compose (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `compose.yaml` from config, `docker compose pull` + `up -d` for mastercontainer (omit `--skip-upgrade`); ClamAV unless `--skip-clamav`. Full stack updates remain in the AIO UI. |
| `query` | Config summary; `--live` for Docker/mastercontainer and HTTPS probe on AIO interface port (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1. After deploy, open `https://<ct-ip>:8080` (use IP, not domain, per AIO HSTS guidance) and complete the AIO wizard. For nginx-waf, set `nextcloud.aio.reverse_proxy.enabled` and follow [AIO reverse-proxy docs](https://github.com/nextcloud/all-in-one/blob/main/reverse-proxy.md).

Example: `node tools/hdc/cli.mjs run nextcloud deploy --`

## Postiz in this repo

- **Config:** [`packages/services/postiz/config.json`](packages/services/postiz/config.json) (copy from [`config.example.json`](packages/services/postiz/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/postiz-a.json`](inventory/manual/systems/postiz-a.json); service sidecar [`inventory/manual/services/postiz.json`](inventory/manual/services/postiz.json).
- **Schema:** [`tools/hdc/schema/postiz.config.schema.json`](tools/hdc/schema/postiz.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (4 vCPU, 8 GiB RAM, 20 GiB rootfs) + native Postiz from GitHub tarball: PostgreSQL, Redis, Temporal dev server, pnpm build, nginx on port 80 (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Upgrade to `postiz.version` / latest (`--check-latest`, `--version <tag>`); `--rebuild` after URL or `env_extra` changes (`NEXT_PUBLIC_*` baked at build); `--skip-upgrade` for service restart only; ClamAV unless `--skip-clamav` |
| `query` | Config summary; `--live` for systemd, nginx test, HTTP probe on `listen_port` |
| `teardown` | Stop Postiz systemd units then destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_POSTIZ_DB_PASSWORD`, `HDC_POSTIZ_JWT_SECRET` (auto-generated on first deploy if missing). Set `postiz.public_url` before deploy when using a stable HTTPS URL; otherwise deploy uses CT IP and `maintain --rebuild` after nginx-waf. Community helper script is marked in development — pin `postiz.version` after validation.

Example: `node tools/hdc/cli.mjs run service postiz deploy --`

## LMS (LM Studio) in this repo

- **Config:** [`packages/services/lms/config.json`](packages/services/lms/config.json) (copy from [`config.example.json`](packages/services/lms/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-lms-a.json`](inventory/manual/systems/vm-lms-a.json); service sidecar [`inventory/manual/services/lms.json`](inventory/manual/services/lms.json).
- **Schema:** [`tools/hdc/schema/lms.config.schema.json`](tools/hdc/schema/lms.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU Ubuntu clone, cloud-init static IP, llmster via `https://lmstudio.ai/install.sh`, systemd `lmstudio.service` (`deployments[]`; `--instance a`; `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-models`) |
| `maintain` | Re-run install.sh, restart service, sync `lms.models[]` via `lms get`; guest Linux baseline; Proxmox CPU/RAM sync (`--skip-models`, `--skip-resources`, `--prune` ignored for removals) |
| `query` | Config summary; `--live` for systemd, `lms ls`, HTTP `/v1/models` |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Set `lms.load_on_start` to pin a model at boot. Optional `install.gpu` + `hostpci[]` for NVIDIA passthrough (hypervisor VFIO required). API default: `http://<guest-ip>:1234`.

No vault secrets for v1.

Example: `node tools/hdc/cli.mjs run service lms deploy -- --instance a`

## Llama.cpp in this repo

- **Config:** [`packages/services/llama-cpp/config.json`](packages/services/llama-cpp/config.json) (copy from [`config.example.json`](packages/services/llama-cpp/config.example.json); keep local config out of git).
- **Inventory:** optional [`inventory/manual/systems/llama-cpp-{a,b}.json`](inventory/manual/systems/) per instance.
- **Schema:** [`tools/hdc/schema/llama-cpp.config.schema.json`](tools/hdc/schema/llama-cpp.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC provision + `llama-server` from GitHub releases (`deployments[]`; per-deployment `install.backend`: cpu/cuda/vulkan/rocm; `--instance a`) |
| `maintain` | Upgrade binary to latest/pinned release and restart `llama-server` (`--skip-restart` optional) |
| `query` | Config summary; `--live` for systemd/health via `pct exec` |
| `teardown` | Destroy LXC guests (`--dry-run`, `--yes`, `--instance`) |

Set `server.model` or `server.hf_model` in config to enable and start the unit at deploy; otherwise install leaves the service disabled until a model is configured.

Example: `node tools/hdc/cli.mjs run service llama-cpp deploy -- --instance a`

## Home clients in this repo

- **Config:** [`packages/clients/config.json`](packages/clients/config.json) (copy from [`config.example.json`](packages/clients/config.example.json); keep local config out of git).
- **Packages:** [`packages/clients/windows/`](packages/clients/windows/), [`packages/clients/ubuntu/`](packages/clients/ubuntu/) (manifest id `client-ubuntu`), [`packages/clients/raspberrypi/`](packages/clients/raspberrypi/).
- **Inventory:** manual `inventory/manual/systems/*.json` with `automation_targets: ["client"]`, `access.nodes[]` with `ip`, `mac`, and `ssh` or `winrm` as needed.
- **Schema:** [`tools/hdc/schema/client.config.schema.json`](tools/hdc/schema/client.config.schema.json).
- **Docs:** [`docs/manually-deployed/client-winrm.md`](docs/manually-deployed/client-winrm.md), [`docs/manually-deployed/client-wol.md`](docs/manually-deployed/client-wol.md).

| Command | Summary |
| --- | --- |
| `run client windows maintain` | WinRM disk + Windows Update (PSWindowsUpdate on target); WoL if offline; auto WinRM bootstrap via PsExec when HTTPS port closed |
| `run client windows query` | WinRM disk + pending update count; same PsExec WinRM bootstrap when needed |
| `run client client-ubuntu maintain` | SSH `df`, apt dist-upgrade; reboot only with `--reboot` |
| `run client client-ubuntu query` | SSH disk + upgradable package count |
| `run client raspberrypi maintain` | Same as ubuntu (Debian/apt) |
| `run client raspberrypi query` | Same as ubuntu |

Flags (after `--`): `--host-id`, `--dry-run`, `--skip-updates`, `--reboot`, `--no-wol`, `--no-winrm-bootstrap`, `--no-report`, `--report`.

**WinRM bootstrap:** When port 5986 is not open, `maintain`/`query` can run Sysinternals **PsExec** on the operator Windows host (current logon must be remote admin) to enable WinRM + HTTPS listener. Config: `winrm_bootstrap` in [`packages/clients/config.json`](packages/clients/config.json); env `HDC_PSEXEC_PATH`. See [`docs/manually-deployed/client-winrm.md`](docs/manually-deployed/client-winrm.md).

Vault: `HDC_WINRM_PASSWORD_<SUFFIX>` per Windows host (`winrm_password_vault_suffix` in config). Env: `HDC_WINRM_USER`, `HDC_CLIENT_SSH_USER`.

Examples:

```bash
node tools/hdc/cli.mjs run client windows query --
node tools/hdc/cli.mjs run client client-ubuntu maintain -- --reboot --host-id ws-example
```

## Proxmox in this repo

- **Config:** [`packages/infrastructure/proxmox/config.json`](packages/infrastructure/proxmox/config.json) (copy from [`config.example.json`](packages/infrastructure/proxmox/config.example.json); keep local config out of git).
- **Inventory:** hypervisors in `inventory/manual/systems/` (tag `proxmox` or `automation_targets: ["proxmox"]`), plus [`inventory/manual/targets/proxmox.json`](inventory/manual/targets/proxmox.json).
- **Schema:** [`tools/hdc/schema/proxmox.config.schema.json`](tools/hdc/schema/proxmox.config.schema.json).

| hdc service id | Verb | Summary |
| --- | --- | --- |
| `lxc-create` | deploy | Create LXC via API (`create-container`) |
| `qemu-clone` | deploy | Clone QEMU VM from template (`create-vm`); enables `agent=1` after clone (in-guest install via service deploy or SSH) |
| `qemu-list-templates` | deploy | List QEMU templates |
| `verify-templates` | maintain | SSH keys, no-subscription APT sources and subscription nag removal, host firewall (SSH/8006 to allowed LANs), API token ACL, templates, NAS storage, host OS updates, OEM Windows SLIC/MSDM license reporting, configured load report, QEMU guest agent (config + ping), markdown report under `packages/infrastructure/proxmox/reports/` |
| `cluster-snapshot` | query | Cluster/guest inventory JSON on stdout |

Bootstrap the local `hdc` user on Ubuntu/bootstrap hosts with `run infrastructure ubuntu maintain` or `users bootstrap-hdc` — not from `proxmox maintain`.

**QEMU guest agent:** Deploy scripts enable `agent=1` on new QEMU VMs and install `qemu-guest-agent` in Linux guests when deploy has SSH (e.g. BIND). LXC deploys are unchanged. See [`.cursor/rules/proxmox-qemu-guest-agent.mdc`](.cursor/rules/proxmox-qemu-guest-agent.mdc). Maintain `verify-templates` reports agent config + ping.

**Guest CPU/RAM:** QEMU clones and LXC creates apply `proxmox.qemu` / `proxmox.lxc` `memory_mb` and `cores` after the Proxmox task completes (template sizing is not kept when config differs). **Service maintain** syncs the same fields on live guests without destroy (QEMU reboot when running and sizing changed; LXC stop/PUT/start). Shared helpers: [`proxmox-guest-resources.mjs`](packages/infrastructure/proxmox/lib/proxmox-guest-resources.mjs), [`proxmox-guest-resources-maintain.mjs`](packages/lib/proxmox-guest-resources-maintain.mjs) (via [`guest-linux-baseline.mjs`](packages/lib/guest-linux-baseline.mjs) for Proxmox guests). Flags: `--skip-resources`, `--no-reboot` (disable auto-reboot on change); `--reboot` forces reboot. Infrastructure deploy: `create-vm` / `create-container` accept `--memory-mb`, `--cores`, and `--reboot`. Service deploy: optional `--reboot` when resizing a running guest.

**Resource planning** (CPU, RAM, storage, bridges): follow [`.cursor/skills/proxmox-resource-planning/SKILL.md`](.cursor/skills/proxmox-resource-planning/SKILL.md) and [`.cursor/rules/proxmox-resource-planning.mdc`](.cursor/rules/proxmox-resource-planning.mdc).

## Azure Entra app registrations in this repo

- **Config:** [`packages/infrastructure/azure-entra/config.json`](packages/infrastructure/azure-entra/config.json) (copy from [`config.example.json`](packages/infrastructure/azure-entra/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/azure-entra.config.schema.json`](tools/hdc/schema/azure-entra.config.schema.json).
- **Docs:** [`docs/manually-deployed/azure-entra.md`](docs/manually-deployed/azure-entra.md).

| Verb | Summary |
| --- | --- |
| `query` | Discover tenant app registrations, diff vs config, `suggested_config_entry` for import (JSON on stdout) |
| `deploy` | Create managed apps missing from the tenant; ensure enterprise service principal |
| `maintain` | Patch managed apps when redirect URIs, API permissions, or audience drift from config |

Env: `HDC_AZURE_TENANT_ID`, `HDC_AZURE_CLIENT_ID`. Vault: `HDC_AZURE_CLIENT_SECRET` (automation app only). Does not create or rotate secrets on managed applications.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure azure-entra query --
node tools/hdc/cli.mjs run infrastructure azure-entra deploy -- --dry-run
node tools/hdc/cli.mjs run infrastructure azure-entra maintain --
```

## GCP OAuth (Google Auth Platform) in this repo

- **Config:** [`packages/infrastructure/gcp-oauth/config.json`](packages/infrastructure/gcp-oauth/config.json) (copy from [`config.example.json`](packages/infrastructure/gcp-oauth/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/gcp-oauth.config.schema.json`](tools/hdc/schema/gcp-oauth.config.schema.json).
- **Docs:** [`docs/manually-deployed/gcp-oauth.md`](docs/manually-deployed/gcp-oauth.md).

| Verb | Summary |
| --- | --- |
| `query` | Effective redirect URIs per app; diff vs `--import` Console JSON; vault key presence (JSON on stdout) |
| `maintain` | Validate config; `--import` writes vault; print Console checklist (no API create — Console is source of truth) |

Vault: per-app `HDC_GCP_OAUTH_<APP>_CLIENT_ID` and `HDC_GCP_OAUTH_<APP>_CLIENT_SECRET` (see config `vault` block). Optional `derive_from` nginx-waf `site_id` + `callback_path`.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure gcp-oauth maintain -- --dry-run
node tools/hdc/cli.mjs run infrastructure gcp-oauth maintain -- --import ./client_secret.json
node tools/hdc/cli.mjs run infrastructure gcp-oauth query -- --import ./client_secret.json --require-vault
```

## Cloudflare in this repo

- **Config:** [`packages/infrastructure/cloudflare/config.json`](packages/infrastructure/cloudflare/config.json) (copy from [`config.example.json`](packages/infrastructure/cloudflare/config.example.json); keep local config out of git).
- **Schema:** [`tools/hdc/schema/cloudflare.config.schema.json`](tools/hdc/schema/cloudflare.config.schema.json).
- **Docs:** [`docs/manually-deployed/cloudflare.md`](docs/manually-deployed/cloudflare.md).

| Verb | Summary |
| --- | --- |
| `query` | List account zones (after `zone_filter`), diff DNS/page rules/email routing vs config; `--import-zones` (DNS only), `--import-page-rules`, `--import-email-routing` merge into hdc-private config |
| `maintain` | Apply `zones[]` records, optional `page_rules[]`, `email_routing_rules[]`, and `email_routing.catch_all`; `--prune`; `--skip-page-rules` / `--skip-email-routing` |

Token: `HDC_CLOUDFLARE_API_TOKEN` in repo `.env` or vault. Permissions: Zone Read, DNS Edit, Page Rules Edit, Email Routing Rules Edit. Optional: `HDC_CLOUDFLARE_ACCOUNT_ID`.

Per-zone opt-in: include `page_rules`, `email_routing_rules`, or `email_routing.catch_all` keys to manage those resources (omit key to leave live rules untouched).

**Bootstrap:** `query -- --import-zones --yes` replaces `zones[]` DNS; `--import-page-rules --yes` and `--import-email-routing --yes` merge rules on configured zones.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure cloudflare query --
node tools/hdc/cli.mjs run infrastructure cloudflare query -- --import-page-rules --yes
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --dry-run
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --zone dukk.org --prune
```

## Synology NAS in this repo

- **Config:** [`packages/infrastructure/synology-nas/config.json`](packages/infrastructure/synology-nas/config.json) (copy from [`config.example.json`](packages/infrastructure/synology-nas/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/nas-a.json`](inventory/manual/systems/nas-a.json), [`nas-b.json`](inventory/manual/systems/nas-b.json).
- **Schema:** [`tools/hdc/schema/synology-nas.config.schema.json`](tools/hdc/schema/synology-nas.config.schema.json).

| Verb | Summary |
| --- | --- |
| `query` | DSM version, volume `df`, `/proc/mdstat` RAID, disk enum, Docker/Container Manager status over SSH; JSON on stdout |
| `maintain` | Bootstrap SSH keys, ensure Container Manager/Docker (`synopkg` install/start when missing), `synoupgrade`, `synopkg upgradeall`; one NAS at a time; markdown report |

**Docker library (for other packages):** Import from `packages/infrastructure/synology-nas/lib/` — `ensureSynologyDocker`, `deployComposeStack`, `createSynologyExecContext`, `createSynologyDockerHostProvisioner` (`backendId: synology-docker`). Default compose root: `/volume1/docker` (`defaults.docker.compose_base_dir` in config). Maintain runs docker ensure when `maintain.docker_ensure` is true (default). `synopkg install` may require Package Center EULA on some DSM builds; install manually if unattended install fails.

**Prerequisite:** Enable SSH in DSM (Control Panel → Terminal & SNMP).

Vault: `HDC_SYNOLOGY_SSH_USER` (optional, default `admin` in config); `HDC_SYNOLOGY_SSH_PASSWORD_NAS_1`, `HDC_SYNOLOGY_SSH_PASSWORD_NAS_2` (required for first bootstrap unless pubkey already works).

Flags: `--instance a|b`, `--system-id nas-a`, `--skip-dsm-upgrade`, `--skip-package-upgrade`, `--skip-ssh-keys`, `--skip-docker-ensure`, `--dry-run`.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure synology-nas query --
node tools/hdc/cli.mjs run infrastructure synology-nas maintain --
```

## External reference: Proxmox VE Helper-Scripts

[community-scripts/ProxmoxVE](https://github.com/community-scripts/ProxmoxVE) — community one-command installers for LXC containers and VMs on Proxmox VE ([community-scripts.org](https://community-scripts.org)).

Use this collection as a **reference** when:

- Choosing self-hosted services or comparing default resource allocations.
- Understanding post-install helpers and common CT/VM patterns.
- Drafting new HDC service packages or manual runbooks.

**Do not** treat pasted install curls from that project as hdc automation. Prefer tracked packages under `packages/`, inventory sidecars, and `hdc run` for operations you want repeatable and documented in-repo.

## Secrets and safety

- Never commit `.env`, vault files, or secret values in chat, sidecars, or markdown.
- Store secrets via `node tools/hdc/cli.mjs secrets set <ENV_NAME>` (Vaultwarden when configured, else local `~/.hdc/vault.enc`); document only env var **names** in JSON `auth` fields.
- **Backends:** `HDC_SECRET_BACKEND` = `local` | `vaultwarden` | `auto` (default). Vaultwarden mode requires [Bitwarden CLI](docs/manually-deployed/bitwarden-cli.md) and `HDC_VAULTWARDEN_URL` + `HDC_VAULTWARDEN_EMAIL` in `.env`.
- See [`.env.example`](.env.example) for Proxmox, Nagios, Postfix relay, vault, and Vaultwarden backend variables.

## Testing

After changes under `tools/hdc/`:

```bash
npm install   # devDependencies only (Vitest)
npm run test
```

Before merging substantive CLI changes, run `npm run test:coverage` and keep thresholds green ([`vitest.config.mjs`](vitest.config.mjs)).

## Deeper context (pointers)

| Topic | Location |
| --- | --- |
| Automation conventions | [`.cursor/rules/hdc-automation.mdc`](.cursor/rules/hdc-automation.mdc) |
| Inventory naming | [`.cursor/rules/hdc-inventory-naming.mdc`](.cursor/rules/hdc-inventory-naming.mdc) |
| Nagios + manual docs | [`.cursor/rules/hdc-nagios-monitoring.mdc`](.cursor/rules/hdc-nagios-monitoring.mdc) |
| Operator workflow | [`.cursor/skills/hdc-ops/SKILL.md`](.cursor/skills/hdc-ops/SKILL.md), [`.cursor/agents/hdc-ops.md`](.cursor/agents/hdc-ops.md) |
| Human README | [README.md](README.md) |
