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
- **Secrets:** copy [`.env.example`](.env.example) to `.env` (gitignored) for **global** CLI settings (vault passphrase, secret backend, `HDC_PRIVATE_ROOT`, ops Discord, guest baseline). Package-specific env vars live in `packages/<tier>/<id>/.env` (see each package `.env.example`; prefer hdc-private). The root `.env.example` indexes all 96 packages; run `node tools/hdc/scripts/ensure-package-env-examples.mjs --write` after adding a package to scaffold its `.env.example`. Merge order: hdc public then hdc-private for each path. `hdc run` loads only global + the target package (and `env_includes`, auto-proxmox when config uses Proxmox). Migrate a monolithic root `.env` with `node tools/hdc/scripts/migrate-root-env.mjs --dry-run`. API keys and passwords prefer the encrypted vault at `~/.hdc/vault.enc` (see `secrets` commands below). Auth fields in inventory reference **env var names only**, never values.
- **hdc-private:** Clone the private repo beside hdc (`../hdc-private`) or set `HDC_PRIVATE_ROOT`. Package `config.json` and inventory JSON use the same paths; hdc checks the public repo first, then hdc-private. Seed package configs from examples: `node tools/hdc/scripts/bootstrap-hdc-private-configs.mjs` (skips existing files; `--force` to overwrite). On supported infrastructure packages, `query --import --yes` (or package-specific import flags such as Cloudflare `--import-zones`) auto-seeds missing `config.json` from `config.example.json` in hdc-private before importing live API data. Shared loaders: [`tools/hdc/lib/private-repo.mjs`](tools/hdc/lib/private-repo.mjs), [`tools/hdc/lib/package-config.mjs`](tools/hdc/lib/package-config.mjs).

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
    { "$hdc.include": "zones/example.invalid.json" }
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
| `maintain daily [--dry-run] [--skip-clients] [--skip-upgrades] [--only <tier>/<id>] [--skip <tier>/<id>]` | Cross-package daily orchestrator (non-destructive recipe; aggregated report) |
| `env` | Print `HDC_*` variables (sensitive values redacted) |

Examples:

```bash
node tools/hdc/cli.mjs list
node tools/hdc/cli.mjs run infrastructure proxmox query
node tools/hdc/cli.mjs run service pi-hole deploy -- --help
node tools/hdc/cli.mjs help run infrastructure proxmox maintain
node tools/hdc/cli.mjs maintain daily --dry-run
```

## Daily maintain

`node tools/hdc/cli.mjs maintain daily` runs a curated, **non-destructive** recipe across every package that has a resolved `config.json` (hdc-private or public). It skips prune operations, rolling restarts, and reboots; applies routine updates (Docker pull, guest apt, DSM packages) unless `--skip-upgrades` is set; runs **query only** on home clients (`windows`, `client-ubuntu`, `raspberrypi`).

- Recipe: [`tools/hdc/lib/daily-maintain-recipe.mjs`](tools/hdc/lib/daily-maintain-recipe.mjs)
- Orchestrator: [`tools/hdc/lib/daily-maintain.mjs`](tools/hdc/lib/daily-maintain.mjs)
- Report: `tools/hdc/reports/daily-maintain-<timestamp>.md` (under hdc-private when present)
- Continues on per-package failure; exit code `1` if any step failed

Schedule on the operator workstation (Task Scheduler, cron, or automation agent), for example daily at 03:00:

```bash
# Windows Task Scheduler action (repo root):
hdc.cmd maintain daily

# Linux/macOS cron:
0 3 * * * cd /path/to/hdc && ./hdc maintain daily >> ~/.hdc/daily-maintain.log 2>&1
```

Filter examples:

```bash
node tools/hdc/cli.mjs maintain daily -- --only infrastructure/proxmox
node tools/hdc/cli.mjs maintain daily -- --skip service/trivy --skip-upgrades
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
- **Infrastructure** (shared capabilities): `proxmox`, `unifi-network`, `ubuntu`, `synology-nas`, `cloudflare`, `cloudflare-workers`, `azure`, `azure-compute`, `gcp-oauth`, `gcp-compute`, `oci-compute`, `discord`, `twilio`, `smtp2go`, `openrouter`, `uptimerobot`.
- **Services** (apps on guests): e.g. `pi-hole`, `uptime-kuma`, `scanopy`, `yacy`, `searxng`, `gatus`, `open-webui`, `openspeedtest`, `vaultwarden`, `n8n`, `nextcloud`, `postiz`, `immich`, `plex`, `solidtime`, `stirling-pdf`, `nagios`, `homeassistant`, `bind`, `nginx`, `nginx-waf`, `kafka`, `cassandra`, `postgresql`, `splunk`, `step-ca`, `asterisk`, `jenkins`, `minecraft`, `ollama`, `lms`, `llama-cpp`, `postfix-relay`, `mailcow`, `audiobookshelf`, `listmonk`, `shlink`, `crowdsec`, `wazuh`, `trivy`, `wireguard`, `keycloak`, `greenbone`, `vikunja`, `paperless-ngx`, `paperclip`.
- **Clients** (home PCs/workstations): `windows`, `client-ubuntu`, `raspberrypi` under `packages/clients/` — per-package `config.json` (e.g. [`packages/clients/windows/config.json`](packages/clients/windows/config.json)). (`client-ubuntu` id avoids clash with infrastructure `ubuntu`.)

### Package script logging

When changing `packages/**/*.mjs`:

- **stderr** — user-visible progress, prompts, warnings.
- **stdout** — machine-only; on `query` / `deploy`, often a single JSON object at exit.
- **Secrets** — use `readLineQuestion(prompt, { mask: true })` from [`tools/hdc/lib/readline-masked.mjs`](tools/hdc/lib/readline-masked.mjs); never log tokens or passphrases.

See [`.cursor/rules/hdc-automation-logging.mdc`](.cursor/rules/hdc-automation-logging.mdc).

### Operation reports (deploy / maintain / teardown)

After `deploy`, `maintain`, or `teardown`, packages write a markdown report under `packages/<package>/reports/<verb>-<timestamp>.md` in **hdc-private when that repo is available** (sibling `../hdc-private` or `HDC_PRIVATE_ROOT`), otherwise under the public hdc tree (gitignored in both repos). Shared helpers: [`packages/lib/operation-report.mjs`](packages/lib/operation-report.mjs). Skip with `--no-report`; override path with `--report <path>`. `query` does not write reports.

### Guest baseline (hdc automation user, local admin + ClamAV)

Linux **Proxmox guest** `maintain` scripts apply a shared baseline via [`packages/lib/guest-linux-baseline.mjs`](packages/lib/guest-linux-baseline.mjs):

1. **`hdc` automation user** — fixed username `hdc`; per-system vault key `HDC_USER_HDC_PASSWORD_<SYSTEM_ID>` (auto-generated on first maintain when missing). Passwordless sudo via `/etc/sudoers.d/hdc-automation`. Operator `~/.ssh` public keys installed on `hdc`. Helpers: [`packages/lib/hdc-user-ensure.mjs`](packages/lib/hdc-user-ensure.mjs). Skip with `--skip-hdc-user` or `--skip-hdc-ssh-keys`.
2. **Local sudo admin** — username from `HDC_ADMIN_USER` in repo `.env`; password in vault as `HDC_ADMIN_USER_PASSWORD`. Helpers: [`packages/lib/admin-user-ensure.mjs`](packages/lib/admin-user-ensure.mjs), [`packages/lib/linux-local-admin-user.mjs`](packages/lib/linux-local-admin-user.mjs). Skip with `--skip-admin-user`.
3. **ClamAV** — install/enable via [`packages/lib/clamav-ensure.mjs`](packages/lib/clamav-ensure.mjs); profile from guest `memory_mb` (`lean` ≤3072: freshclam + oneshot `clamscan` only, no `clamd`; `standard` ≤8191: tuned `clamd`; `full`: Debian defaults). Daily staggered `clamscan` on `/home`, `/opt`, `/var` via [`packages/lib/clamav-scan-schedule.mjs`](packages/lib/clamav-scan-schedule.mjs). Skip with `--skip-clamav` or `--skip-clamav-scan`.
4. **Unattended-upgrades** — apt security updates via [`packages/lib/unattended-upgrades-ensure.mjs`](packages/lib/unattended-upgrades-ensure.mjs) (no auto-reboot). Skip with `--skip-unattended-upgrades`.
5. **Mail relay (Postfix satellite)** — forward local mail to the internal relay from [`packages/services/postfix-relay/config.json`](packages/services/postfix-relay/config.json) `client_defaults` (relay host `postfix-relay.home.example.invalid` / `192.0.2.60`, no per-guest SMTP2GO creds). Helpers: [`packages/lib/postfix-satellite-ensure.mjs`](packages/lib/postfix-satellite-ensure.mjs), [`packages/lib/mail-relay-config.mjs`](packages/lib/mail-relay-config.mjs). Skip with `--skip-mail-relay`. Auto-skipped on `postfix-relay-a` (the relay host itself).
6. **CrowdSec agent** — enroll to central LAPI from [`packages/infrastructure/proxmox/config.json`](packages/infrastructure/proxmox/config.json) `provision.guest_agents.crowdsec` + vault `HDC_CROWDSEC_ENROLL_KEY`. Skip with `--skip-crowdsec-agent`.
7. **Wazuh agent** — register to manager from `provision.guest_agents.wazuh` + vault `HDC_WAZUH_AGENT_PASSWORD`. Skip with `--skip-wazuh-agent`.
8. **Root SSH disabled** — when both `hdc` and admin user are ensured, lock root password and set `PermitRootLogin no` ([`packages/lib/root-login-disable.mjs`](packages/lib/root-login-disable.mjs)). Skip with `--skip-disable-root`.

**Guest SSH:** QEMU configure paths default to user `hdc` ([`packages/lib/guest-ssh-resolve.mjs`](packages/lib/guest-ssh-resolve.mjs)); override with `configure.ssh.user` or `HDC_GUEST_SSH_USER`. [`packages/lib/guest-ssh-exec.mjs`](packages/lib/guest-ssh-exec.mjs) probes `hdc` then falls back to `root` during migration and wraps non-root commands with `sudo -n`.

Hypervisor bootstrap hosts still use `node tools/hdc/cli.mjs users bootstrap-hdc` ([`tools/hdc/lib/users-bootstrap-hdc.mjs`](tools/hdc/lib/users-bootstrap-hdc.mjs)) — same vault key pattern and shared bash helpers.

Maintain JSON payloads should include `hdc_user`, `admin_user`, `clamav`, `clamav_scan_schedule`, `unattended_upgrades`, `crowdsec_agent`, `wazuh_agent`, `mail_relay` (when applicable), and `root_login_disabled` per instance via [`guestBaselineResultFields`](packages/lib/guest-baseline-report.mjs). **Maintain operation reports** add a **Guest baseline** section automatically when those fields are present.

- **Out of scope (guest baseline):** Proxmox hypervisors (mail relay via `proxmox maintain`), Synology NAS (`synology-nas`), home clients (mail relay via `client-* maintain`), `ubuntu maintain` (bootstrap `hdc` only), **Home Assistant** (HAOS), and **Windows** guests. **Nagios** LXC guests get the local admin user only (skips ClamAV, scan schedule, CrowdSec/Wazuh agents).
- **Stub services** (`minecraft`, `jenkins`, `audiobookshelf`): baseline when `config.json` defines SSH or LXC targets; otherwise reports that baseline was not applied.

Example: set `HDC_ADMIN_USER` in `.env`, then `node tools/hdc/cli.mjs run service postgresql maintain --`

## Asterisk in this repo

- **Config:** [`packages/services/asterisk/config.json`](packages/services/asterisk/config.json) (copy from [`config.example.json`](packages/services/asterisk/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/asterisk-a.json`](inventory/manual/systems/asterisk-a.json) (LXC), [`vm-asterisk-a.json`](inventory/manual/systems/vm-asterisk-a.json) (QEMU); service sidecar [`inventory/manual/services/asterisk.json`](inventory/manual/services/asterisk.json).
- **Schema:** [`tools/hdc/schema/asterisk.config.schema.json`](tools/hdc/schema/asterisk.config.schema.json).
- **Twilio examples:** [`packages/services/asterisk/examples/twilio/`](packages/services/asterisk/examples/twilio/).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC, QEMU, or configure-only: apt Asterisk (PJSIP), render Twilio trunk + dialplan (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--destroy-existing`, `--skip-provision`) |
| `maintain` | Re-push `pjsip.d` / `extensions.d` / `rtp.d` includes; optional apt upgrade (`--skip-package-upgrade`); guest Linux baseline |
| `query` | Config summary; `--live` for `systemctl` + `pjsip show endpoints` preview |
| `teardown` | Destroy LXC or QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Set `asterisk.twilio.termination_domain` from Twilio Elastic SIP Trunk; vault `HDC_TWILIO_SIP_USERNAME` / `HDC_TWILIO_SIP_PASSWORD`. Configure `asterisk.nat.external_*` to your WAN IP when behind NAT. Forward SIP (5060) and RTP (10000–20000) on the edge firewall — not via nginx-waf. Default outbound prefix: `9` + E.164.

Example: `node tools/hdc/cli.mjs run service asterisk deploy -- --instance a`

## Pi-hole in this repo

- **Config:** [`packages/services/pi-hole/config.json`](packages/services/pi-hole/config.json) (copy from [`config.example.json`](packages/services/pi-hole/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/pi-hole-a.json`](inventory/manual/systems/pi-hole-a.json), [`pi-hole-b.json`](inventory/manual/systems/pi-hole-b.json).
- **Schema:** [`tools/hdc/schema/pi-hole.config.schema.json`](tools/hdc/schema/pi-hole.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC provision + unattended Pi-hole install + allowlist sync (`deployments[]`; `--instance a` / `--system-id pi-hole-b`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-apply upstream/listening/local DNS + sync `pihole.allowlist[]` via `pihole allow`; gravity update + optional core update (`--skip-core-update`, `--skip-allowlist`, `--prune` removes allowlist entries not in config) |
| `query` | Per-instance status via `pct exec`; `--live` reports configured vs live allowlist counts |

Set blocklist exceptions in `defaults.pihole.allowlist[]` (strings or `{ "domain", "comment"? }`). Example bundle for Google Analytics: `marketingplatform.google.com`, `www.googletagmanager.com`, `www.google-analytics.com`, `analytics.google.com`. Not the same as `local_dns[]` custom A records.

Vault: `HDC_PIHOLE_WEBPASSWORD` (optional; deploy uses config `pihole.webpassword` today); `HDC_PIHOLE_API_TOKEN` optional for future API query.

## Uptime Kuma in this repo

- **Config:** [`packages/services/uptime-kuma/config.json`](packages/services/uptime-kuma/config.json) (copy from [`config.example.json`](packages/services/uptime-kuma/config.example.json); keep local config out of git). Optional **split layout:** keep `monitors/` and `status_pages/` folders beside `config.json` with one JSON object per file; root `config.json` lists `{ "$hdc.include": "monitors/<id>.json" }` entries (see [`config.example.json`](packages/services/uptime-kuma/config.example.json)). `query --import --yes` and `--import-from-homepage --yes` preserve split layout when detected; inline arrays remain supported.
- **Per-deployment (schema v5):** Root/`defaults` supply shared `monitors[]`, `tags[]`, `status_pages[]`, `notifications[]`, and `uptime_kuma_auth`. Each `deployments[]` entry may override `monitors` (replace), `notifications` (replace), and `uptime_kuma_auth` (deep-merge). Use separate monitor trees (e.g. `monitors-public/*.json`) and credentials per instance (`HDC_UPTIME_KUMA_PASSWORD_B`, …). `maintain` syncs notifications then monitors per selected deployment; `--skip-notifications` skips notification reconcile.
- **Modes:** `proxmox-lxc` (default) or `oci-vm` (Oracle Cloud via [`oci-compute`](packages/infrastructure/oci-compute/); SSH install, no guest Linux baseline). OCI instances use `uptime_kuma_auth.api_via_ssh: true` and `api_url: http://127.0.0.1:3001` — hdc opens an SSH local forward for Socket.IO sync (port 3001 not exposed on WAN).
- **Discord notifications:** `notifications[]` with `type: discord`, `discord_webhook_vault_key` (e.g. `HDC_OPS_DISCORD_WEBHOOK_URL`), `managed: true`, and `apply_to_monitors: true` (or per-monitor `notifications: ["id"]`).
- **Inventory:** [`inventory/manual/systems/uptime-kuma-a.json`](inventory/manual/systems/uptime-kuma-a.json), optional `uptime-kuma-b.json` (OCI); service sidecar [`inventory/manual/services/uptime-kuma.json`](inventory/manual/services/uptime-kuma.json).
- **Schema:** [`tools/hdc/schema/uptime-kuma.config.schema.json`](tools/hdc/schema/uptime-kuma.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC or `oci-vm`: install from GitHub release tarball (Node 22, Chromium, systemd on port 3001; `--instance a\|b`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Upgrade when `uptime_kuma.release` is behind latest; reconcile `notifications[]` then `monitors[]` via Socket.IO per deployment (`--skip-monitors`, `--skip-notifications`, `--prune`, `--dry-run`, `--monitor <id>`, `--instance`); `--skip-upgrade` for restart/health only |
| `query` | Guest `systemctl`/HTTP probe; monitor drift vs live (`--live`); `--import-from-homepage --yes` seeds `monitors[]` from homepage `services.yaml`; `--import --yes` pulls live monitors/tags/status pages into config (name/slug keyed; no UK database IDs) |
| `teardown` | Destroy LXC or `oci-compute` VM (`--dry-run`, `--yes`, `--instance`) |

Complete first-run admin setup in the web UI after deploy (OCI: SSH port-forward `ssh -L 3001:127.0.0.1:3001 ubuntu@<ip>`). Monitor automation uses per-deployment `HDC_UPTIME_KUMA_USERNAME` / vault password env keys. Uptime Kuma API keys are read-only (metrics) and cannot create monitors. Config schema v5 keys monitors by hdc `id` + `name`, tags by `name`, groups by `group`, status pages by `slug`, and notifications by hdc `id`; UK database IDs are resolved at sync/query time only.

Example:

```bash
node tools/hdc/cli.mjs run service uptime-kuma query -- --import-from-homepage --yes
node tools/hdc/cli.mjs run service uptime-kuma maintain -- --instance b
node tools/hdc/cli.mjs run infrastructure oci-compute deploy -- --resource uptime-kuma-b --dry-run
```

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

- **Config:** [`packages/services/bind/config.json`](packages/services/bind/config.json) (copy from [`config.example.json`](packages/services/bind/config.example.json); keep local config out of git). Authoritative zone records live in `zones/*.json` sidecars referenced from root `config.json` via `{ "$hdc.include": "zones/<id>.json" }` (inline `zones[]` in one file also works). Each zone object has `id`, `zone_type`, `records`, optional `subnet` for reverse, optional `cloudflare_fallback` to merge public records from [`packages/infrastructure/cloudflare/config.json`](packages/infrastructure/cloudflare/config.json) with local overrides. Set static `deployments[].proxmox.qemu.ip` per node; no guest `vmid` in config (auto-allocated at deploy). Recursive upstream: plain `bind.forwarders` (default `1.1.1.1`, `1.0.0.1`) or **ODoH** via `bind.forward_upstream.mode: "odoh"` (installs **dnscrypt-proxy** on each VM; BIND forwards to `listen`, default `127.0.0.1:5300`; Cloudflare target `odoh-cloudflare` + configurable `relay`, default `odohrelay-crypto-sx`). ODoH is experimental (RFC 9230).
- **Inventory:** [`inventory/manual/systems/vm-bind-a.json`](inventory/manual/systems/vm-bind-a.json), [`vm-bind-b.json`](inventory/manual/systems/vm-bind-b.json).
- **Schema:** [`tools/hdc/schema/bind.config.schema.json`](tools/hdc/schema/bind.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Rebuild QEMU guests from Ubuntu template (optional `--destroy-existing`), cloud-init static IP from config, auto VMID, optional `rootfs_gb` scsi0 resize, BIND primary then secondary (`deployments[]`; `--instance a\|b`) |
| `maintain` | Grow root disk when `defaults.proxmox.qemu.rootfs_gb` exceeds live size (`--skip-disk-resize`); re-push dnscrypt-proxy (ODoH) and named options (forwarders) on all nodes; re-render zone files on primary (timestamp SOA serial); verify SOA serial match on secondary; guest Linux baseline (local admin from `HDC_ADMIN_USER` + ClamAV; `--skip-admin-user`, `--skip-clamav`) |
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
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, optional `rootfs_gb` scsi0 resize, apt `step-cli`/`step-ca`, non-interactive `step ca init` when missing, systemd under `/etc/step-ca` (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-existing`) |
| `maintain` | Grow root disk when `defaults.proxmox.qemu.rootfs_gb` exceeds live size (`--skip-disk-resize`); re-push `ca.json` and password file, optional package upgrade, restart `step-ca` (omit `--skip-package-upgrade` to refresh packages) |

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

- **Config:** [`packages/services/nginx-waf/config.json`](packages/services/nginx-waf/config.json) (copy from [`config.example.json`](packages/services/nginx-waf/config.example.json); keep local config out of git). **Schema v4** uses `deployment_groups[]` with a **policy catalog** (`defaults.nginx_waf.policy_definitions` + site/location `policies[]`); v3 `waf` / `access.internal_only` auto-migrate at normalize time.
- **Inventory:** [`inventory/manual/systems/vm-nginx-waf-a.json`](inventory/manual/systems/vm-nginx-waf-a.json), [`vm-nginx-waf-b.json`](inventory/manual/systems/vm-nginx-waf-b.json); service sidecar [`inventory/manual/services/nginx-waf.json`](inventory/manual/services/nginx-waf.json).
- **Schema:** [`tools/hdc/schema/nginx-waf.config.schema.json`](tools/hdc/schema/nginx-waf.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Optional Proxmox QEMU provision or configure-only; install nginx, libmodsecurity3, ModSecurity-nginx, OWASP CRS; push group `sites[]`; ACME certs on each group's cert-primary + peer sync; default catch-all 404 vhost |
| `maintain` | Re-apply OWASP CRS profiles + push group sites/maps; `--renew-certs`; `--sync-certs`; `--site <id>` (cert scope only); `--group <id>`; full maintain prunes sites removed from config |
| `query` | `nginx` status, config test, ModSecurity module + CRS rule count + per-profile `SecRuleEngine`, policy types per site, rate-limit zones, cert expiry, upstream probes |

**Policies:** catalog refs (`modsecurity-default`, `internal-lan`, `block-exploits`, `hide-version`, …) or inline `{ "type": "…" }` on `sites[].policies[]` and `locations[].policies[]`. Location wins over site for the same policy type. **`trusted_cidrs`**: union match across named CIDR groups; per-site geo variable. **`cloudflare_origin`**: require `CF-Connecting-IP` on direct origin. **`rate_limit`**: shared `limit_req_zone` in `/etc/nginx/hdc/waf-maps.conf`.

**Sites:** `host_names[]` (legacy `server_names` accepted with warning); `upstream` as URL string or pool object (`method`, `servers[]`); optional `locations[].upstream`. **TLS:** enabled by default; `tls.http_redirect` (default true) controls HTTP→HTTPS redirect.

Vault: `HDC_NGINX_WAF_LETS_ENCRYPT_EMAIL` (required for Let's Encrypt deploy; legacy `HDC_NGINX_WAF_LE_EMAIL` still read with deprecation warning); `HDC_BIND_TSIG_KEY` when ACME uses **dns-01** (explicit challenge or http-01 fallback for names in `acme.dns.zone` only — Cloudflare DNS zones such as `brand-a.example` / `brand-b.example` use http-01 via proxy).

Example: `node tools/hdc/cli.mjs run service nginx-waf maintain -- --group edge`

## Nginx web hosting in this repo

- **Config:** [`packages/services/nginx/config.json`](packages/services/nginx/config.json) (copy from [`config.example.json`](packages/services/nginx/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-nginx-a.json`](inventory/manual/systems/vm-nginx-a.json); service sidecar [`inventory/manual/services/nginx.json`](inventory/manual/services/nginx.json).
- **Schema:** [`tools/hdc/schema/nginx.config.schema.json`](tools/hdc/schema/nginx.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Optional Proxmox QEMU provision or configure-only; install nginx + certbot; push `sites[]` (reverse proxy, same shape as nginx-waf without WAF); LE certs per node |
| `maintain` | Grow root disk when `defaults.proxmox.qemu.rootfs_gb` exceeds live size (`--skip-disk-resize`); re-push `sites[]` to all nodes (default); `--renew-certs`; `--site <id>` updates only that site (other vhosts unchanged); full maintain prunes sites removed from config |
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

## SearXNG in this repo

- **Config:** [`packages/services/searxng/config.json`](packages/services/searxng/config.json) (copy from [`config.example.json`](packages/services/searxng/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/searxng-a.json`](inventory/manual/systems/searxng-a.json); service sidecar [`inventory/manual/services/searxng.json`](inventory/manual/services/searxng.json).
- **Schema:** [`tools/hdc/schema/searxng.config.schema.json`](tools/hdc/schema/searxng.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (privileged, Docker) + official SearXNG Compose (`searxng` + `valkey`) in `/opt/searxng` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env` + `core-config/settings.yml`, `docker compose pull` + `up -d`; guest Linux baseline; `--skip-upgrade` skips image pull |
| `query` | Config summary; `--live` for Docker/HTTP probe on port 8080 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_SEARXNG_SECRET` (auto-generated on first deploy if missing). Internal LAN: browse `http://<ct-ip>:8080` (set `searxng.public_url` only when exposing via reverse proxy).

Example: `node tools/hdc/cli.mjs run service searxng deploy --`

## Immich in this repo

- **Config:** [`packages/services/immich/config.json`](packages/services/immich/config.json) (copy from [`config.example.json`](packages/services/immich/config.example.json); keep local config out of git).
- **Modes:** `synology-docker` (official compose on Synology via [`synology-nas`](packages/infrastructure/synology-nas/) lib; `system_id` `immich-a`, `synology.instance` `a`) or `proxmox-qemu` / `configure-only` (Ubuntu VM + SSH; `vm-immich-a`).
- **Inventory:** [`inventory/manual/systems/immich-a.json`](inventory/manual/systems/immich-a.json) (NAS Docker), optional [`vm-immich-a.json`](inventory/manual/systems/vm-immich-a.json); [`nas-a.json`](inventory/manual/systems/nas-a.json); service sidecar [`inventory/manual/services/immich.json`](inventory/manual/services/immich.json).
- **Schema:** [`tools/hdc/schema/immich.config.schema.json`](tools/hdc/schema/immich.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | **Synology:** fetch release compose, push `.env` + stack to `/volume1/docker/immich` (`synology-docker`). **Proxmox:** QEMU clone + SSH install (`proxmox-qemu`; `--destroy-existing`, `--skip-provision`, …) |
| `maintain` | Re-push `.env`, `docker compose pull` + `up -d` (omit `--skip-upgrade`); **admin sync** via `PUT /api/system-config` when `system_config`, `mail.enabled`, or `public_url` set (`--skip-admin-sync`, optional `--test-email`); ClamAV baseline on Proxmox guests only (`--skip-clamav`) |
| `query` | Config summary; `--live` for compose health + `/api/server/ping`; `--admin` / `--import --yes` for sanitized `system_config` drift vs live (requires API key; single `--system-id`) |
| `teardown` | Synology: `docker compose down`. Proxmox: optional compose down then destroy QEMU (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `immich.public_url` (e.g. `https://immich.example.invalid`) for `IMMICH_SERVER_URL` in `.env` and `server.externalDomain` on admin sync. **`immich.mail.enabled`:** maps internal postfix-relay SMTP into `notifications.smtp` (`postfix-relay.home.example.invalid:25`, no auth). **`immich.system_config`:** full sanitized admin config from `query --import`; maintain deep-merges over live before PUT. Synology: `upload_location` / `db_data_location` under `/volume1/docker/immich/`. Proxmox: optional `data_disk_gb`; pin `proxmox.qemu.vmid`, `ip`, `configure.ssh.host`.

**HTTPS:** nginx-waf `sites[]` upstream `http://<nas-ip>:2283`; Cloudflare A `immich` → WAF WAN IP. Prerequisite: `node tools/hdc/cli.mjs run infrastructure synology-nas maintain -- --instance a`.

Vault: `HDC_IMMICH_DB_PASSWORD` (required for deploy/maintain); `HDC_IMMICH_API_KEY` (admin API: `systemConfig.read` + `systemConfig.update` in Immich UI).

Example: `node tools/hdc/cli.mjs run service immich query -- --system-id vm-immich-a --import --yes`

## Plex in this repo

- **Config:** [`packages/services/plex/config.json`](packages/services/plex/config.json) (copy from [`config.example.json`](packages/services/plex/config.example.json); keep local config out of git).
- **Mode:** `synology-package` only — native DSM **PlexMediaServer** on [`nas-a`](inventory/manual/systems/nas-a.json) via `synology.instance` `a` (SSH through [`synology-nas`](packages/infrastructure/synology-nas/)).
- **Inventory:** [`inventory/manual/systems/plex-a.json`](inventory/manual/systems/plex-a.json); service sidecar [`inventory/manual/services/plex.json`](inventory/manual/services/plex.json); host [`nas-a.json`](inventory/manual/systems/nas-a.json) lists `services: [{ "id": "plex" }]`.
- **Schema:** [`tools/hdc/schema/plex.config.schema.json`](tools/hdc/schema/plex.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Adopt existing package: verify `PlexMediaServer` installed, start if stopped, HTTP probe on `:32400/identity` (`install.enabled: false` skips SPK install) |
| `maintain` | `synopkg upgrade PlexMediaServer`; `--skip-upgrade` for health check only |
| `query` | Config summary; `--live` for synopkg status + HTTP probe |
| `teardown` | `synopkg stop` only (`--yes`; package stays installed) |

First install remains manual in DSM (Package Center or `.spk` from Plex.tv). LAN UI: `http://192.0.2.9:32400/web`. No vault secrets for v1.

Example: `node tools/hdc/cli.mjs run service plex query -- --live`

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

## Globalping in this repo

- **Config:** [`packages/services/globalping/config.json`](packages/services/globalping/config.json) (copy from [`config.example.json`](packages/services/globalping/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/globalping-a.json`](inventory/manual/systems/globalping-a.json); service sidecar [`inventory/manual/services/globalping.json`](inventory/manual/services/globalping.json).
- **Schema:** [`tools/hdc/schema/globalping.config.schema.json`](tools/hdc/schema/globalping.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 512 MiB RAM, 8 GiB rootfs) + Docker Globalping probe (`globalping/globalping-probe:latest`, host network; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from vault; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `globalping-probe` container status |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Monitoring IP range: see **Monitoring** group in `hdc-private/operations/ip-allocations.md`. Vault: `HDC_GLOBALPING_ADOPTION_TOKEN` (Globalping dashboard adoption token → `GP_ADOPTION_TOKEN`). No nginx-waf — outbound probe only. Confirm adoption at https://dash.globalping.io/probes after deploy.

Example: `node tools/hdc/cli.mjs run service globalping deploy -- --instance a`

## CrowdSec in this repo

- **Config:** [`packages/services/crowdsec/config.json`](packages/services/crowdsec/config.json) (copy from [`config.example.json`](packages/services/crowdsec/config.example.json)).
- **Inventory:** [`inventory/manual/systems/crowdsec-a.json`](inventory/manual/systems/crowdsec-a.json); service sidecar [`inventory/manual/services/crowdsec.json`](inventory/manual/services/crowdsec.json).
- **Proxmox:** set `provision.guest_agents.crowdsec.lapi_url` to the CT IP + `crowdsec.lapi_port`; vault `HDC_CROWDSEC_ENROLL_KEY`.
- **Schema:** [`tools/hdc/schema/crowdsec.config.schema.json`](tools/hdc/schema/crowdsec.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC + CrowdSec LAPI (`deployments[]`; `--instance a`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Refresh collections; `--sync-bouncers` pushes nginx bouncer to `crowdsec.bouncers[]` systems |
| `query` | Config summary; `--live` for LAPI health |
| `teardown` | Destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_CROWDSEC_ENROLL_KEY` (agent enrollment); `HDC_CROWDSEC_BOUNCER_KEY` (nginx bouncer).

Example: `node tools/hdc/cli.mjs run service crowdsec deploy -- --instance a`

## Wazuh in this repo

- **Config:** [`packages/services/wazuh/config.json`](packages/services/wazuh/config.json) (copy from [`config.example.json`](packages/services/wazuh/config.example.json); keep local config out of git).
- **Modes:** `proxmox-lxc` (`wazuh-a`) or `proxmox-qemu` (`vm-wazuh-a` + `configure.ssh.host`).
- **Inventory:** [`inventory/manual/systems/wazuh-a.json`](inventory/manual/systems/wazuh-a.json) (LXC) or `vm-wazuh-a.json` (QEMU); service sidecar [`inventory/manual/services/wazuh.json`](inventory/manual/services/wazuh.json).
- **Proxmox:** `provision.guest_agents.wazuh.manager_host` → manager IP; vault `HDC_WAZUH_AGENT_PASSWORD`.
- **Schema:** [`tools/hdc/schema/wazuh.config.schema.json`](tools/hdc/schema/wazuh.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC or QEMU + Docker Compose Wazuh stack (`deployments[]`; `--instance a`; QEMU: `--destroy-existing`) |
| `maintain` | `docker compose pull` + `up -d`; guest Linux baseline (`--skip-wazuh-agent` on manager) |
| `query` | Config summary; `--live` for compose + dashboard probe |
| `teardown` | Optional compose down then destroy LXC or QEMU guest |

Vault: `HDC_WAZUH_API_PASSWORD`, `HDC_WAZUH_AGENT_PASSWORD`.

Example: `node tools/hdc/cli.mjs run service wazuh deploy -- --instance a`

## Trivy in this repo

- **Config:** [`packages/services/trivy/config.json`](packages/services/trivy/config.json) (copy from [`config.example.json`](packages/services/trivy/config.example.json)).
- **Inventory:** [`inventory/manual/systems/trivy-a.json`](inventory/manual/systems/trivy-a.json); service sidecar [`inventory/manual/services/trivy.json`](inventory/manual/services/trivy.json).
- **Schema:** [`tools/hdc/schema/trivy.config.schema.json`](tools/hdc/schema/trivy.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC + Trivy binary from GitHub release (`deployments[]`; `--instance a`) |
| `maintain` | Run `trivy` scans for `trivy.scan_targets[]` (SSH paths / docker compose dirs) |
| `query` | Config summary; `--live` for installed version |
| `teardown` | Destroy LXC |

No vault secrets for v1.

Example: `node tools/hdc/cli.mjs run service trivy maintain --`

## WireGuard in this repo

- **Config:** [`packages/services/wireguard/config.json`](packages/services/wireguard/config.json) (copy from [`config.example.json`](packages/services/wireguard/config.example.json)).
- **Inventory:** [`inventory/manual/systems/wireguard-a.json`](inventory/manual/systems/wireguard-a.json); service sidecar [`inventory/manual/services/wireguard.json`](inventory/manual/services/wireguard.json).
- **Schema:** [`tools/hdc/schema/wireguard.config.schema.json`](tools/hdc/schema/wireguard.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Privileged LXC hub + `wg0` from `wireguard.peers[]` |
| `maintain` | Re-push `/etc/wireguard/wg0.conf`; guest baseline |
| `query` | Config summary; `--live` for `wg show` |
| `teardown` | Destroy LXC |

Vault: `HDC_WIREGUARD_PRIVATE_KEY`; per-peer `HDC_WIREGUARD_PEER_*` keys from config. Publish UniFi UDP forward for `listen_port` (default 51820).

Example: `node tools/hdc/cli.mjs run service wireguard deploy --`

## Keycloak in this repo

- **Config:** [`packages/services/keycloak/config.json`](packages/services/keycloak/config.json) (copy from [`config.example.json`](packages/services/keycloak/config.example.json)).
- **Inventory:** [`inventory/manual/systems/keycloak-a.json`](inventory/manual/systems/keycloak-a.json); service sidecar [`inventory/manual/services/keycloak.json`](inventory/manual/services/keycloak.json).
- **Database:** `keycloak.database.mode`: `bundled` (Postgres in Compose) or `external` (shared [`postgresql`](packages/services/postgresql/) VM).
- **Schema:** [`tools/hdc/schema/keycloak.config.schema.json`](tools/hdc/schema/keycloak.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC + Docker Compose Keycloak (+ bundled Postgres when `database.mode` is `bundled`) |
| `maintain` | Re-push compose env; `docker compose pull` + `up -d`; guest baseline |
| `query` | Config summary; `--live` for HTTP health on `host_port` |
| `teardown` | Optional compose down then destroy LXC |

Vault: `HDC_KEYCLOAK_ADMIN_PASSWORD`; `HDC_KEYCLOAK_DB_PASSWORD` (bundled or external). Set `keycloak.external_url` before nginx-waf forward-auth wiring.

Example: `node tools/hdc/cli.mjs run service keycloak deploy --`

## Greenbone in this repo

- **Config:** [`packages/services/greenbone/config.json`](packages/services/greenbone/config.json) (copy from [`config.example.json`](packages/services/greenbone/config.example.json)).
- **Inventory:** [`inventory/manual/systems/greenbone-a.json`](inventory/manual/systems/greenbone-a.json); service sidecar [`inventory/manual/services/greenbone.json`](inventory/manual/services/greenbone.json).
- **Schema:** [`tools/hdc/schema/greenbone.config.schema.json`](tools/hdc/schema/greenbone.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Privileged LXC (8 GiB+ RAM) + Greenbone Community Edition Compose |
| `maintain` | Re-push compose/env, `docker compose pull` + `up -d`; guest baseline |
| `query` | Config summary; `--live` for compose + HTTPS admin probe |
| `teardown` | Optional compose down then destroy LXC |

Vault: `HDC_GREENBONE_ADMIN_PASSWORD`. First bootstrap may take a long time for NVT feed sync.

Example: `node tools/hdc/cli.mjs run service greenbone deploy --`

## Nagios in this repo

**Not deployed** (package and scripts retained for optional restore). Copy [`config.example.json`](packages/services/nagios/config.example.json) to hdc-private `config.json` and restore inventory sidecars to re-enable.

- **Config:** [`packages/services/nagios/config.example.json`](packages/services/nagios/config.example.json) (live config in hdc-private when deployed).
- **BIND source:** `bind_config_path` — forward-zone A records become Nagios hosts with PING checks.
- **Schema:** [`tools/hdc/schema/nagios.config.schema.json`](tools/hdc/schema/nagios.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC, apt `nagios4`, push generated config from BIND (`deployments[]`; `--instance a\|b\|c`) |
| `maintain` | Regenerate from BIND and push to instances |
| `query` | Deployment summary + BIND host counts; `--live` for systemd/config per CT |

Example: `node tools/hdc/cli.mjs run service nagios deploy -- --instance a`

## Hermes Agent in this repo

- **Config:** [`packages/services/hermes/config.json`](packages/services/hermes/config.json) (copy from [`config.example.json`](packages/services/hermes/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/hermes-a.json`](inventory/manual/systems/hermes-a.json); service sidecar [`inventory/manual/services/hermes.json`](inventory/manual/services/hermes.json).
- **Schema:** [`tools/hdc/schema/hermes.config.schema.json`](tools/hdc/schema/hermes.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU Ubuntu VM (default) or LXC + Docker Hermes Agent; Ollama primary via `config.yaml`, OpenRouter fallback, Discord bot token (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env`, `config.yaml`, `docker compose pull` + `up -d`; guest Linux baseline (`--skip-upgrade`, `--skip-clamav`, …) |
| `query` | Config summary; `--live` for Docker + dashboard HTTP on port 9119 |
| `teardown` | Optional compose down then destroy QEMU or LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `hermes.ollama_backends[]` to local Ollama HTTP APIs and `hermes.model.default` to a pulled model tag. `hermes.fallback_providers[]` uses OpenRouter when local inference fails. `hermes.discord.enabled` maps vault `HDC_HERMES_DISCORD_BOT_TOKEN` → `DISCORD_BOT_TOKEN` in compose `.env`.

Vault: prefer `HDC_HERMES_OPENROUTER_API_KEY`; falls back to `HDC_OPENROUTER_API_KEY`. `HDC_HERMES_DASHBOARD_PASSWORD` required; `HDC_HERMES_DISCORD_BOT_TOKEN` when Discord is enabled; `HDC_HERMES_DASHBOARD_AUTH_SECRET` auto-generated if missing.

Example: `node tools/hdc/cli.mjs run service hermes deploy -- --instance a`

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

**hdc secret backend:** When `HDC_VAULTWARDEN_URL` and `HDC_VAULTWARDEN_EMAIL` are set, `HDC_SECRET_BACKEND=auto` (default) routes `getSecret` / `secrets set` through **Bitwarden CLI (`bw`)** against Vaultwarden. Login items live in the **HDC organization** (`HDC_VAULTWARDEN_ORGANIZATION_ID` or name `HDC`) and **collection** (`HDC_VAULTWARDEN_COLLECTION_ID`); item names match env keys (`HDC_PROXMOX_API_TOKEN`, …). Bootstrap keys stay local only: `HDC_VAULTWARDEN_MASTER_PASSWORD`, `HDC_VAULTWARDEN_ADMIN_TOKEN`. Bulk migrate: `secrets push --force`. Unlock: masked master-password prompt, or `secrets unlock`. See [`docs/manually-deployed/bitwarden-cli.md`](docs/manually-deployed/bitwarden-cli.md).

Example: `node tools/hdc/cli.mjs run service vaultwarden deploy -- --instance a`

## Mailcow in this repo

- **Config:** [`packages/services/mailcow/config.json`](packages/services/mailcow/config.json) (copy from [`config.example.json`](packages/services/mailcow/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/mailcow-a.json`](inventory/manual/systems/mailcow-a.json) (LXC), [`vm-mailcow-a.json`](inventory/manual/systems/vm-mailcow-a.json) (QEMU); service sidecar [`inventory/manual/services/mailcow.json`](inventory/manual/services/mailcow.json).
- **Schema:** [`tools/hdc/schema/mailcow.config.schema.json`](tools/hdc/schema/mailcow.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC or QEMU: mailcow-dockerized clone + `generate_config.sh`; reconcile `domains[]` + DKIM + relay + `mailboxes[]` / `aliases[]` via Mailcow API; publish DKIM TXT to Cloudflare when token present (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--destroy-existing`, `--skip-provision` for QEMU, `--skip-domains`, `--skip-cloudflare-dkim`, `--skip-mailboxes`, `--skip-aliases`, `--prune`) |
| `maintain` | `docker compose pull` + `up -d`; reconcile `domains[]`, `mailboxes[]`, `aliases[]` via Mailcow API; publish DKIM TXT to Cloudflare (`--skip-domains`, `--skip-mailboxes`, `--skip-aliases`, `--skip-cloudflare-dkim`, `--skip-upgrade`, `--prune`, `--rotate-mailbox-passwords`); guest baseline with `--skip-mail-relay` |
| `query` | Config summary; `--live` for Docker/admin probe, domain/mailbox/alias drift, DNS checklist (MX/SPF/DKIM/DMARC) |
| `teardown` | Optional compose down then destroy LXC or QEMU (`--dry-run`, `--yes`, `--skip-compose-down`) |

QEMU: set `mode: proxmox-qemu`, `system_id: vm-mailcow-a`, `proxmox.qemu` (`template_vmid`, `ip`, `vmid`, optional `data_disk_gb` + `data_disk_storage`), `configure.ssh.host`. Data disk mounts at `/data/mailcow`; Docker data-root on the data mount when `data_disk_gb` > 0.

Set `mailcow.hostname` (MAILCOW_HOSTNAME FQDN), optional `mailcow.api_url` (defaults to `https://{hostname}`; `admin_url` is for browser UI via nginx-waf), and `mailcow.domains[]` with `outbound.mode`: `direct` (mailcow sends) or `postfix-relay` (internal smarthost from [`postfix-relay` config](packages/services/postfix-relay/config.json) `client_defaults`). Nest `mailboxes[]` (`local_part`, `name`, `quota_mb`, `password_vault_key`) and `aliases[]` (`address`, `goto[]`) under each domain. MX/SPF/DMARC: publish via BIND or [`cloudflare`](packages/infrastructure/cloudflare/) config. DKIM TXT: auto-published to Cloudflare when `HDC_CLOUDFLARE_API_TOKEN` is set and `mailcow.dns_publish.cloudflare_dkim` is not false.

Vault: `HDC_MAILCOW_DBPASS`, `HDC_MAILCOW_DBROOT`, `HDC_MAILCOW_REDISPASS` (auto-generated on first deploy if missing); `HDC_MAILCOW_API_KEY` (create in Mailcow admin after deploy; required for API reconciliation); per-mailbox `password_vault_key` values (auto-generated on first maintain when missing).

Example: `node tools/hdc/cli.mjs run service mailcow deploy -- --instance a --destroy-existing`

## Wallos in this repo

- **Config:** [`packages/services/wallos/config.json`](packages/services/wallos/config.json) (copy from [`config.example.json`](packages/services/wallos/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/wallos-a.json`](inventory/manual/systems/wallos-a.json); service sidecar [`inventory/manual/services/wallos.json`](inventory/manual/services/wallos.json).
- **Schema:** [`tools/hdc/schema/wallos.config.schema.json`](tools/hdc/schema/wallos.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 16 GiB rootfs) + Docker Wallos (`bellamy/wallos`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 8282) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1 — complete first-run admin setup in the web UI after deploy. `wallos.public_url` is optional (set when adding nginx-waf later). Data persists under `/opt/wallos/db` and `/opt/wallos/logos` on the CT.

Example: `node tools/hdc/cli.mjs run service wallos deploy -- --instance a`

## Memos in this repo

- **Config:** [`packages/services/memos/config.json`](packages/services/memos/config.json) (copy from [`config.example.json`](packages/services/memos/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/memos-a.json`](inventory/manual/systems/memos-a.json); service sidecar [`inventory/manual/services/memos.json`](inventory/manual/services/memos.json).
- **Schema:** [`tools/hdc/schema/memos.config.schema.json`](tools/hdc/schema/memos.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 16 GiB rootfs) + Docker Memos (`neosmemo/memos`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 5230) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1 — create the first account in the Memos web UI after deploy. `memos.public_url` is optional (set when adding nginx-waf later). Data persists under `/opt/memos/data` on the CT.

Example: `node tools/hdc/cli.mjs run service memos deploy -- --instance a`

## Rackula in this repo

- **Config:** [`packages/services/rackula/config.json`](packages/services/rackula/config.json) (copy from [`config.example.json`](packages/services/rackula/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/rackula-a.json`](inventory/manual/systems/rackula-a.json); service sidecar [`inventory/manual/services/rackula.json`](inventory/manual/services/rackula.json).
- **Schema:** [`tools/hdc/schema/rackula.config.schema.json`](tools/hdc/schema/rackula.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 8 GiB rootfs) + Docker Rackula with persistence (`rackula:persist` + `rackula-api`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml` + `.env`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Optional vault `HDC_RACKULA_API_WRITE_TOKEN` when `rackula.api_write_token_enabled` is true (API PUT/DELETE protection). LAN UI: `http://<ct-ip>:8080`. Layouts persist under `/opt/rackula/data` (UID 1001).

Example: `node tools/hdc/cli.mjs run service rackula deploy -- --instance a`

## OpenSpeedTest in this repo

- **Config:** [`packages/services/openspeedtest/config.json`](packages/services/openspeedtest/config.json) (copy from [`config.example.json`](packages/services/openspeedtest/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/openspeedtest-a.json`](inventory/manual/systems/openspeedtest-a.json); service sidecar [`inventory/manual/services/openspeedtest.json`](inventory/manual/services/openspeedtest.json).
- **Schema:** [`tools/hdc/schema/openspeedtest.config.schema.json`](tools/hdc/schema/openspeedtest.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 512 MiB RAM, 8 GiB rootfs) + Docker OpenSpeedTest (`openspeedtest/latest`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 3000) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1. LAN UI: `http://<ct-ip>:3000`. Optional `openspeedtest.public_url` when adding nginx-waf later.

Example: `node tools/hdc/cli.mjs run service openspeedtest deploy -- --instance a`

## IT-Tools in this repo

- **Config:** [`packages/services/it-tools/config.json`](packages/services/it-tools/config.json) (copy from [`config.example.json`](packages/services/it-tools/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/it-tools-a.json`](inventory/manual/systems/it-tools-a.json); service sidecar [`inventory/manual/services/it-tools.json`](inventory/manual/services/it-tools.json).
- **Schema:** [`tools/hdc/schema/it-tools.config.schema.json`](tools/hdc/schema/it-tools.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 512 MiB RAM, 8 GiB rootfs) + Docker IT-Tools (`corentinth/it-tools:latest`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1. LAN UI: `http://<ct-ip>:8080`. Optional `it_tools.public_url` when adding nginx-waf later.

Example: `node tools/hdc/cli.mjs run service it-tools deploy -- --instance a`

## Stirling PDF in this repo

- **Config:** [`packages/services/stirling-pdf/config.json`](packages/services/stirling-pdf/config.json) (copy from [`config.example.json`](packages/services/stirling-pdf/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/stirling-pdf-a.json`](inventory/manual/systems/stirling-pdf-a.json); service sidecar [`inventory/manual/services/stirling-pdf.json`](inventory/manual/services/stirling-pdf.json).
- **Schema:** [`tools/hdc/schema/stirling-pdf.config.schema.json`](tools/hdc/schema/stirling-pdf.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 24 GiB rootfs) + Docker Stirling PDF (`stirlingtools/stirling-pdf:latest`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from vault; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/api/v1/info/status` on `host_port` (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_STIRLING_PDF_ADMIN_PASSWORD` (initial admin login when `stirling_pdf.security.enable_login` is true). LAN UI: `http://<ct-ip>:8080`. Optional `stirling_pdf.public_url` when adding nginx-waf later (raise `client_max_body_size` for large PDF uploads).

Example: `node tools/hdc/cli.mjs run service stirling-pdf deploy -- --instance a`

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

## Listmonk in this repo

- **Config:** [`packages/services/listmonk/config.json`](packages/services/listmonk/config.json) (copy from [`config.example.json`](packages/services/listmonk/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/listmonk-a.json`](inventory/manual/systems/listmonk-a.json); service sidecar [`inventory/manual/services/listmonk.json`](inventory/manual/services/listmonk.json).
- **Schema:** [`tools/hdc/schema/listmonk.config.schema.json`](tools/hdc/schema/listmonk.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker Listmonk + PostgreSQL (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/api/health` on port 9000 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `listmonk.public_url` (`https://…`) when using nginx-waf; omit for HTTP on the CT IP only. Vault: `HDC_LISTMONK_ADMIN_PASSWORD` (required before deploy; creates super-admin on first `compose up`); `HDC_LISTMONK_DB_PASSWORD` (auto-generated on first deploy if missing). Optional `listmonk.mail.enabled` maps internal postfix-relay to `LISTMONK_smtp__main__*` env vars; otherwise configure SMTP in the Listmonk UI. After deploy, add BIND A record and nginx-waf `sites[]` upstream to `http://<ct-ip>:9000` when using a public hostname.

Example: `node tools/hdc/cli.mjs run service listmonk deploy -- --instance a`

## Shlink in this repo

- **Config:** [`packages/services/shlink/config.json`](packages/services/shlink/config.json) (copy from [`config.example.json`](packages/services/shlink/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/shlink-a.json`](inventory/manual/systems/shlink-a.json); service sidecar [`inventory/manual/services/shlink.json`](inventory/manual/services/shlink.json).
- **Schema:** [`tools/hdc/schema/shlink.config.schema.json`](tools/hdc/schema/shlink.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker Shlink + PostgreSQL + Redis + optional web client (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/rest/health` on port 8080 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `shlink.default_domain` and `shlink.public_url` (`https://…`) when using nginx-waf for short links and the REST API; set `shlink.web_client.public_url` for the admin UI. Vault: `HDC_SHLINK_DB_PASSWORD` and `HDC_SHLINK_INITIAL_API_KEY` (auto-generated on first deploy if missing); optional `HDC_SHLINK_GEOLITE_LICENSE_KEY` for visit geolocation. After deploy, add BIND A records and nginx-waf `sites[]` upstreams to `http://<ct-ip>:8080` (short/API) and `http://<ct-ip>:8081` (web client).

Example: `node tools/hdc/cli.mjs run service shlink deploy -- --instance a`

## Vikunja in this repo

- **Config:** [`packages/services/vikunja/config.json`](packages/services/vikunja/config.json) (copy from [`config.example.json`](packages/services/vikunja/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vikunja-a.json`](inventory/manual/systems/vikunja-a.json); service sidecar [`inventory/manual/services/vikunja.json`](inventory/manual/services/vikunja.json).
- **Schema:** [`tools/hdc/schema/vikunja.config.schema.json`](tools/hdc/schema/vikunja.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker Vikunja + PostgreSQL (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/api/v1/info` on port 3456 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `vikunja.public_url` (`https://…/` with trailing slash) when using nginx-waf. Vault: `HDC_VIKUNJA_JWT_SECRET` and `HDC_VIKUNJA_DB_PASSWORD` (auto-generated on first deploy if missing). Optional `vikunja.mail.enabled` maps internal postfix-relay to `VIKUNJA_MAILER_*` env vars. Register the first account in the Vikunja UI after deploy. nginx-waf upstream: `http://<ct-ip>:3456` with WebSockets enabled.

Example: `node tools/hdc/cli.mjs run service vikunja deploy -- --instance a`

## Paperless-ngx in this repo

- **Config:** [`packages/services/paperless-ngx/config.json`](packages/services/paperless-ngx/config.json) (copy from [`config.example.json`](packages/services/paperless-ngx/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/paperless-ngx-a.json`](inventory/manual/systems/paperless-ngx-a.json); service sidecar [`inventory/manual/services/paperless-ngx.json`](inventory/manual/services/paperless-ngx.json).
- **Schema:** [`tools/hdc/schema/paperless-ngx.config.schema.json`](tools/hdc/schema/paperless-ngx.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (4 vCPU, 6 GiB RAM, 64 GiB rootfs) + Docker Paperless-ngx + PostgreSQL + Redis; optional Tika/Gotenberg when `paperless_ngx.tika_enabled` is true (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` / `paperless.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on port 8000 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `paperless_ngx.public_url` (`https://…`) when using nginx-waf. Vault: `HDC_PAPERLESS_SECRET_KEY` and `HDC_PAPERLESS_DB_PASSWORD` (auto-generated on first deploy if missing). Optional `paperless_ngx.admin.enabled` + `HDC_PAPERLESS_ADMIN_PASSWORD` for first-boot superuser. Drop files in `/opt/paperless-ngx/consume` for automatic import. nginx-waf upstream: `http://<ct-ip>:8000` (consider larger `client_max_body_size` for uploads).

Example: `node tools/hdc/cli.mjs run service paperless-ngx deploy -- --instance a`

## Paperclip in this repo

- **Config:** [`packages/services/paperclip/config.json`](packages/services/paperclip/config.json) (copy from [`config.example.json`](packages/services/paperclip/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/paperclip-a.json`](inventory/manual/systems/paperclip-a.json); service sidecar [`inventory/manual/services/paperclip.json`](inventory/manual/services/paperclip.json).
- **Schema:** [`tools/hdc/schema/paperclip.config.schema.json`](tools/hdc/schema/paperclip.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (4 vCPU, 8 GiB RAM, 32 GiB rootfs) + Docker Paperclip + PostgreSQL from `ghcr.io/paperclipai/paperclip` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`); adopts live guest secrets into vault when they differ (no automatic volume wipe); `--reset-db --yes` destroys volumes for a full reset |
| `query` | Config summary; `--live` for Docker + `/api/health` on port 3100; `--bootstrap-company --yes` imports HDC skills and agents (see [`docs/manually-deployed/paperclip-hdc-company.md`](docs/manually-deployed/paperclip-hdc-company.md)) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Default deployment mode is **authenticated/private** (login required on LAN). Optional `paperclip.public_url` when adding nginx-waf later. Vault: `HDC_PAPERCLIP_BETTER_AUTH_SECRET` and `HDC_PAPERCLIP_DB_PASSWORD` (auto-generated on first deploy if missing); `HDC_PAPERCLIP_API_KEY` for company bootstrap. **HDC skills** under [`packages/services/paperclip/skills/`](packages/services/paperclip/skills/) integrate with **hdc-runner** (`HDC_HDC_RUNNER_API_TOKEN`). After deploy, open the LAN URL and **Claim this instance** in the browser for first admin (CLI fallback: `paperclipai auth bootstrap-ceo` in the server container). Pin `paperclip.image_tag` to a [GitHub release tag](https://github.com/paperclipai/paperclip/releases).

Example: `node tools/hdc/cli.mjs run service paperclip deploy -- --instance a`

## Home Assistant in this repo

- **Config:** [`packages/services/homeassistant/config.json`](packages/services/homeassistant/config.json) (copy from [`config.example.json`](packages/services/homeassistant/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-homeassistant-a.json`](inventory/manual/systems/vm-homeassistant-a.json); service sidecar [`inventory/manual/services/homeassistant.json`](inventory/manual/services/homeassistant.json).
- **Schema:** [`tools/hdc/schema/homeassistant.config.schema.json`](tools/hdc/schema/homeassistant.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU on configured host (e.g. `pve-h`): import HAOS OVA qcow2, USB passthrough for Zigbee/Z-Wave; when `public_url` is HTTPS, sync nginx-waf `trusted_proxies` into HAOS `configuration.yaml` (`deployments[]`; `--instance a`, `--destroy-existing`, `--usb-id`, `--no-wait-http`, `--skip-reverse-proxy`) |
| `maintain` | Sync nginx-waf `trusted_proxies` when `public_url` is HTTPS; HTTP probe on port 8123; `--reapply-usb` to refresh USB mapping; `--skip-reverse-proxy` to skip |
| `query` | Config summary; `--live` for Proxmox guest + HTTP probe |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Pin `homeassistant.release` (HAOS version). Set static IP in HA UI if deploy HTTP wait fails. When exposed via nginx-waf (`public_url` `https://…`), `deploy`/`maintain` write `http.trusted_proxies` for `vm-nginx-waf-a`/`vm-nginx-waf-b` LAN IPs (or `homeassistant.trusted_proxies[]` override). No vault secrets for v1.

Example: `node tools/hdc/cli.mjs run service homeassistant deploy -- --instance a --destroy-existing`

## Kali desktop in this repo

- **Config:** [`packages/services/kali-desktop/config.json`](packages/services/kali-desktop/config.json) (copy from [`config.example.json`](packages/services/kali-desktop/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-kali-a.json`](inventory/manual/systems/vm-kali-a.json); service sidecar [`inventory/manual/services/kali-desktop.json`](inventory/manual/services/kali-desktop.json).
- **Schema:** [`tools/hdc/schema/kali-desktop.config.schema.json`](tools/hdc/schema/kali-desktop.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Build Kali cloud-init QEMU template (`--build-template`; download + `virt-customize` on hypervisor), clone, cloud-init static IP (`deployments[]`; `--instance a`, `--destroy-existing`) |
| `maintain` | Guest Linux baseline, optional apt upgrade, CPU/RAM sync (`--skip-package-upgrade`, `--skip-clamav`) |
| `query` | Config summary; `--live` for guest agent + SSH |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Hypervisor prerequisites for template build: `libguestfs-tools`, `p7zip-full`. Vault: `HDC_KALI_DESKTOP_PASSWORD` (cloud-init password for user `kali`). Default image: Kali `qemu-amd64.7z` from `cdimage.kali.org`.

Example:

```bash
node tools/hdc/cli.mjs run service kali-desktop deploy -- --instance a --build-template
node tools/hdc/cli.mjs run service kali-desktop deploy -- --instance a
```

## Windows desktop in this repo

- **Config:** [`packages/services/windows-desktop/config.json`](packages/services/windows-desktop/config.json) (copy from [`config.example.json`](packages/services/windows-desktop/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/vm-win11-a.json`](inventory/manual/systems/vm-win11-a.json); service sidecar [`inventory/manual/services/windows-desktop.json`](inventory/manual/services/windows-desktop.json).
- **Schema:** [`tools/hdc/schema/windows-desktop.config.schema.json`](tools/hdc/schema/windows-desktop.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | **Template:** `--build-template` — verified ISO install + Sysprep + Proxmox template on configured `proxmox.template.vmid`. **Instance:** `proxmox-qemu-clone` (default) full clone + specialize autounattend + OEM MSDM/SLIC; or `proxmox-qemu-iso` one-shot ISO install. OVMF/TPM/VirtIO; `disk_format: raw` on `local-lvm` (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-oem`, `--skip-install`, `--wait-install`, `--refresh-iso`, `--force-rebuild-template`) |
| `maintain` | Re-dump and re-apply OEM ACPI tables + SMBIOS on the guest |
| `query` | Config summary; `--live` for VM power state and OEM probe on hypervisor |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_WINDOWS_DESKTOP_ADMIN_PASSWORD` (required). Windows + virtio-win ISOs on the node (`proxmox.iso.windows_volid`, `virtio_volid`); optional `download_url` + `sha256` verify. VirtIO URL: `…/stable-virtio/virtio-win.iso`. **One** OEM-licensed Windows VM per hypervisor (OEM on clone deploy, not template builder).

Examples:

```bash
node tools/hdc/cli.mjs run service windows-desktop deploy -- --build-template --destroy-existing --wait-install
node tools/hdc/cli.mjs run service windows-desktop deploy -- --instance a --wait-install
```

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
- **Inventory:** optional [`inventory/manual/systems/llama-cpp-{a,b}.json`](inventory/manual/systems/) (LXC) or `vm-llama-cpp-a.json` (QEMU GPU).
- **Schema:** [`tools/hdc/schema/llama-cpp.config.schema.json`](tools/hdc/schema/llama-cpp.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC or QEMU + `llama-server` from GitHub releases (`deployments[]`; per-deployment `install.backend`: cpu/cuda/vulkan/rocm; `--instance a`; QEMU: `--destroy-existing`, `--skip-provision`) |
| `maintain` | Upgrade binary to latest/pinned release and restart `llama-server`; guest Linux baseline on QEMU/LXC (`--skip-restart` optional) |
| `query` | Config summary; `--live` for systemd/health (LXC via `pct exec`, QEMU via SSH; GPU name when CUDA) |
| `teardown` | Destroy LXC or QEMU guests (`--dry-run`, `--yes`, `--instance`) |

**QEMU GPU (`vm-llama-cpp-a`):** `mode: proxmox-qemu`, `proxmox.qemu.hostpci[]`, `install.backend: vulkan` (or `cuda` if you build from source — upstream no longer ships Ubuntu CUDA tarballs). Installs NVIDIA drivers in guest for GPU passthrough. Complete VFIO/IOMMU on the Proxmox host before deploy; PCI BDF from `lspci`.

Set `server.model` or `server.hf_model` in config to enable and start the unit at deploy; otherwise install leaves the service disabled until a model is configured.

Example: `node tools/hdc/cli.mjs run service llama-cpp deploy -- --instance a --destroy-existing`

## HDC Runner in this repo

- **Config:** [`packages/services/hdc-runner/config.json`](packages/services/hdc-runner/config.json) (copy from [`config.example.json`](packages/services/hdc-runner/config.example.json); keep local config out of git).
- **Inventory:** [`inventory/manual/systems/hdc-runner-a.json`](inventory/manual/systems/hdc-runner-a.json); service sidecar [`inventory/manual/services/hdc-runner.json`](inventory/manual/services/hdc-runner.json).
- **Schema:** [`tools/hdc/schema/hdc-runner.config.schema.json`](tools/hdc/schema/hdc-runner.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC or QEMU: Node.js + Bitwarden CLI, rsync hdc + hdc-private from operator, cron schedules, guest baseline (mail relay; skips ClamAV), web UI systemd unit |
| `maintain` | Rsync operator trees to guest; refresh `.env` (Vaultwarden master password + web UI secrets from operator vault), cron, job wrapper, web UI; `--skip-sync`, `--skip-ui`, `--prune`, `--dry-run` |
| `query` | Deployment summary; `--live` for cron files, bw version, disk use, recent job logs, web UI health |
| `teardown` | Destroy LXC or QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Set `hdc_runner.schedules[]` with `cron`, `cli`, `cli_args`, and optional per-job `mail` / `discord`. **`hdc_runner.web`:** LAN web UI on port 9120 (default); session auth via vault `HDC_HDC_RUNNER_UI_PASSWORD` and auto-generated `HDC_HDC_RUNNER_UI_SESSION_SECRET`; **Bearer token** via vault `HDC_HDC_RUNNER_API_TOKEN` for Paperclip agents; optional `allowed_schedule_ids` / `allowed_packages` policy. Ad-hoc runs limited to `query` and `maintain`. API reference: [`packages/services/hdc-runner/API.md`](packages/services/hdc-runner/API.md). **`hdc_runner.paperclip_bridge`:** HTTP adapter bridge on port 9121 for Paperclip heartbeat → schedule runs. Browse `http://<guest-ip>:9120` after maintain.

Operator workstation is source of truth (rsync on maintain). Secrets: `HDC_SECRET_BACKEND=vaultwarden`, `bw` on guest, `HDC_VAULTWARDEN_MASTER_PASSWORD` in guest `.env` (pushed from operator vault). Reports email as HTML via postfix-relay; Discord ops alerts use vault `HDC_OPS_DISCORD_WEBHOOK_URL` (#hdc-ops webhook in Vaultwarden collection). Discord messages include the host running hdc (`HDC_OPS_DISCORD_HOST` optional); scheduled job success posts are silent (no channel ping), failures ping.

Example: `node tools/hdc/cli.mjs run service hdc-runner maintain --`

## Home clients in this repo

- **Config:** per-package `config.json` under `packages/clients/{windows,ubuntu,raspberrypi}/` (copy from each `config.example.json`; keep local config out of git).
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

**WinRM bootstrap:** When port 5986 is not open, `maintain`/`query` can run Sysinternals **PsExec** on the operator Windows host (current logon must be remote admin) to enable WinRM + HTTPS listener. Config: `winrm_bootstrap` in [`packages/clients/windows/config.json`](packages/clients/windows/config.json); env `HDC_PSEXEC_PATH`. See [`docs/manually-deployed/client-winrm.md`](docs/manually-deployed/client-winrm.md).

Vault: `HDC_WINRM_USER_PASSWORD` (shared WinRM password); optional per-host `HDC_WINRM_PASSWORD_<SUFFIX>` via `winrm_password_vault_suffix`. Env: `HDC_WINRM_USER` (MSA: `MicrosoftAccount\email@domain.com`; local: `.\user`; Entra: `AzureAD\UPN`). Per-host username override: `auth.winrm_user` or `auth.winrm_user_env`. Env: `HDC_CLIENT_SSH_USER`.

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
| `verify-templates` | maintain | SSH keys, no-subscription APT sources and subscription nag removal, host firewall (SSH/8006 to allowed LANs), API token ACL, templates, NAS storage, scheduled backup jobs, storage replication jobs, HA groups/resources, guest startup order (`provision.startup`; `--skip-startup`), host OS updates, OEM Windows SLIC/MSDM license reporting, configured load report, QEMU guest agent (config + ping), markdown report under `packages/infrastructure/proxmox/reports/` |
| `cluster-snapshot` | query | Cluster/guest inventory JSON on stdout |

Bootstrap the local `hdc` user on Ubuntu/bootstrap hosts with `run infrastructure ubuntu maintain` or `users bootstrap-hdc` — not from `proxmox maintain`.

**QEMU guest agent:** Deploy scripts enable `agent=1` on new QEMU VMs and install `qemu-guest-agent` in Linux guests when deploy has SSH (e.g. BIND). LXC deploys are unchanged. See [`.cursor/rules/proxmox-qemu-guest-agent.mdc`](.cursor/rules/proxmox-qemu-guest-agent.mdc). Maintain `verify-templates` reports agent config + ping.

**Guest root disk expansion (opt-in):** Pass `--expand-guest-rootfs` on `proxmox maintain` to probe `/` on running Linux LXC/QEMU guests and expand root disks in 8 GiB steps until used space is below 50% (defaults from `provision.guest_rootdisk` in config). Skips Windows/HAOS name patterns and guests without a working probe (LXC `pct exec`, QEMU guest agent, or inventory SSH). Optional `--guest-rootfs-threshold`, `--guest-rootfs-increment-gb`, `--dry-run`. Does not update per-service `rootfs_gb` in package configs.

```bash
node tools/hdc/cli.mjs run infrastructure proxmox maintain -- --expand-guest-rootfs --dry-run
node tools/hdc/cli.mjs run infrastructure proxmox maintain -- --expand-guest-rootfs
```

**QEMU first-boot SSH wait:** Ubuntu cloud templates use `serial0: socket` / `vga: serial0`; clones can hang at the serial console on first boot. Deploy and maintain use [`qemu-guest-ssh-wait.mjs`](packages/lib/qemu-guest-ssh-wait.mjs): optional settle delay, short SSH probe, then Proxmox API reboot if the probe fails. Tune `provision.qemu.first_boot` in proxmox config; flags: `--skip-first-boot-reboot`, `--first-boot-reboot`.

**Guest CPU/RAM:** QEMU clones and LXC creates apply `proxmox.qemu` / `proxmox.lxc` `memory_mb` and `cores` after the Proxmox task completes (template sizing is not kept when config differs). **Service maintain** syncs the same fields on live guests without destroy (QEMU reboot when running and sizing changed; LXC stop/PUT/start). Shared helpers: [`proxmox-guest-resources.mjs`](packages/infrastructure/proxmox/lib/proxmox-guest-resources.mjs), [`proxmox-guest-resources-maintain.mjs`](packages/lib/proxmox-guest-resources-maintain.mjs) (via [`guest-linux-baseline.mjs`](packages/lib/guest-linux-baseline.mjs) for Proxmox guests). Flags: `--skip-resources`, `--no-reboot` (disable auto-reboot on change); `--reboot` forces reboot. Infrastructure deploy: `create-vm` / `create-container` accept `--memory-mb`, `--cores`, and `--reboot`. Service deploy: optional `--reboot` when resizing a running guest.

**Resource planning** (CPU, RAM, storage, bridges): follow [`.cursor/skills/proxmox-resource-planning/SKILL.md`](.cursor/skills/proxmox-resource-planning/SKILL.md) and [`.cursor/rules/proxmox-resource-planning.mdc`](.cursor/rules/proxmox-resource-planning.mdc).

## Azure compute in this repo

- **Config:** [`packages/infrastructure/azure-compute/config.json`](packages/infrastructure/azure-compute/config.json) (copy from [`config.example.json`](packages/infrastructure/azure-compute/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/azure-compute.config.schema.json`](tools/hdc/schema/azure-compute.config.schema.json).
- **Docs:** [`docs/manually-deployed/azure-compute.md`](docs/manually-deployed/azure-compute.md).

| Verb | Summary |
| --- | --- |
| `deploy` | Azure VM or ACI from `deployments[]`; cost estimate (Retail Prices API) + confirmation before provision (`--dry-run`, `--yes`, `--accept-unknown-cost`) |
| `maintain` | Reconcile tags / ACI; cost confirm on container reconcile |
| `query` | Config summary; `--live` for ARM state + cost snapshot |
| `teardown` | Destroy VM or ACI (`--dry-run`, `--yes`) |

Env: `HDC_AZURE_COMPUTE_SUBSCRIPTION_ID`, `HDC_AZURE_COMPUTE_TENANT_ID`, `HDC_AZURE_COMPUTE_CLIENT_ID`. Vault: `HDC_AZURE_COMPUTE_CLIENT_SECRET`. Modes: `azure-vm`, `azure-aci`. HostProvisioner: [`azure-compute-host-provisioner.mjs`](packages/infrastructure/azure-compute/lib/azure-compute-host-provisioner.mjs).

Example: `node tools/hdc/cli.mjs run infrastructure azure-compute deploy -- --instance a --dry-run`

## GCP compute in this repo

- **Config:** [`packages/infrastructure/gcp-compute/config.json`](packages/infrastructure/gcp-compute/config.json) (copy from [`config.example.json`](packages/infrastructure/gcp-compute/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/gcp-compute.config.schema.json`](tools/hdc/schema/gcp-compute.config.schema.json).
- **Docs:** [`docs/manually-deployed/gcp-compute.md`](docs/manually-deployed/gcp-compute.md).

| Verb | Summary |
| --- | --- |
| `deploy` | GCE VM or Cloud Run from `deployments[]`; cost estimate + confirmation before provision |
| `maintain` | Reconcile labels / Cloud Run revision; cost confirm on serverless reconcile |
| `query` | Config summary; `--live` for API state + cost snapshot |
| `teardown` | Destroy VM or Cloud Run service (`--dry-run`, `--yes`) |

Env: `HDC_GCP_COMPUTE_PROJECT_ID`. Vault: `HDC_GCP_COMPUTE_SERVICE_ACCOUNT_JSON`. Modes: `gcp-vm`, `gcp-cloud-run`. HostProvisioner: [`gcp-compute-host-provisioner.mjs`](packages/infrastructure/gcp-compute/lib/gcp-compute-host-provisioner.mjs).

Example: `node tools/hdc/cli.mjs run infrastructure gcp-compute deploy -- --instance a --dry-run`

## Oracle Cloud compute in this repo

- **Config:** [`packages/infrastructure/oci-compute/config.json`](packages/infrastructure/oci-compute/config.json) (copy from [`config.example.json`](packages/infrastructure/oci-compute/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/oci-compute.config.schema.json`](tools/hdc/schema/oci-compute.config.schema.json).
- **Docs:** [`docs/manually-deployed/oci-compute.md`](docs/manually-deployed/oci-compute.md).

| Verb | Summary |
| --- | --- |
| `deploy` | VCN + subnet + NSG + Compute VM / Container Instance; cost estimate + confirmation before billable creates (`--dry-run`, `--yes`, `--resource <id>`) |
| `maintain` | Reconcile drift; optional `--prune` removes live HDC-tagged resources not in config |
| `query` | Config summary; `--live` for OCI state + planned actions |
| `teardown` | Destroy by `--resource <id>`, `--instance <id>`, or `--all` (`--dry-run`, `--yes`) |

Env: `HDC_OCI_TENANCY_OCID`, `HDC_OCI_USER_OCID`, `HDC_OCI_FINGERPRINT`, `HDC_OCI_REGION`. Vault: `HDC_OCI_API_PRIVATE_KEY`. HostProvisioner: [`oci-compute-host-provisioner.mjs`](packages/infrastructure/oci-compute/lib/oci-compute-host-provisioner.mjs) (`oci-vm`, `oci-container` modes).

Example: `node tools/hdc/cli.mjs run infrastructure oci-compute deploy -- --dry-run`

## AWS infrastructure in this repo

- **Config:** [`packages/infrastructure/aws/config.json`](packages/infrastructure/aws/config.json) (copy from [`config.example.json`](packages/infrastructure/aws/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/aws.config.schema.json`](tools/hdc/schema/aws.config.schema.json).
- **Docs:** [`docs/manually-deployed/aws.md`](docs/manually-deployed/aws.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff VPC, subnets, security groups, IAM, EC2, EBS, S3, ECS vs config; `--import --yes` writes hdc-private snapshot |
| `deploy` | Plan → monthly cost estimate → operator confirm → create managed resources (`--dry-run`, `--yes`, `--skip-cost-confirm`) |
| `maintain` | Reconcile drift; billable creates trigger cost gate; `--prune` removes live resources not in config |
| `teardown` | Destroy by `--resource <id>` or `--all` (`--yes` required non-interactive) |

Env: `HDC_AWS_ACCESS_KEY_ID` in `.env`. Vault: `HDC_AWS_SECRET_ACCESS_KEY` (required); optional `HDC_AWS_SESSION_TOKEN`. Deploy/maintain write **Cost estimate** sections to operation reports via [`packages/lib/cost-report.mjs`](packages/lib/cost-report.mjs).

Service packages may use `aws-ec2` / `aws-ecs` deploy modes (pilot: **scanopy**) via [`packages/infrastructure/aws/lib/aws-host-provisioner.mjs`](packages/infrastructure/aws/lib/aws-host-provisioner.mjs).

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure aws query --
node tools/hdc/cli.mjs run infrastructure aws deploy -- --dry-run
node tools/hdc/cli.mjs run infrastructure aws deploy -- --yes
node tools/hdc/cli.mjs run infrastructure aws maintain --
```

## Azure app registrations in this repo

- **Config:** [`packages/infrastructure/azure/config.json`](packages/infrastructure/azure/config.json) (copy from [`config.example.json`](packages/infrastructure/azure/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/azure.config.schema.json`](tools/hdc/schema/azure.config.schema.json).
- **Docs:** [`docs/manually-deployed/azure.md`](docs/manually-deployed/azure.md).

| Verb | Summary |
| --- | --- |
| `query` | Discover tenant app registrations, diff vs config, `suggested_config_entry` for import (JSON on stdout) |
| `deploy` | Create managed apps missing from the tenant; ensure enterprise service principal |
| `maintain` | Patch managed apps when redirect URIs, API permissions, or audience drift from config |

Env: `HDC_AZURE_TENANT_ID`, `HDC_AZURE_CLIENT_ID`. Vault: `HDC_AZURE_CLIENT_SECRET` (automation app only). Does not create or rotate secrets on managed applications.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure azure query --
node tools/hdc/cli.mjs run infrastructure azure query -- --import --yes
node tools/hdc/cli.mjs run infrastructure azure deploy -- --dry-run
node tools/hdc/cli.mjs run infrastructure azure maintain --
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
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --zone example.invalid --prune
```

## Cloudflare Workers and Pages in this repo

- **Config:** [`packages/infrastructure/cloudflare-workers/config.json`](packages/infrastructure/cloudflare-workers/config.json) (copy from [`config.example.json`](packages/infrastructure/cloudflare-workers/config.example.json); keep local config and project trees in hdc-private).
- **Schema:** [`tools/hdc/schema/cloudflare-workers.config.schema.json`](tools/hdc/schema/cloudflare-workers.config.schema.json).
- **Docs:** [`docs/manually-deployed/cloudflare-workers.md`](docs/manually-deployed/cloudflare-workers.md).

| Verb | Summary |
| --- | --- |
| `query` | List Workers scripts, routes, Pages projects; diff vs config; `--import --yes` bootstraps `workers[]` / `pages[]` (JSON on stdout) |
| `deploy` | `wrangler deploy` / `wrangler pages deploy` per managed entry; push secrets from vault via API |
| `maintain` | Sync routes + secrets from config; optional `--redeploy` to refresh code |
| `teardown` | `wrangler delete` / `wrangler pages project delete` (`--yes` required) |

Token: `HDC_CLOUDFLARE_API_TOKEN` (shared with DNS package). Account id: `HDC_CLOUDFLARE_ACCOUNT_ID` or `cloudflare_workers.account_id` (required). Install **wrangler** v4+ globally or per project.

Project source lives under hdc-private `packages/infrastructure/cloudflare-workers/workers/<id>/` and `pages/<id>/`.

Example: `node tools/hdc/cli.mjs run infrastructure cloudflare-workers deploy -- --worker waitlist-mailer`

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

## SMTP2GO in this repo

- **Config:** [`packages/infrastructure/smtp2go/config.json`](packages/infrastructure/smtp2go/config.json) (copy from [`config.example.json`](packages/infrastructure/smtp2go/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/smtp2go.config.schema.json`](tools/hdc/schema/smtp2go.config.schema.json).
- **Docs:** [`docs/manually-deployed/smtp2go.md`](docs/manually-deployed/smtp2go.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff sender domains, IP allowlist, and allowed senders vs config; DNS checklists on stdout; `--import --yes` writes live snapshot to hdc-private config |
| `maintain` | Add missing managed sender domains; trigger `/domain/verify` when DKIM or return-path unverified; sync managed `ip_allow_list` and `allowed_senders` |

Vault: `HDC_SMTP2GO_API_KEY` (API). Postfix relay SMTP user/password remain in **postfix-relay** (`HDC_POSTFIX_RELAY_SMTP_*`). This package does not publish DNS — apply `dns_checklist` via cloudflare or bind manually.

**Import:** `--import --yes` replaces `sender_domains[]`, `ip_allow_list`, and `allowed_senders` from live API data. HDC-local sender-domain fields (`notes`, `spf`, `dmarc`, `spf_variant`) are not pulled from SMTP2GO; re-import preserves them when the FQDN already existed in config.

**Restrict Senders:** `allowed_senders.mode` of `whitelist` or `blacklist` disables SMTP2GO Sender Domains. Default to `disabled` when using verified sender domains.

**API key permissions:** sender domain (`/domain/*`), IP allowlist (`/ip_allow_list*`), allowed senders (`/allowed_senders/*`).

**Bootstrap:** `query -- --import --yes` replaces live sections; set `managed: true` on sender domains and restriction sections before `maintain`.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure smtp2go query --
node tools/hdc/cli.mjs run infrastructure smtp2go query -- --import --yes
node tools/hdc/cli.mjs run infrastructure smtp2go maintain --
node tools/hdc/cli.mjs run infrastructure smtp2go maintain -- --prune
node tools/hdc/cli.mjs run infrastructure smtp2go maintain -- --skip-ip-allow-list
```

## OpenRouter in this repo

- **Config:** [`packages/infrastructure/openrouter/config.json`](packages/infrastructure/openrouter/config.json) (copy from [`config.example.json`](packages/infrastructure/openrouter/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/openrouter.config.schema.json`](tools/hdc/schema/openrouter.config.schema.json).
- **Docs:** [`docs/manually-deployed/openrouter.md`](docs/manually-deployed/openrouter.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff credits and API keys vs config; per-key inference usage via `GET /key`; `--import --yes` writes live snapshot to hdc-private config |
| `maintain` | Create or update managed inference API keys; optional `--prune` removes live keys not in config |

Vault: `HDC_OPENROUTER_MANAGEMENT_API_KEY` (Management API). Consumers use separate inference keys (e.g. `HDC_HERMES_OPENROUTER_API_KEY` for **hermes**).

**Bootstrap:** `query -- --import --yes` replaces `api_keys[]`; set `managed: true` before `maintain`.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure openrouter query --
node tools/hdc/cli.mjs run infrastructure openrouter query -- --import --yes
node tools/hdc/cli.mjs run infrastructure openrouter maintain --
node tools/hdc/cli.mjs run infrastructure openrouter maintain -- --key-id hermes --dry-run
```

## Discord in this repo

- **Config:** [`packages/infrastructure/discord/config.json`](packages/infrastructure/discord/config.json) (copy from [`config.example.json`](packages/infrastructure/discord/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/discord.config.schema.json`](tools/hdc/schema/discord.config.schema.json).
- **Docs:** [`docs/manually-deployed/discord.md`](docs/manually-deployed/discord.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff Developer applications vs config per bot token; `--import --yes` merges live metadata into hdc-private config |
| `maintain` | PATCH managed apps for API-supported fields; prints Developer Portal checklist for privileged intents |

Vault: per-app `bot_token_vault_key` (e.g. `HDC_HERMES_DISCORD_BOT_TOKEN` for Hermes — shared with **hermes** compose). Discord has no API to list or create applications; declare each app in `applications[]` after creating it in the Developer Portal.

**Bootstrap:** `query -- --import --yes` after bot tokens are in vault; set `managed: true` before `maintain`.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure discord query --
node tools/hdc/cli.mjs run infrastructure discord query -- --import --yes --require-vault
node tools/hdc/cli.mjs run infrastructure discord maintain -- --app hermes --dry-run
```

## Twilio in this repo

- **Config:** [`packages/infrastructure/twilio/config.json`](packages/infrastructure/twilio/config.json) (copy from [`config.example.json`](packages/infrastructure/twilio/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/twilio.config.schema.json`](tools/hdc/schema/twilio.config.schema.json).
- **Docs:** [`docs/manually-deployed/twilio.md`](docs/manually-deployed/twilio.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff Elastic SIP trunks and Incoming Phone Numbers vs config; `--import --yes` writes live snapshot to hdc-private config (JSON on stdout) |

Vault: `HDC_TWILIO_ACCOUNT_SID`, `HDC_TWILIO_AUTH_TOKEN` (API). Asterisk SIP Credential List uses separate `HDC_TWILIO_SIP_USERNAME` / `HDC_TWILIO_SIP_PASSWORD` in the **asterisk** package.

**Bootstrap:** `query -- --import --yes` replaces `sip_trunks[]` and `phone_numbers[]`.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure twilio query --
node tools/hdc/cli.mjs run infrastructure twilio query -- --import --yes
```

## UptimeRobot in this repo

- **Config:** [`packages/infrastructure/uptimerobot/config.json`](packages/infrastructure/uptimerobot/config.json) (copy from [`config.example.json`](packages/infrastructure/uptimerobot/config.example.json); keep local config in hdc-private).
- **Schema:** [`tools/hdc/schema/uptimerobot.config.schema.json`](tools/hdc/schema/uptimerobot.config.schema.json).
- **Docs:** [`docs/manually-deployed/uptimerobot.md`](docs/manually-deployed/uptimerobot.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff monitors, status pages, and alert contacts vs config; `--import --yes` writes live snapshot to hdc-private config (JSON on stdout) |
| `maintain` | Reconcile `managed: true` entries via UptimeRobot API v2; optional `--prune` removes live resources not listed in config |

Vault: `HDC_UPTIMEROBOT_API_KEY` (Main API key from Integrations & API → API).

**Bootstrap:** `query -- --import --yes` replaces `monitors[]`, `status_pages[]`, and `alert_contacts[]`.

Examples:

```bash
node tools/hdc/cli.mjs run infrastructure uptimerobot query --
node tools/hdc/cli.mjs run infrastructure uptimerobot query -- --import --yes
node tools/hdc/cli.mjs run infrastructure uptimerobot maintain --
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

## Agent team (Cursor subagents)

Seven role-specific subagents under [`.cursor/agents/`](.cursor/agents/) coordinate HDC operations with shared state in **hdc-private** `operations/`:

| Agent | Role |
| --- | --- |
| [`hdc-manager`](.cursor/agents/hdc-manager.md) | Task queue triage, delegation, Discord/email escalation |
| [`hdc-monitor`](.cursor/agents/hdc-monitor.md) | Uptime Kuma, Nagios, Proxmox health digests |
| [`hdc-sre`](.cursor/agents/hdc-sre.md) | Approved deploy/maintain, package and CLI changes |
| [`hdc-security-expert`](.cursor/agents/hdc-security-expert.md) | Wazuh, CrowdSec, nginx-waf response |
| [`hdc-security-architect`](.cursor/agents/hdc-security-architect.md) | Read-only security proposals |
| [`hdc-network-architect`](.cursor/agents/hdc-network-architect.md) | Read-only network/DNS proposals |
| [`hdc-research`](.cursor/agents/hdc-research.md) | Tool research briefs |

Shared skills: [`.cursor/skills/hdc-agent-team/`](.cursor/skills/hdc-agent-team/SKILL.md), [`hdc-manager`](.cursor/skills/hdc-manager/SKILL.md), [`hdc-monitor`](.cursor/skills/hdc-monitor/SKILL.md), [`hdc-security`](.cursor/skills/hdc-security/SKILL.md).

**Operations state (hdc-private):** `operations/task-queue.json`, `operations/delegation-policy.md`, `operations/ip-allocations.md`, `operations/reports/`, `operations/proposals/`.

**IP allocations:** Before assigning a static address for a new Proxmox guest, read `hdc-private/operations/ip-allocations.md` — pick the workload's IP group and **Next free** address, then cross-check BIND and inventory. Site IPs live in **hdc-private** only, not in the public hdc repo.

**Discord alerts:** `node tools/hdc/lib/notify-discord.mjs --title "…" --message "…"` (vault `HDC_OPS_DISCORD_WEBHOOK_URL`; messages include OS hostname or `HDC_OPS_DISCORD_HOST`). `hdc run … deploy|maintain` posts a one-line IP-redacted summary to the same webhook automatically (disable with `HDC_OPS_DISCORD_NOTIFY=0` or `--no-discord-notify`).

**Scheduled runs:** hdc-runner cron (query jobs) + Cursor Automations drafts in [`.cursor/automations/`](.cursor/automations/README.md).

Legacy alias: [`hdc-ops`](.cursor/agents/hdc-ops.md) → prefer **hdc-sre** / **hdc-manager**.

## Deeper context (pointers)

| Topic | Location |
| --- | --- |
| Automation conventions | [`.cursor/rules/hdc-automation.mdc`](.cursor/rules/hdc-automation.mdc) |
| Inventory naming | [`.cursor/rules/hdc-inventory-naming.mdc`](.cursor/rules/hdc-inventory-naming.mdc) |
| Nagios + manual docs | [`.cursor/rules/hdc-nagios-monitoring.mdc`](.cursor/rules/hdc-nagios-monitoring.mdc) |
| Agent team | [`.cursor/skills/hdc-agent-team/SKILL.md`](.cursor/skills/hdc-agent-team/SKILL.md), [`.cursor/agents/`](.cursor/agents/) |
| Operator workflow | [`.cursor/skills/hdc-ops/SKILL.md`](.cursor/skills/hdc-ops/SKILL.md), [`.cursor/agents/hdc-sre.md`](.cursor/agents/hdc-sre.md) |
| Human README | [README.md](README.md) |
