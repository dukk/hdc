# Home Data Center (HDC)

Automation and documentation for a manually deployed home data center. Agents operate and extend this repo via the **hdc** CLI and JSON inventory sidecars.

> **System overview:** [ARCHITECTURE.md](ARCHITECTURE.md) is the end-to-end map — core ideas, the three-repo model, CLI/package runtime, agent fleet, APIs, and deployment topology, with diagrams. This file (AGENTS.md) is the detailed per-package reference and CLI manual.

## Role

- Use structured facts from inventory and clump configs — **do not invent** hostnames, IPs, bridges, VLANs, pool names, or credentials.
- Prefer tracked automation under `clumps/` over one-off shell installs.
- Only create git commits when the user explicitly asks.

## Quick start

- **Node.js 18+** — the CLI uses built-in modules only; no `npm install` is required to run hdc from a git checkout. **npm consumers** install `@dukk/hdc-cli` from GitHub Packages (see [docs/npm-workspace.md](docs/npm-workspace.md) and [`templates/hdc-private-workspace/`](templates/hdc-private-workspace/)).
- **Invoke hdc** (repo root): `hdc <command>` (`hdc.cmd` on Windows, `./hdc` on Unix after `chmod +x hdc`). From an npm operator workspace: `npx hdc <command>`.
- **Secrets:** copy [`.env.example`](.env.example) to `.env` (gitignored) for **global** CLI settings (vault passphrase, secret backend, `HDC_PRIVATE_ROOT`, ops Discord, guest baseline). Package-specific env vars live in `clumps/<tier>/<id>/.env` (see each package `.env.example`; prefer hdc-private). The root `.env.example` indexes all 96 packages; run `node apps/hdc-cli/scripts/ensure-clump-env-examples.mjs --write` after adding a clump to scaffold its `.env.example`. Merge order: hdc public then hdc-private for each path (workspace `.env` overrides platform for global bootstrap). `hdc run` loads only global + the target clump (and `env_includes`, auto-proxmox when config uses Proxmox). Migrate a monolithic root `.env` with `node apps/hdc-cli/scripts/migrate-root-env.mjs --dry-run`. API keys and passwords prefer the encrypted vault at `~/.hdc/vault.enc` (see `secrets` commands below). Auth fields in inventory reference **env var names only**, never values.
- **hdc-private:** Clone the private repo beside hdc (`../hdc-private`) or set `HDC_PRIVATE_ROOT`. Or make the private repo itself an npm workspace (`HDC_PRIVATE_ROOT=.`) with `@dukk/hdc-cli`. Clump `config.json` and inventory JSON use the same paths; hdc checks the public repo first, then hdc-private. Seed clump configs from examples: `node apps/hdc-cli/scripts/bootstrap-hdc-private-configs.mjs` (skips existing files; `--force` to overwrite). On supported infrastructure packages, `query --import --yes` (or package-specific import flags such as Cloudflare `--import-zones`) auto-seeds missing `config.json` from `config.example.json` in hdc-private before importing live API data. Shared loaders: [`apps/hdc-cli/lib/private-repo.mjs`](apps/hdc-cli/lib/private-repo.mjs), [`apps/hdc-cli/lib/clump-config.mjs`](apps/hdc-cli/lib/clump-config.mjs).
- **hdc-clumps:** Package scripts live in the sibling [**hdc-clumps**](https://github.com/dukk/hdc-clumps) repo (or `~/.hdc/clump-repos/` after `hdc clumps init`). Manifest discovery reads [`.hdc/clumps-repos.json`](.hdc/clumps-repos.json); override with `HDC_CLUMPS_ROOT` for a local checkout.

### Clump config JSONC (comments + includes)

Clump `config.json` files (not inventory sidecars) support **JSONC** when loaded via [`loadClumpConfigFromClumpRoot`](apps/hdc-cli/lib/clump-config.mjs):

- **Comments:** `//` line comments and `/* block */` comments; trailing commas allowed.
- **Includes:** `{ "$hdc.include": "relative/path.json" }` or `{ "$hdc.include": { "file": "relative/path.json" } }`.
  - Paths resolve relative to the **including file’s directory** (public hdc first, then hdc-private).
  - In an **array**, an included JSON **object** inserts one element; an included **array** splices/flattens into the parent array.
  - An object with `$hdc.include` must not contain other keys (no merge in v1).
  - Circular includes are rejected.

Preprocessor: [`apps/hdc-cli/lib/json-config-preprocess.mjs`](apps/hdc-cli/lib/json-config-preprocess.mjs). Writes via `writeResolvedRepoJson` remain strict JSON (comments are not preserved). Opt out when loading: `loadClumpConfigFromClumpRoot(root, { preprocess: false })`.

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
| [`apps/hdc-cli/`](apps/hdc-cli/) | Node.js CLI (`cli.mjs`), package runtime (`lib/package/`), and shared libraries |
| **hdc-clumps** (external) | Plugins: `clients/`, `infrastructure/`, `services/` — bootstrap with `hdc clumps init` |
| [`operations/inventory/`](operations/inventory/) | Authoritative sidecars in **hdc-private** (`systems/`, `networks/`, `services/`, `targets/`); public repo: [`systems/_example.json`](operations/inventory/systems/_example.json) only |
| [`operations/automated/`](operations/automated/) | Overlay in **hdc-private** (per-file under `systems/`, `networks/`, `policies/`) |
| [`docs/manually-deployed/`](docs/manually-deployed/) | Human-oriented markdown for gear hdc does not manage end-to-end |

Optional companion `*.md` next to inventory JSON is for humans/agents; **hdc does not read or write those files**.

## CLI (implemented)

Commands from [`apps/hdc-cli/lib/cli-app.mjs`](apps/hdc-cli/lib/cli-app.mjs):

| Command | Purpose |
| --- | --- |
| `help [topic …]` | Hierarchical usage |
| `list` | Packages and manifest metadata |
| `clumps list [--reference]` | Active and reference clump repos, sync status |
| `clumps sync [--repo <id>] [--dry-run]` | Clone or pull external clump repos |
| `clumps init` | Bootstrap default hdc-clumps cache |
| `run <tier> <clump> <verb> [-- <args>]` | Run a package script (`deploy`, `maintain`, `query`, `health`, `teardown`); tier: `client`, `infrastructure`, or `service` |
| `run <tier> <clump> <platform> <verb> [-- <args>]` | When manifest lists `platforms` (legacy platform-routed layout) |
| `secrets path \| init \| change-passphrase \| set \| list \| get \| dump \| delete` | Encrypted vault for `HDC_*` secrets; `get`/`dump` write plaintext to files (unlock required) |
| `users bootstrap-hdc [--dry-run] [--sidecar <path> …]` | Ensure local `hdc` Linux user on bootstrap hosts |
| `maintain daily [--dry-run] [--skip-clients] [--skip-upgrades] [--only <tier>/<id>] [--skip <tier>/<id>]` | Cross-package daily orchestrator (non-destructive recipe; aggregated report) |
| `env` | Print `HDC_*` variables (sensitive values redacted) |

Examples:

```bash
hdc list
hdc run infrastructure proxmox query
hdc run service vaultwarden health
hdc run service pi-hole deploy -- --help
hdc help run infrastructure proxmox maintain
hdc maintain daily --dry-run
```

**Health:** `hdc run <tier> <clump> health` runs layered connectivity checks (DNS → public URL → nginx-waf LAN IP+Host → direct guest IP → in-guest docker/systemd). Exit `0` when healthy or degraded (origin up, edge down); `1` when down/unknown. JSON on stdout.
## Daily maintain

`hdc maintain daily` runs a curated, **non-destructive** recipe across every package that has a resolved `config.json` (hdc-private or public). It skips prune operations, rolling restarts, and reboots; applies routine updates (Docker pull, guest apt, DSM packages) unless `--skip-upgrades` is set; runs **query only** on home clients (`windows`, `client-ubuntu`, `raspberrypi`).

- Recipe: [`apps/hdc-cli/lib/daily-maintain-recipe.mjs`](apps/hdc-cli/lib/daily-maintain-recipe.mjs)
- Orchestrator: [`apps/hdc-cli/lib/daily-maintain.mjs`](apps/hdc-cli/lib/daily-maintain.mjs)
- Report: `apps/hdc-cli/reports/daily-maintain-<timestamp>.md` (under hdc-private when present)
- Continues on per-clump failure; exit code `1` if any step failed

Schedule on the operator workstation (Task Scheduler, cron, or automation agent), for example daily at 03:00:

```bash
# Windows Task Scheduler action (repo root):
hdc.cmd maintain daily

# Linux/macOS cron:
0 3 * * * cd /path/to/hdc && ./hdc maintain daily >> ~/.hdc/daily-maintain.log 2>&1
```

Filter examples:

```bash
hdc maintain daily -- --only infrastructure/proxmox
hdc maintain daily -- --skip service/trivy --skip-upgrades
```

**Not implemented in the CLI today:** `docs lint`, `docs sync`, and `inventory apply` appear in [README.md](README.md) and some `.cursor/rules/` files — treat as planned workflow until wired in `cli-app.mjs`. Validate inventory JSON against schemas under [`apps/hdc-cli/schema/`](apps/hdc-cli/schema/) instead.

## Inventory

- **Manual sidecars:** `operations/inventory/{systems,networks,services,targets}/*.json`, discriminated by `kind`: `system`, `network`, `target`, or `services`.
- **Systems** may list `services: [{ "id": "<id>", "nodes"?: ["…"] }]` pointing at `kind: "services"` records under `operations/inventory/services/` (by id only).
- **Targets:** `kind: "target"` with `automation_target` set to a package manifest id (e.g. `proxmox`, `unifi-network`).
- **Schemas:** [`inventory.schema.json`](apps/hdc-cli/schema/inventory.schema.json) (union), plus `inventory.system.schema.json`, `inventory.network.schema.json`, `inventory.target.schema.json`, `inventory.services.schema.json`, `inventory.policy.schema.json`.
- **Automated overlay:** plugins may write under `operations/automated/`; use `resolveSystemById` in code when merging manual and automated facts.

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

- Each package: [`clumps/<folder>/manifest.json`](clumps/) with `id`, optional `inventory_docs`, and `verbs` mapping to `deploy/run.mjs`, `maintain/run.mjs`, or `query/run.mjs`.
- **Infrastructure** (shared capabilities): `proxmox`, `unifi-network`, `ubuntu`, `synology-nas`, `cloudflare`, `cloudflare-workers`, `azure`, `gcp-oauth`, `gcp-compute`, `oci-compute`, `discord`, `twilio`, `smtp2go`, `openrouter`, `uptimerobot`.
- **Services** (apps on guests): e.g. `pi-hole`, `uptime-kuma`, `scanopy`, `yacy`, `searxng`, `gatus`, `open-webui`, `openspeedtest`, `a2a-registry`, `vaultwarden`, `n8n`, `nextcloud`, `postiz`, `immich`, `plex`, `solidtime`, `stirling-pdf`, `it-tools`, `omni-tools`, `nagios`, `homeassistant`, `bind`, `nginx`, `nginx-waf`, `kafka`, `cassandra`, `postgresql`, `splunk`, `step-ca`, `asterisk`, `jenkins`, `minecraft`, `ollama`, `lms`, `llama-cpp`, `postfix-relay`, `mailcow`, `audiobookshelf`, `listmonk`, `shlink`, `crowdsec`, `wazuh`, `trivy`, `wireguard`, `keycloak`, `greenbone`, `vikunja`, `paperless-ngx`, `paperclip`.
- **Clients** (home PCs/workstations): `windows`, `client-ubuntu`, `raspberrypi` under `clumps/clients/` — per-clump `config.json` (e.g. [`clumps/clients/windows/config.json`](clumps/clients/windows/config.json)). (`client-ubuntu` id avoids clash with infrastructure `ubuntu`.)

### Package script logging

When changing `clumps/**/*.mjs`:

- **stderr** — user-visible progress, prompts, warnings.
- **stdout** — machine-only; on `query` / `deploy`, often a single JSON object at exit.
- **Secrets** — use `readLineQuestion(prompt, { mask: true })` from [`apps/hdc-cli/lib/readline-masked.mjs`](apps/hdc-cli/lib/readline-masked.mjs); never log tokens or passphrases.

See [`.cursor/rules/hdc-automation-logging.mdc`](.cursor/rules/hdc-automation-logging.mdc).

### Operation reports (deploy / maintain / teardown)

After `deploy`, `maintain`, or `teardown`, packages write a markdown report under `clumps/<clump>/reports/<verb>-<timestamp>.md` in **hdc-private when that repo is available** (sibling `../hdc-private` or `HDC_PRIVATE_ROOT`), otherwise under the public hdc tree (gitignored in both repos). Shared helpers: [`clumps/lib/operation-report.mjs`](clumps/lib/operation-report.mjs). Skip with `--no-report`; override path with `--report <path>`. `query` does not write reports.

### Guest baseline (hdc automation user, local admin + ClamAV)

Linux **Proxmox guest** `maintain` scripts apply a shared baseline via [`clumps/lib/guest-linux-baseline.mjs`](clumps/lib/guest-linux-baseline.mjs):

1. **`hdc` automation user** — fixed username `hdc`; per-system vault key `HDC_USER_HDC_PASSWORD_<SYSTEM_ID>` (auto-generated on first maintain when missing). Passwordless sudo via `/etc/sudoers.d/hdc-automation`. Operator `~/.ssh` public keys installed on `hdc`. Helpers: [`clumps/lib/hdc-user-ensure.mjs`](clumps/lib/hdc-user-ensure.mjs). Skip with `--skip-hdc-user` or `--skip-hdc-ssh-keys`.
2. **Local sudo admin** — username from `HDC_ADMIN_USER` in repo `.env`; password in vault as `HDC_ADMIN_USER_PASSWORD`. Helpers: [`clumps/lib/admin-user-ensure.mjs`](clumps/lib/admin-user-ensure.mjs), [`clumps/lib/linux-local-admin-user.mjs`](clumps/lib/linux-local-admin-user.mjs). Skip with `--skip-admin-user`.
3. **ClamAV** — install/enable via [`clumps/lib/clamav-ensure.mjs`](clumps/lib/clamav-ensure.mjs); profile from guest `memory_mb` (`lean` ≤3072: freshclam + oneshot `clamscan` only, no `clamd`; `standard` ≤8191: tuned `clamd`; `full`: Debian defaults). Daily staggered `clamscan` on `/home`, `/opt`, `/var` via [`clumps/lib/clamav-scan-schedule.mjs`](clumps/lib/clamav-scan-schedule.mjs). Skip with `--skip-clamav` or `--skip-clamav-scan`.
4. **Unattended-upgrades** — apt security updates via [`clumps/lib/unattended-upgrades-ensure.mjs`](clumps/lib/unattended-upgrades-ensure.mjs) (no auto-reboot). Skip with `--skip-unattended-upgrades`.
5. **Mail relay (Postfix satellite)** — forward local mail to the internal relay from [`clumps/services/postfix-relay/config.json`](clumps/services/postfix-relay/config.json) `client_defaults` (relay host `postfix-relay.home.example.invalid` / `192.0.2.60`, no per-guest SMTP2GO creds). Helpers: [`clumps/lib/postfix-satellite-ensure.mjs`](clumps/lib/postfix-satellite-ensure.mjs), [`clumps/lib/mail-relay-config.mjs`](clumps/lib/mail-relay-config.mjs). Skip with `--skip-mail-relay`. Auto-skipped on `postfix-relay-a` (the relay host itself).
6. **CrowdSec agent** — enroll to central LAPI from [`clumps/infrastructure/proxmox/config.json`](clumps/infrastructure/proxmox/config.json) `provision.guest_agents.crowdsec` + vault `HDC_CROWDSEC_ENROLL_KEY`. Skip with `--skip-crowdsec-agent`.
7. **Wazuh agent** — register to manager from `provision.guest_agents.wazuh` + vault `HDC_WAZUH_AGENT_PASSWORD`. Skip with `--skip-wazuh-agent`.
8. **Root SSH disabled** — when both `hdc` and admin user are ensured, lock root password and set `PermitRootLogin no` ([`clumps/lib/root-login-disable.mjs`](clumps/lib/root-login-disable.mjs)). Skip with `--skip-disable-root`.

**Guest SSH:** QEMU configure paths default to user `hdc` ([`clumps/lib/guest-ssh-resolve.mjs`](clumps/lib/guest-ssh-resolve.mjs)); override with `configure.ssh.user` or `HDC_GUEST_SSH_USER`. [`clumps/lib/guest-ssh-exec.mjs`](clumps/lib/guest-ssh-exec.mjs) probes `hdc` then falls back to `root` during migration and wraps non-root commands with `sudo -n`.

Hypervisor bootstrap hosts still use `hdc users bootstrap-hdc` ([`apps/hdc-cli/lib/users-bootstrap-hdc.mjs`](apps/hdc-cli/lib/users-bootstrap-hdc.mjs)) — same vault key pattern and shared bash helpers.

Maintain JSON payloads should include `hdc_user`, `admin_user`, `clamav`, `clamav_scan_schedule`, `unattended_upgrades`, `crowdsec_agent`, `wazuh_agent`, `mail_relay` (when applicable), and `root_login_disabled` per instance via [`guestBaselineResultFields`](clumps/lib/guest-baseline-report.mjs). **Maintain operation reports** add a **Guest baseline** section automatically when those fields are present.

- **Out of scope (guest baseline):** Proxmox hypervisors (mail relay via `proxmox maintain`), Synology NAS (`synology-nas`), home clients (mail relay via `client-* maintain`), `ubuntu maintain` (bootstrap `hdc` only), **Home Assistant** (HAOS), and **Windows** guests. **Nagios** LXC guests get the local admin user only (skips ClamAV, scan schedule, CrowdSec/Wazuh agents).
- **Stub services** (`minecraft`, `jenkins`, `audiobookshelf`): baseline when `config.json` defines SSH or LXC targets; otherwise reports that baseline was not applied.

Example: set `HDC_ADMIN_USER` in `.env`, then `hdc run service postgresql maintain --`

## Asterisk in this repo

- **Config:** [`clumps/services/asterisk/config.json`](clumps/services/asterisk/config.json) (copy from [`config.example.json`](clumps/services/asterisk/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/asterisk-a.json`](operations/inventory/systems/asterisk-a.json) (LXC), [`vm-asterisk-a.json`](operations/inventory/systems/vm-asterisk-a.json) (QEMU); service sidecar [`operations/inventory/services/asterisk.json`](operations/inventory/services/asterisk.json).
- **Schema:** [`apps/hdc-cli/schema/asterisk.config.schema.json`](apps/hdc-cli/schema/asterisk.config.schema.json).
- **Twilio examples:** [`clumps/services/asterisk/examples/twilio/`](clumps/services/asterisk/examples/twilio/).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC, QEMU, or configure-only: apt Asterisk (PJSIP), render Twilio trunk + dialplan (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--destroy-existing`, `--skip-provision`) |
| `maintain` | Re-push `pjsip.d` / `extensions.d` / `rtp.d` includes; optional apt upgrade (`--skip-package-upgrade`); guest Linux baseline |
| `query` | Config summary; `--live` for `systemctl` + `pjsip show endpoints` preview |
| `teardown` | Destroy LXC or QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Set `asterisk.twilio.termination_domain` from Twilio Elastic SIP Trunk; vault `HDC_TWILIO_SIP_USERNAME` / `HDC_TWILIO_SIP_PASSWORD`. Configure `asterisk.nat.external_*` to your WAN IP when behind NAT. Forward SIP (5060) and RTP (10000–20000) on the edge firewall — not via nginx-waf. Default outbound prefix: `9` + E.164.

Example: `hdc run service asterisk deploy -- --instance a`

## Pi-hole in this repo

- **Config:** [`clumps/services/pi-hole/config.json`](clumps/services/pi-hole/config.json) (copy from [`config.example.json`](clumps/services/pi-hole/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/pi-hole-a.json`](operations/inventory/systems/pi-hole-a.json), [`pi-hole-b.json`](operations/inventory/systems/pi-hole-b.json).
- **Schema:** [`apps/hdc-cli/schema/pi-hole.config.schema.json`](apps/hdc-cli/schema/pi-hole.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC provision + unattended Pi-hole install + allowlist sync (`deployments[]`; `--instance a` / `--system-id pi-hole-b`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-apply upstream/listening/local DNS + sync `pihole.allowlist[]` via `pihole allow`; gravity update + optional core update (`--skip-core-update`, `--skip-allowlist`, `--prune` removes allowlist entries not in config) |
| `query` | Per-instance status via `pct exec`; `--live` reports configured vs live allowlist counts |

Set blocklist exceptions in `defaults.pihole.allowlist[]` (strings or `{ "domain", "comment"? }`). Example bundle for Google Analytics: `marketingplatform.google.com`, `www.googletagmanager.com`, `www.google-analytics.com`, `analytics.google.com`. Not the same as `local_dns[]` custom A records.

Vault: `HDC_PIHOLE_WEBPASSWORD` (optional; deploy uses config `pihole.webpassword` today); `HDC_PIHOLE_API_TOKEN` optional for future API query.

## Uptime Kuma in this repo

- **Config:** [`clumps/services/uptime-kuma/config.json`](clumps/services/uptime-kuma/config.json) (copy from [`config.example.json`](clumps/services/uptime-kuma/config.example.json); keep local config out of git). Optional **split layout:** keep `monitors/` and `status_pages/` folders beside `config.json` with one JSON object per file; root `config.json` lists `{ "$hdc.include": "monitors/<id>.json" }` entries (see [`config.example.json`](clumps/services/uptime-kuma/config.example.json)). `query --import --yes` and `--import-from-homepage --yes` preserve split layout when detected; inline arrays remain supported.
- **Per-deployment (schema v5):** Root/`defaults` supply shared `monitors[]`, `tags[]`, `status_pages[]`, `notifications[]`, and `uptime_kuma_auth`. Each `deployments[]` entry may override `monitors` (replace), `notifications` (replace), and `uptime_kuma_auth` (deep-merge). Use separate monitor trees (e.g. `monitors-public/*.json`) and credentials per instance (`HDC_UPTIME_KUMA_PASSWORD_EXT_A`, …). `maintain` syncs notifications then monitors per selected deployment; `--skip-notifications` skips notification reconcile.
- **Modes:** `proxmox-lxc` (default) or `oci-vm` (Oracle Cloud via [`oci-compute`](clumps/infrastructure/oci-compute/); SSH install, no guest Linux baseline). OCI instances use `uptime_kuma_auth.api_via_ssh: true` and `api_url: http://127.0.0.1:3001` — hdc opens an SSH local forward for Socket.IO sync (port 3001 not exposed on WAN).
- **Notifications:** `notifications[]` with `managed: true` and `apply_to_monitors: true` (or per-monitor `notifications: ["id"]`). **Discord:** `type: discord` + `discord_webhook_vault_key` (e.g. `HDC_OPS_DISCORD_WEBHOOK_URL`). **SMTP (second alert path):** `type: smtp` + `mail_to`, with either `use_mail_relay: true` (host/port/from from postfix-relay `client_defaults` — LAN instances) or explicit `smtp_host`/`smtp_port` plus optional `smtp_username_env` / `smtp_password_vault_key` (external instances, e.g. SMTP2GO).
- **Inventory:** [`operations/inventory/systems/uptime-kuma-a.json`](operations/inventory/systems/uptime-kuma-a.json), optional `uptime-kuma-ext-a.json` (OCI); service sidecar [`operations/inventory/services/uptime-kuma.json`](operations/inventory/services/uptime-kuma.json).
- **Schema:** [`apps/hdc-cli/schema/uptime-kuma.config.schema.json`](apps/hdc-cli/schema/uptime-kuma.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC or `oci-vm`: install from GitHub release tarball (Node 22, Chromium, systemd on port 3001; `--instance a\|ext-a`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Upgrade when `uptime_kuma.release` is behind latest; reconcile `notifications[]` then `monitors[]` via Socket.IO per deployment (`--skip-monitors`, `--skip-notifications`, `--prune`, `--dry-run`, `--monitor <id>`, `--instance`); `--skip-upgrade` for restart/health only |
| `query` | Guest `systemctl`/HTTP probe; monitor drift vs live (`--live`); `--import-from-homepage --yes` seeds `monitors[]` from homepage `services.yaml`; `--import --yes` pulls live monitors/tags/status pages into config (name/slug keyed; no UK database IDs) |
| `teardown` | Destroy LXC or `oci-compute` VM (`--dry-run`, `--yes`, `--instance`) |

Complete first-run admin setup in the web UI after deploy (OCI: SSH port-forward `ssh -L 3001:127.0.0.1:3001 ubuntu@<ip>`). Monitor automation uses per-deployment `HDC_UPTIME_KUMA_USERNAME` / vault password env keys. Uptime Kuma API keys are read-only (metrics) and cannot create monitors. Config schema v5 keys monitors by hdc `id` + `name`, tags by `name`, groups by `group`, status pages by `slug`, and notifications by hdc `id`; UK database IDs are resolved at sync/query time only.

Example:

```bash
hdc run service uptime-kuma query -- --import-from-homepage --yes
hdc run service uptime-kuma maintain -- --instance ext-a
hdc run infrastructure oci-compute deploy -- --resource uptime-kuma-ext-a --dry-run
```

## SolidTime in this repo

- **Config:** [`clumps/services/solidtime/config.json`](clumps/services/solidtime/config.json) (copy from [`config.example.json`](clumps/services/solidtime/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/solidtime-a.json`](operations/inventory/systems/solidtime-a.json); service sidecar [`operations/inventory/services/solidtime.json`](operations/inventory/services/solidtime.json).
- **Schema:** [`apps/hdc-cli/schema/solidtime.config.schema.json`](apps/hdc-cli/schema/solidtime.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (Ubuntu 22.04) + SolidTime from GitHub tarball (`deployments[]`; `--instance a`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Upgrade to `solidtime.version` in config (`--check-latest`, `--version <tag>`, `--skip-upgrade`) |
| `query` | Caddy/PHP/PostgreSQL/HTTP health via `pct exec` |
| `teardown` | Destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_SOLIDTIME_DB_PASSWORD` (optional — auto-generated on first deploy if missing). Register the first account via the web UI after deploy.

Example: `hdc run service solidtime deploy --`

## BIND DNS in this repo

- **Config:** [`clumps/services/bind/config.json`](clumps/services/bind/config.json) (copy from [`config.example.json`](clumps/services/bind/config.example.json); keep local config out of git). Authoritative zone records live in `zones/*.json` sidecars referenced from root `config.json` via `{ "$hdc.include": "zones/<id>.json" }` (inline `zones[]` in one file also works). Each zone object has `id`, `zone_type`, `records`, optional `subnet` for reverse, optional `cloudflare_fallback` to merge public records from [`clumps/infrastructure/cloudflare/config.json`](clumps/infrastructure/cloudflare/config.json) with local overrides. Set static `deployments[].proxmox.qemu.ip` per node; no guest `vmid` in config (auto-allocated at deploy). Recursive upstream: plain `bind.forwarders` (default `1.1.1.1`, `1.0.0.1`) or **ODoH** via `bind.forward_upstream.mode: "odoh"` (installs **dnscrypt-proxy** on each VM; BIND forwards to `listen`, default `127.0.0.1:5300`; Cloudflare target `odoh-cloudflare` + configurable `relay`, default `odohrelay-crypto-sx`). ODoH is experimental (RFC 9230).
- **Inventory:** [`operations/inventory/systems/vm-bind-a.json`](operations/inventory/systems/vm-bind-a.json), [`vm-bind-b.json`](operations/inventory/systems/vm-bind-b.json).
- **Schema:** [`apps/hdc-cli/schema/bind.config.schema.json`](apps/hdc-cli/schema/bind.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Rebuild QEMU guests from Ubuntu template (optional `--destroy-existing`), cloud-init static IP from config, auto VMID, optional `rootfs_gb` scsi0 resize, BIND primary then secondary (`deployments[]`; `--instance a\|b`) |
| `maintain` | Grow root disk when `defaults.proxmox.qemu.rootfs_gb` exceeds live size (`--skip-disk-resize`); re-push dnscrypt-proxy (ODoH) and named options (forwarders) on all nodes; re-render zone files on primary (timestamp SOA serial); verify SOA serial match on secondary; guest Linux baseline (local admin from `HDC_ADMIN_USER` + ClamAV; `--skip-admin-user`, `--skip-clamav`) |
| `query` | `named` service status and per-zone `dig SOA` on each node |

TSIG: deploy auto-generates `bind.tsig_secret` in `config.json` and syncs vault `HDC_BIND_TSIG_KEY` when missing; `--regenerate-tsig` to rotate.

Example: `hdc run service bind deploy -- --destroy-existing`

## PostgreSQL in this repo

- **Config:** [`clumps/services/postgresql/config.json`](clumps/services/postgresql/config.json) (copy from [`config.example.json`](clumps/services/postgresql/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-postgres-a.json`](operations/inventory/systems/vm-postgres-a.json), [`vm-postgres-b.json`](operations/inventory/systems/vm-postgres-b.json); service sidecar [`operations/inventory/services/postgresql.json`](operations/inventory/services/postgresql.json).
- **Schema:** [`apps/hdc-cli/schema/postgresql.config.schema.json`](apps/hdc-cli/schema/postgresql.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, apt PostgreSQL install over SSH (`deployments[]` roles: `standalone`, `primary`, `standby`; primary/standalone before standby; `--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`) |
| `maintain` | Re-apply config on selected/all nodes; optional package upgrade (omit `--skip-package-upgrade` to run `apt-get upgrade` for PostgreSQL packages) |
| `query` | `postgresql` service status, `pg_isready`, version, recovery/replication lag on standbys |

Vault: `HDC_POSTGRESQL_SUPERUSER_PASSWORD` (required; optional per-instance `HDC_POSTGRESQL_SUPERUSER_PASSWORD_A`, …); `HDC_POSTGRESQL_REPLICATION_PASSWORD` when any deployment has `role: standby`.

Example: `hdc run service postgresql deploy -- --instance a`

## step-ca in this repo

- **Config:** [`clumps/services/step-ca/config.json`](clumps/services/step-ca/config.json) (copy from [`config.example.json`](clumps/services/step-ca/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-step-ca-a.json`](operations/inventory/systems/vm-step-ca-a.json); service sidecar [`operations/inventory/services/step-ca.json`](operations/inventory/services/step-ca.json).
- **Schema:** [`apps/hdc-cli/schema/step-ca.config.schema.json`](apps/hdc-cli/schema/step-ca.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, optional `rootfs_gb` scsi0 resize, apt `step-cli`/`step-ca`, non-interactive `step ca init` when missing, systemd under `/etc/step-ca` (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-existing`) |
| `maintain` | Grow root disk when `defaults.proxmox.qemu.rootfs_gb` exceeds live size (`--skip-disk-resize`); re-push `ca.json` and password file, optional package upgrade, restart `step-ca` (omit `--skip-package-upgrade` to refresh packages) |

Vault: `HDC_STEP_CA_PASSWORD` (required; optional per-instance `HDC_STEP_CA_PASSWORD_A`). Distribute `/etc/step-ca/certs/root_ca.crt` to clients manually after deploy.

Example: `hdc run service step-ca deploy --`

## Cassandra in this repo

- **Config:** [`clumps/services/cassandra/config.json`](clumps/services/cassandra/config.json) (copy from [`config.example.json`](clumps/services/cassandra/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-cassandra-a.json`](operations/inventory/systems/vm-cassandra-a.json), [`vm-cassandra-b.json`](operations/inventory/systems/vm-cassandra-b.json), [`vm-cassandra-c.json`](operations/inventory/systems/vm-cassandra-c.json); service sidecar [`operations/inventory/services/cassandra.json`](operations/inventory/services/cassandra.json).
- **Schema:** [`apps/hdc-cli/schema/cassandra.config.schema.json`](apps/hdc-cli/schema/cassandra.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, Apache Cassandra apt install over SSH; 3-node cluster in bootstrap order (seeds first; `--instance a\|b\|c`, `--destroy-existing`, `--skip-provision`) |
| `maintain` | Re-push `cassandra.yaml` / rackdc / JVM options; optional `--rolling-restart` (nodetool drain + restart per node) |
| `query` | `cassandra` service status and `nodetool status` per node |

Vault: `HDC_CASSANDRA_SUPERUSER_PASSWORD` (required when `cassandra.authenticator` is `PasswordAuthenticator`).

Example: `hdc run service cassandra deploy -- --destroy-existing`

## Redis Cluster in this repo

- **Config:** [`clumps/services/redis/config.json`](clumps/services/redis/config.json) (copy from [`config.example.json`](clumps/services/redis/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-redis-a.json`](operations/inventory/systems/vm-redis-a.json), [`vm-redis-b.json`](operations/inventory/systems/vm-redis-b.json), [`vm-redis-c.json`](operations/inventory/systems/vm-redis-c.json); service sidecar [`operations/inventory/services/redis.json`](operations/inventory/services/redis.json).
- **Schema:** [`apps/hdc-cli/schema/redis.config.schema.json`](apps/hdc-cli/schema/redis.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, apt Redis install over SSH; 3-master cluster bootstrap via `redis-cli --cluster create` when all nodes deploy (`--instance a\|b\|c`, `--destroy-existing`, `--skip-provision`, `--skip-cluster-bootstrap`) |
| `maintain` | Re-apply `redis.conf` on each node; optional apt upgrade (`--skip-apt`); `redis-cli --cluster check` when all 3 nodes selected |
| `query` | Per-node `PING` and `CLUSTER INFO`; cluster check when all 3 nodes configured |

Vault: `HDC_REDIS_PASSWORD` (required for deploy/maintain/query).

Example: `hdc run service redis deploy --`

## Valkey Cluster in this repo

- **Config:** [`clumps/services/valkey/config.json`](clumps/services/valkey/config.json) (copy from [`config.example.json`](clumps/services/valkey/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-valkey-a.json`](operations/inventory/systems/vm-valkey-a.json), [`vm-valkey-b.json`](operations/inventory/systems/vm-valkey-b.json), [`vm-valkey-c.json`](operations/inventory/systems/vm-valkey-c.json); service sidecar [`operations/inventory/services/valkey.json`](operations/inventory/services/valkey.json).
- **Schema:** [`apps/hdc-cli/schema/valkey.config.schema.json`](apps/hdc-cli/schema/valkey.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU clone from Ubuntu template, cloud-init static IP, apt Valkey install over SSH; 3-master cluster bootstrap via `valkey-cli --cluster create` when all nodes deploy (`--instance a\|b\|c`, `--destroy-existing`, `--skip-provision`, `--skip-cluster-bootstrap`) |
| `maintain` | Re-apply `valkey.conf` on each node; optional apt upgrade (`--skip-apt`); `valkey-cli --cluster check` when all 3 nodes selected |
| `query` | Per-node `PING` and `CLUSTER INFO`; cluster check when all 3 nodes configured |

Vault: `HDC_VALKEY_PASSWORD` (required for deploy/maintain/query). Guests need Ubuntu 24.04+ (or another release with `valkey` in default apt).

Example: `hdc run service valkey deploy --`

## Nginx WAF in this repo

- **Config:** [`clumps/services/nginx-waf/config.json`](clumps/services/nginx-waf/config.json) (copy from [`config.example.json`](clumps/services/nginx-waf/config.example.json); keep local config out of git). **Schema v4** uses `deployment_groups[]` with a **policy catalog** (`defaults.nginx_waf.policy_definitions` + site/location `policies[]`); v3 `waf` / `access.internal_only` auto-migrate at normalize time.
- **Inventory:** [`operations/inventory/systems/vm-nginx-waf-a.json`](operations/inventory/systems/vm-nginx-waf-a.json), [`vm-nginx-waf-b.json`](operations/inventory/systems/vm-nginx-waf-b.json); service sidecar [`operations/inventory/services/nginx-waf.json`](operations/inventory/services/nginx-waf.json).
- **Schema:** [`apps/hdc-cli/schema/nginx-waf.config.schema.json`](apps/hdc-cli/schema/nginx-waf.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Optional Proxmox QEMU provision or configure-only; install nginx, libmodsecurity3, ModSecurity-nginx, OWASP CRS; push group `sites[]`; ACME certs on each group's cert-primary + peer sync; default catch-all 404 vhost |
| `maintain` | Re-apply OWASP CRS profiles + push group sites/maps; `--renew-certs`; `--sync-certs`; `--site <id>` (cert scope only); `--group <id>`; full maintain prunes sites removed from config |
| `query` | `nginx` status, config test, ModSecurity module + CRS rule count + per-profile `SecRuleEngine`, policy types per site, rate-limit zones, cert expiry, upstream probes |

**Policies:** catalog refs (`modsecurity-default`, `internal-lan`, `block-exploits`, `hide-version`, …) or inline `{ "type": "…" }` on `sites[].policies[]` and `locations[].policies[]`. Location wins over site for the same policy type. **`trusted_cidrs`**: union match across named CIDR groups; per-site geo variable. **`cloudflare_origin`**: require `CF-Connecting-IP` on direct origin. **`rate_limit`**: shared `limit_req_zone` in `/etc/nginx/hdc/waf-maps.conf`.

**Sites:** `host_names[]` (legacy `server_names` accepted with warning); `upstream` as URL string or pool object (`method`, `servers[]`); optional `locations[].upstream`. **TLS:** enabled by default; `tls.http_redirect` (default true) controls HTTP→HTTPS redirect.

Vault: `HDC_NGINX_WAF_LETS_ENCRYPT_EMAIL` (required for Let's Encrypt deploy; legacy `HDC_NGINX_WAF_LE_EMAIL` still read with deprecation warning); `HDC_BIND_TSIG_KEY` when ACME uses **dns-01** (explicit challenge or http-01 fallback for names in `acme.dns.zone` only — Cloudflare DNS zones such as `brand-a.example` / `brand-b.example` use http-01 via proxy).

Example: `hdc run service nginx-waf maintain -- --group edge`

## Nginx web hosting in this repo

- **Config:** [`clumps/services/nginx/config.json`](clumps/services/nginx/config.json) (copy from [`config.example.json`](clumps/services/nginx/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-nginx-a.json`](operations/inventory/systems/vm-nginx-a.json); service sidecar [`operations/inventory/services/nginx.json`](operations/inventory/services/nginx.json).
- **Schema:** [`apps/hdc-cli/schema/nginx.config.schema.json`](apps/hdc-cli/schema/nginx.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Optional Proxmox QEMU provision or configure-only; install nginx + certbot; push `sites[]` (reverse proxy, same shape as nginx-waf without WAF); LE certs per node |
| `maintain` | Grow root disk when `defaults.proxmox.qemu.rootfs_gb` exceeds live size (`--skip-disk-resize`); re-push `sites[]` to all nodes (default); `--renew-certs`; `--site <id>` updates only that site (other vhosts unchanged); full maintain prunes sites removed from config |
| `query` | `nginx` status, config test, enabled sites, upstream probes, cert expiry |

Vault: `HDC_NGINX_LE_EMAIL` (required for deploy); `HDC_BIND_TSIG_KEY` when `letsencrypt.challenge` is `dns-01`.

Example: `hdc run service nginx deploy -- --instance a`

## Splunk in this repo

- **Config:** [`clumps/services/splunk/config.json`](clumps/services/splunk/config.json) (copy from [`config.example.json`](clumps/services/splunk/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-splunk-a.json`](operations/inventory/systems/vm-splunk-a.json); service sidecar [`operations/inventory/services/splunk.json`](operations/inventory/services/splunk.json).
- **Schema:** [`apps/hdc-cli/schema/splunk.config.schema.json`](apps/hdc-cli/schema/splunk.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Single Splunk Free node on Proxmox QEMU: clone Ubuntu template, optional data disk for `/opt/splunk/var`, install `.deb`, accept Free license, set admin password (`deployments[]`; `--destroy-existing`, `--skip-provision`, `--skip-install`) |
| `maintain` | Re-push `server.conf` / `inputs.conf`; optional Splunk package upgrade (omit `--skip-package-upgrade`) |
| `query` | `splunk status`, version, HTTP/mgmt port probes, var disk usage |

Set `splunk.version` and `splunk.build` in config (build id from Splunk download page deb filename). Exactly one `standalone` deployment — no clustering (Splunk Free).

Vault: `HDC_SPLUNK_ADMIN_PASSWORD` (required for deploy).

Example: `hdc run service splunk deploy -- --destroy-existing`

## Kafka in this repo

- **Config:** [`clumps/services/kafka/config.json`](clumps/services/kafka/config.json) (copy from [`config.example.json`](clumps/services/kafka/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-kafka-a.json`](operations/inventory/systems/vm-kafka-a.json), [`vm-kafka-b.json`](operations/inventory/systems/vm-kafka-b.json), [`vm-kafka-c.json`](operations/inventory/systems/vm-kafka-c.json); service sidecar [`operations/inventory/services/kafka.json`](operations/inventory/services/kafka.json).
- **Schema:** [`apps/hdc-cli/schema/kafka.config.schema.json`](apps/hdc-cli/schema/kafka.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Three-node KRaft cluster on Proxmox QEMU: clone Ubuntu template, cloud-init static IP, install Apache Kafka tarball, format storage, start `kafka.service` (`deployments[]`; `--instance a\|b\|c`; `--destroy-existing`, `--skip-provision`, `--skip-existing`) |
| `maintain` | Re-push `server.properties`, skip format when already formatted, rolling `systemctl restart kafka` |
| `query` | Per-broker `systemctl` + `kafka-broker-api-versions.sh` against localhost |

Set `kafka.cluster_id` in config (UUID from `kafka-storage.sh random-uuid`). No vault secrets for v1 (PLAINTEXT listeners).

Example: `hdc run service kafka deploy --`

## Ollama in this repo

- **Config:** [`clumps/services/ollama/config.json`](clumps/services/ollama/config.json) (copy from [`config.example.json`](clumps/services/ollama/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-ollama-a.json`](operations/inventory/systems/vm-ollama-a.json) (QEMU + GPU on hypervisor-d); `ollama-b/c` for LXC instances.
- **Schema:** [`apps/hdc-cli/schema/ollama.config.schema.json`](apps/hdc-cli/schema/ollama.config.schema.json).

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
hdc run service ollama deploy -- --instance a --destroy-existing
hdc run service ollama maintain -- --prune --dry-run
hdc run service ollama query -- --live
```

## vLLM in this repo

- **Config:** [`clumps/services/vllm/config.json`](clumps/services/vllm/config.json) (copy from [`config.example.json`](clumps/services/vllm/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-vllm-a.json`](operations/inventory/systems/vm-vllm-a.json) (QEMU + GPU), [`vm-vllm-b.json`](operations/inventory/systems/vm-vllm-b.json) (QEMU CPU); service sidecar [`operations/inventory/services/vllm.json`](operations/inventory/services/vllm.json).
- **Schema:** [`apps/hdc-cli/schema/vllm.config.schema.json`](apps/hdc-cli/schema/vllm.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU: clone Ubuntu template, optional `hostpci[]` GPU, Docker `vllm/vllm-openai` (CUDA) or `vllm/vllm-openai-cpu` (CPU); `--instance a\|b`, `--destroy-existing`, `--redeploy-existing` |
| `maintain` | Re-push compose + `.env`, `docker compose pull` + `up -d`; guest Linux baseline (`--skip-upgrade` skips image pull) |
| `query` | Config summary; `--live` for Docker + `/health` + `/v1/models` |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_HF_TOKEN` (Hugging Face hub; required for gated models such as Gemma). Consumers should use **LiteLLM** (`openai` backends), not vLLM directly. QEMU guests need `cpu: host` (deploy sets this) so AVX is visible to the container. On thin-pool-full template nodes, clone with `storage: local-lvm-data` and optional `migrate_target_storage` for the destination node.

Example: `hdc run service vllm deploy -- --instance a`

## Scanopy in this repo

- **Config:** [`clumps/services/scanopy/config.json`](clumps/services/scanopy/config.json) (copy from [`config.example.json`](clumps/services/scanopy/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/scanopy-a.json`](operations/inventory/systems/scanopy-a.json); service sidecar [`operations/inventory/services/scanopy.json`](operations/inventory/services/scanopy.json).
- **Schema:** [`apps/hdc-cli/schema/scanopy.config.schema.json`](apps/hdc-cli/schema/scanopy.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (4 vCPU, 4 GiB RAM, 32 GiB rootfs) + official Docker Compose stack (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | `docker compose pull` + `up -d` in `/opt/scanopy` |
| `query` | Config summary; `--live` for Docker/HTTP probe on port 60072 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_SCANOPY_POSTGRES_PASSWORD` (Postgres password for the compose stack).

Example: `hdc run service scanopy deploy --`

## YaCy in this repo

- **Config:** [`clumps/services/yacy/config.json`](clumps/services/yacy/config.json) (copy from [`config.example.json`](clumps/services/yacy/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/yacy-a.json`](operations/inventory/systems/yacy-a.json); service sidecar [`operations/inventory/services/yacy.json`](operations/inventory/services/yacy.json).
- **Schema:** [`apps/hdc-cli/schema/yacy.config.schema.json`](apps/hdc-cli/schema/yacy.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (privileged, Docker) + `yacy/yacy_search_server` Compose in `/opt/yacy`; admin password via `passwd.sh` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-admin-password`) |
| `maintain` | Re-push `.env`, `docker compose pull` + `up -d`; guest Linux baseline; re-apply admin password unless `--skip-admin-password`; `--skip-upgrade` skips image pull |
| `query` | Config summary; `--live` for Docker/HTTP probe on port 8090 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_YACY_ADMIN_PASSWORD` (required for deploy/maintain unless `--skip-admin-password`). Default YaCy UI login is `admin` with this password after deploy.

Example: `hdc run service yacy deploy --`

## SearXNG in this repo

- **Config:** [`clumps/services/searxng/config.json`](clumps/services/searxng/config.json) (copy from [`config.example.json`](clumps/services/searxng/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/searxng-a.json`](operations/inventory/systems/searxng-a.json); service sidecar [`operations/inventory/services/searxng.json`](operations/inventory/services/searxng.json).
- **Schema:** [`apps/hdc-cli/schema/searxng.config.schema.json`](apps/hdc-cli/schema/searxng.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (privileged, Docker) + official SearXNG Compose (`searxng` + `valkey`) in `/opt/searxng` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env` + `core-config/settings.yml`, `docker compose pull` + `up -d`; guest Linux baseline; `--skip-upgrade` skips image pull |
| `query` | Config summary; `--live` for Docker/HTTP probe on port 8080 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_SEARXNG_SECRET` (auto-generated on first deploy if missing). Internal LAN: browse `http://<ct-ip>:8080` (set `searxng.public_url` only when exposing via reverse proxy).

Example: `hdc run service searxng deploy --`

## Immich in this repo

- **Config:** [`clumps/services/immich/config.json`](clumps/services/immich/config.json) (copy from [`config.example.json`](clumps/services/immich/config.example.json); keep local config out of git).
- **Modes:** `synology-docker` (official compose on Synology via [`synology-nas`](clumps/infrastructure/synology-nas/) lib; `system_id` `immich-a`, `synology.instance` `a`) or `proxmox-qemu` / `configure-only` (Ubuntu VM + SSH; `vm-immich-a`).
- **Inventory:** [`operations/inventory/systems/immich-a.json`](operations/inventory/systems/immich-a.json) (NAS Docker), optional [`vm-immich-a.json`](operations/inventory/systems/vm-immich-a.json); [`nas-a.json`](operations/inventory/systems/nas-a.json); service sidecar [`operations/inventory/services/immich.json`](operations/inventory/services/immich.json).
- **Schema:** [`apps/hdc-cli/schema/immich.config.schema.json`](apps/hdc-cli/schema/immich.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | **Synology:** fetch release compose, push `.env` + stack to `/volume1/docker/immich` (`synology-docker`). **Proxmox:** QEMU clone + SSH install (`proxmox-qemu`; `--destroy-existing`, `--skip-provision`, …) |
| `maintain` | Re-push `.env`, `docker compose pull` + `up -d` (omit `--skip-upgrade`); **admin sync** via `PUT /api/system-config` when `system_config`, `mail.enabled`, or `public_url` set (`--skip-admin-sync`, optional `--test-email`); ClamAV baseline on Proxmox guests only (`--skip-clamav`) |
| `query` | Config summary; `--live` for compose health + `/api/server/ping`; `--admin` / `--import --yes` for sanitized `system_config` drift vs live (requires API key; single `--system-id`) |
| `teardown` | Synology: `docker compose down`. Proxmox: optional compose down then destroy QEMU (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `immich.public_url` (e.g. `https://immich.example.invalid`) for `IMMICH_SERVER_URL` in `.env` and `server.externalDomain` on admin sync. **`immich.mail.enabled`:** maps internal postfix-relay SMTP into `notifications.smtp` (`postfix-relay.home.example.invalid:25`, no auth). **`immich.system_config`:** full sanitized admin config from `query --import`; maintain deep-merges over live before PUT. Synology: `upload_location` / `db_data_location` under `/volume1/docker/immich/`. Proxmox: optional `data_disk_gb`; pin `proxmox.qemu.vmid`, `ip`, `configure.ssh.host`.

**HTTPS:** nginx-waf `sites[]` upstream `http://<nas-ip>:2283`; Cloudflare A `immich` → WAF WAN IP. Prerequisite: `hdc run infrastructure synology-nas maintain -- --instance a`.

Vault: `HDC_IMMICH_DB_PASSWORD` (required for deploy/maintain); `HDC_IMMICH_API_KEY` (admin API: `systemConfig.read` + `systemConfig.update` in Immich UI).

Example: `hdc run service immich query -- --system-id vm-immich-a --import --yes`

## Plex in this repo

- **Config:** [`clumps/services/plex/config.json`](clumps/services/plex/config.json) (copy from [`config.example.json`](clumps/services/plex/config.example.json); keep local config out of git).
- **Mode:** `synology-package` only — native DSM **PlexMediaServer** on [`nas-a`](operations/inventory/systems/nas-a.json) via `synology.instance` `a` (SSH through [`synology-nas`](clumps/infrastructure/synology-nas/)).
- **Inventory:** [`operations/inventory/systems/plex-a.json`](operations/inventory/systems/plex-a.json); service sidecar [`operations/inventory/services/plex.json`](operations/inventory/services/plex.json); host [`nas-a.json`](operations/inventory/systems/nas-a.json) lists `services: [{ "id": "plex" }]`.
- **Schema:** [`apps/hdc-cli/schema/plex.config.schema.json`](apps/hdc-cli/schema/plex.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Adopt existing package: verify `PlexMediaServer` installed, start if stopped, HTTP probe on `:32400/identity` (`install.enabled: false` skips SPK install) |
| `maintain` | `synopkg upgrade PlexMediaServer`; `--skip-upgrade` for health check only |
| `query` | Config summary; `--live` for synopkg status + HTTP probe |
| `teardown` | `synopkg stop` only (`--yes`; package stays installed) |

First install remains manual in DSM (Package Center or `.spk` from Plex.tv). LAN UI: `http://192.0.2.9:32400/web`. No vault secrets for v1.

Example: `hdc run service plex query -- --live`

## Gatus in this repo

- **Config:** [`clumps/services/gatus/config.json`](clumps/services/gatus/config.json) (copy from [`config.example.json`](clumps/services/gatus/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/gatus-a.json`](operations/inventory/systems/gatus-a.json); service sidecar [`operations/inventory/services/gatus.json`](operations/inventory/services/gatus.json).
- **Schema:** [`apps/hdc-cli/schema/gatus.config.schema.json`](apps/hdc-cli/schema/gatus.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (1 vCPU, 512 MiB RAM, 4 GiB rootfs) + Gatus built from GitHub release tarball (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `config.yaml` from `gatus.endpoints[]`; optional binary upgrade (omit `--skip-upgrade`) |
| `query` | Config summary; `--live` for systemd + HTTP probe on port 8080 |
| `teardown` | Destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Set `gatus.version` (e.g. `v5.36.0`) and `gatus.endpoints[]` in config. Alerting secrets may use `${ENV}` in `config_yaml_extra` (store values in vault; no `env_required` for v1).

Example: `hdc run service gatus deploy --`

## Globalping in this repo

- **Config:** [`clumps/services/globalping/config.json`](clumps/services/globalping/config.json) (copy from [`config.example.json`](clumps/services/globalping/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/globalping-a.json`](operations/inventory/systems/globalping-a.json); service sidecar [`operations/inventory/services/globalping.json`](operations/inventory/services/globalping.json).
- **Schema:** [`apps/hdc-cli/schema/globalping.config.schema.json`](apps/hdc-cli/schema/globalping.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 512 MiB RAM, 8 GiB rootfs) + Docker Globalping probe (`globalping/globalping-probe:latest`, host network; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from vault; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `globalping-probe` container status |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Monitoring IP range: see **Monitoring** group in `hdc-private/operations/ip-allocations.md`. Vault: `HDC_GLOBALPING_ADOPTION_TOKEN` (Globalping dashboard adoption token → `GP_ADOPTION_TOKEN`). No nginx-waf — outbound probe only. Confirm adoption at https://dash.globalping.io/probes after deploy.

Example: `hdc run service globalping deploy -- --instance a`

## CrowdSec in this repo

- **Config:** [`clumps/services/crowdsec/config.json`](clumps/services/crowdsec/config.json) (copy from [`config.example.json`](clumps/services/crowdsec/config.example.json)).
- **Inventory:** [`operations/inventory/systems/crowdsec-a.json`](operations/inventory/systems/crowdsec-a.json); service sidecar [`operations/inventory/services/crowdsec.json`](operations/inventory/services/crowdsec.json).
- **Proxmox:** `provision.guest_agents.crowdsec` (`lapi_url`, optional `collections[]`, `collections_by_service`); vault `HDC_CROWDSEC_ENROLL_KEY`.
- **UniFi:** remote syslog to LAPI CT (`crowdsec.unifi.syslog`); API bouncer sync to `crowdsec-block` group via `unifi-network` credentials; optional native UDM bouncer — [`docs/manually-deployed/crowdsec-unifi-bouncer.md`](docs/manually-deployed/crowdsec-unifi-bouncer.md).
- **Schema:** [`apps/hdc-cli/schema/crowdsec.config.schema.json`](apps/hdc-cli/schema/crowdsec.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC + CrowdSec LAPI + collections + UniFi rsyslog (`deployments[]`; `--instance a`; `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-apply LAPI; hub/collections refresh; UniFi syslog; `--sync-bouncers` for firewall (nginx-waf) and UniFi address-group bouncers; `--skip-upgrade`, `--skip-collections` |
| `query` | Config summary; `--live` for collections, syslog stats, decision counts, registered bouncers |
| `teardown` | Destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_CROWDSEC_ENROLL_KEY` (agent enrollment). UniFi API sync uses `HDC_UNIFI_NETWORK_API_KEY` (shared with **unifi-network**). Bouncer keys for firewall nodes are minted per sync via `cscli bouncers add`.

Example: `hdc run service crowdsec maintain -- --sync-bouncers`

## Wazuh in this repo

- **Config:** [`clumps/services/wazuh/config.json`](clumps/services/wazuh/config.json) (copy from [`config.example.json`](clumps/services/wazuh/config.example.json); keep local config out of git).
- **Modes:** `proxmox-lxc` (`wazuh-a`) or `proxmox-qemu` (`vm-wazuh-a` + `configure.ssh.host`).
- **Inventory:** [`operations/inventory/systems/wazuh-a.json`](operations/inventory/systems/wazuh-a.json) (LXC) or `vm-wazuh-a.json` (QEMU); service sidecar [`operations/inventory/services/wazuh.json`](operations/inventory/services/wazuh.json).
- **Proxmox:** `provision.guest_agents.wazuh.manager_host` → manager IP; vault `HDC_WAZUH_AGENT_PASSWORD`.
- **Schema:** [`apps/hdc-cli/schema/wazuh.config.schema.json`](apps/hdc-cli/schema/wazuh.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC or QEMU + Docker Compose Wazuh stack (`deployments[]`; `--instance a`; QEMU: `--destroy-existing`) |
| `maintain` | `docker compose pull` + `up -d`; guest Linux baseline (`--skip-wazuh-agent` on manager) |
| `query` | Config summary; `--live` for compose + dashboard probe |
| `teardown` | Optional compose down then destroy LXC or QEMU guest |

Vault: `HDC_WAZUH_API_PASSWORD`, `HDC_WAZUH_AGENT_PASSWORD`.

Example: `hdc run service wazuh deploy -- --instance a`

## Trivy in this repo

- **Config:** [`clumps/services/trivy/config.json`](clumps/services/trivy/config.json) (copy from [`config.example.json`](clumps/services/trivy/config.example.json)).
- **Inventory:** [`operations/inventory/systems/trivy-a.json`](operations/inventory/systems/trivy-a.json); service sidecar [`operations/inventory/services/trivy.json`](operations/inventory/services/trivy.json).
- **Schema:** [`apps/hdc-cli/schema/trivy.config.schema.json`](apps/hdc-cli/schema/trivy.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC + Trivy binary from GitHub release (`deployments[]`; `--instance a`) |
| `maintain` | Run `trivy` scans for `trivy.scan_targets[]` (SSH paths / docker compose dirs) |
| `query` | Config summary; `--live` for installed version |
| `teardown` | Destroy LXC |

No vault secrets for v1.

Example: `hdc run service trivy maintain --`

## WireGuard in this repo

- **Config:** [`clumps/services/wireguard/config.json`](clumps/services/wireguard/config.json) (copy from [`config.example.json`](clumps/services/wireguard/config.example.json)).
- **Inventory:** [`operations/inventory/systems/wireguard-a.json`](operations/inventory/systems/wireguard-a.json); service sidecar [`operations/inventory/services/wireguard.json`](operations/inventory/services/wireguard.json).
- **Schema:** [`apps/hdc-cli/schema/wireguard.config.schema.json`](apps/hdc-cli/schema/wireguard.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Privileged LXC hub + `wg0` from `wireguard.peers[]` |
| `maintain` | Re-push `/etc/wireguard/wg0.conf`; guest baseline |
| `query` | Config summary; `--live` for `wg show` |
| `teardown` | Destroy LXC |

Vault: `HDC_WIREGUARD_PRIVATE_KEY`; per-peer `HDC_WIREGUARD_PEER_*` keys from config. Publish UniFi UDP forward for `listen_port` (default 51820).

Example: `hdc run service wireguard deploy --`

## Keycloak in this repo

- **Config:** [`clumps/services/keycloak/config.json`](clumps/services/keycloak/config.json) (copy from [`config.example.json`](clumps/services/keycloak/config.example.json)). Optional split: `keycloak.realms[]` via `{ "$hdc.include": "realms/<id>.json" }` (see [`realms/example.json`](clumps/services/keycloak/realms/example.json)).
- **Inventory:** [`operations/inventory/systems/keycloak-a.json`](operations/inventory/systems/keycloak-a.json); service sidecar [`operations/inventory/services/keycloak.json`](operations/inventory/services/keycloak.json).
- **Database:** `keycloak.database.mode`: `bundled` (Postgres in Compose) or `external` (shared [`postgresql`](clumps/services/postgresql/) VM).
- **Schema:** [`apps/hdc-cli/schema/keycloak.config.schema.json`](apps/hdc-cli/schema/keycloak.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC + Docker Compose Keycloak (+ bundled Postgres when `database.mode` is `bundled`); Admin API reconcile of `realms[]` / users / clients / identity providers |
| `maintain` | Re-push compose env; `docker compose pull` + `up -d`; guest baseline; reconcile realms/users/clients/IdPs (`--skip-realms`, `--skip-identity-providers`, `--prune`, `--realm`, `--rotate-user-passwords`, `--rotate-client-secrets`, `--rotate-idp-secrets`, `--dry-run`) |
| `query` | Config summary; `--live` for HTTP health + realm/user/client/IdP drift |
| `teardown` | Optional compose down then destroy LXC |

Vault: `HDC_KEYCLOAK_ADMIN_PASSWORD`; `HDC_KEYCLOAK_DB_PASSWORD` (bundled or external); per-user `password_vault_key` (e.g. `HDC_KEYCLOAK_USER_HDC_ALICE_PASSWORD`); confidential clients use `secret_vault_key` (e.g. `HDC_WEB_OIDC_CLIENT_SECRET`); Microsoft (and other) IdPs use `client_id` + `client_secret_vault_key` (e.g. `HDC_KEYCLOAK_IDP_MICROSOFT_CLIENT_SECRET` — create the Entra secret manually; see the **azure** package). Realm `mail.enabled` maps SMTP to postfix-relay `client_defaults` (no auth). Declare OIDC clients under `realms[].clients[]` and brokers under `realms[].identity_providers[]` (reconciled on maintain). Set `keycloak.external_url` for the public HTTPS hostname.

Example: `hdc run service keycloak deploy --`

## Greenbone in this repo

- **Config:** [`clumps/services/greenbone/config.json`](clumps/services/greenbone/config.json) (copy from [`config.example.json`](clumps/services/greenbone/config.example.json)).
- **Inventory:** [`operations/inventory/systems/greenbone-a.json`](operations/inventory/systems/greenbone-a.json); service sidecar [`operations/inventory/services/greenbone.json`](operations/inventory/services/greenbone.json).
- **Schema:** [`apps/hdc-cli/schema/greenbone.config.schema.json`](apps/hdc-cli/schema/greenbone.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Privileged LXC (8 GiB+ RAM) + Greenbone Community Edition Compose |
| `maintain` | Re-push compose/env, `docker compose pull` + `up -d`; guest baseline |
| `query` | Config summary; `--live` for compose + HTTPS admin probe |
| `teardown` | Optional compose down then destroy LXC |

Vault: `HDC_GREENBONE_ADMIN_PASSWORD`. First bootstrap may take a long time for NVT feed sync.

Example: `hdc run service greenbone deploy --`

## Nagios in this repo

**Not deployed** (package and scripts retained for optional restore). Copy [`config.example.json`](clumps/services/nagios/config.example.json) to hdc-private `config.json` and restore inventory sidecars to re-enable.

- **Config:** [`clumps/services/nagios/config.example.json`](clumps/services/nagios/config.example.json) (live config in hdc-private when deployed).
- **BIND source:** `bind_config_path` — forward-zone A records become Nagios hosts with PING checks.
- **Schema:** [`apps/hdc-cli/schema/nagios.config.schema.json`](apps/hdc-cli/schema/nagios.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC, apt `nagios4`, push generated config from BIND (`deployments[]`; `--instance a\|b\|c`) |
| `maintain` | Regenerate from BIND and push to instances |
| `query` | Deployment summary + BIND host counts; `--live` for systemd/config per CT |

Example: `hdc run service nagios deploy -- --instance a`

## Hermes Agent in this repo

- **Config:** [`clumps/services/hermes/config.json`](clumps/services/hermes/config.json) (copy from [`config.example.json`](clumps/services/hermes/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/hermes-a.json`](operations/inventory/systems/hermes-a.json); service sidecar [`operations/inventory/services/hermes.json`](operations/inventory/services/hermes.json).
- **Schema:** [`apps/hdc-cli/schema/hermes.config.schema.json`](apps/hdc-cli/schema/hermes.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU Ubuntu VM (default) or LXC + Docker Hermes Agent; Ollama primary via `config.yaml`, OpenRouter fallback, Discord bot token (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env`, `config.yaml`, `docker compose pull` + `up -d`; guest Linux baseline (`--skip-upgrade`, `--skip-clamav`, …) |
| `query` | Config summary; `--live` for Docker + dashboard HTTP on port 9119 |
| `teardown` | Optional compose down then destroy QEMU or LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `hermes.ollama_backends[]` to local Ollama HTTP APIs and `hermes.model.default` to a pulled model tag. `hermes.fallback_providers[]` uses OpenRouter when local inference fails. `hermes.discord.enabled` maps vault `HDC_HERMES_DISCORD_BOT_TOKEN` → `DISCORD_BOT_TOKEN` in compose `.env`.

Vault: prefer `HDC_HERMES_OPENROUTER_API_KEY`; falls back to `HDC_OPENROUTER_API_KEY`. `HDC_HERMES_DASHBOARD_PASSWORD` required; `HDC_HERMES_DISCORD_BOT_TOKEN` when Discord is enabled; `HDC_HERMES_DASHBOARD_AUTH_SECRET` auto-generated if missing.

Example: `hdc run service hermes deploy -- --instance a`

## HDC Agents fleet in this repo

- **Config:** [`clumps/services/hdc-agents/config.json`](clumps/services/hdc-agents/config.json) (copy from [`config.example.json`](clumps/services/hdc-agents/config.example.json); keep local config in hdc-private).
- **Inventory:** [`operations/inventory/systems/hdc-agents-a.json`](operations/inventory/systems/hdc-agents-a.json); service sidecar [`operations/inventory/services/hdc-agents.json`](operations/inventory/services/hdc-agents.json).
- **Runtime:** [`apps/hdc-agent-server/`](apps/hdc-agent-server/) — A2A 0.3 + LiteLLM tool loop + scripted dispatcher + hdc-mcp-server role policy. Canonical agents/skills under `apps/hdc-agent-server/{agents,skills}/`.
- **Web UI / jobs API:** [`apps/hdc-web-server/`](apps/hdc-web-server/) on port **9120** (Tasks approval, schedules, inventory) — shipped with the hdc-agents guest (`meta_root` `/opt/hdc-agents-meta`).
- **Architecture:** [`docs/multi-agent-ops.md`](docs/multi-agent-ops.md).
- **Schema:** [`apps/hdc-cli/schema/hdc-agents.config.schema.json`](apps/hdc-cli/schema/hdc-agents.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | LXC (4 vCPU / 8 GiB / 32 GiB) + Docker Compose one container per roster agent (ports 9200–9206, 9208–9209) + hdc-web-server |
| `maintain` | Rebuild `hdc/agent-runtime`, push schedules/mail/discord, `up -d`, guest baseline |
| `query` | Config summary; `--live` for Docker + manager `/health` + web `:9120` |
| `teardown` | Compose down then destroy LXC |

Set `hdc_agents.schedules[]` with `cron`, `cli`, `cli_args`, and optional per-job `mail` / `discord`. The scripted dispatcher owns agent intervals; cron/schedules run deterministic hdc CLI (and `run-daily`). **Tasks UI:** hdc-web-server on `hdc-agents-a:9120` for approving guest-authoritative task files under hdc-private `operations/tasks/`.

Vault: per-role `HDC_AGENT_LITELLM_KEY_HDC_*`. Web UI: encrypted htpasswd login by default (`HDC_WEB_UI_SESSION_SECRET` encrypts `{metaRoot}/.htpasswd.enc`; optional vault `HDC_WEB_ADMIN_PASSWORD` for first admin bootstrap) plus `HDC_WEB_API_TOKEN` for agents. Optional Keycloak SSO when `hdc_agents.oidc` is set (`HDC_WEB_OIDC_CLIENT_SECRET` from keycloak maintain). Register agents on LiteLLM via `litellm.a2a_agents[]`. Deploy awaits [`plan.md`](../hdc-private/clumps/services/hdc-agents/plan.md) approval.

Example: `hdc run service hdc-agents deploy -- --instance a`

## Open WebUI in this repo

- **Config:** [`clumps/services/open-webui/config.json`](clumps/services/open-webui/config.json) (copy from [`config.example.json`](clumps/services/open-webui/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/open-webui-a.json`](operations/inventory/systems/open-webui-a.json); service sidecar [`operations/inventory/services/open-webui.json`](operations/inventory/services/open-webui.json).
- **Schema:** [`apps/hdc-cli/schema/open-webui.config.schema.json`](apps/hdc-cli/schema/open-webui.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (2 vCPU, 4 GiB RAM, 16 GiB rootfs) + Docker Open WebUI pointing at `open_webui.ollama_backends[]` via `OLLAMA_BASE_URLS` and optional `openai_backends[]` (LiteLLM / OpenAI-compatible) via `OPENAI_API_*` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--wipe-volumes`) |
| `maintain` | Re-push `.env` from config, `docker compose pull` + `up -d` (omit `--skip-upgrade` for image refresh) |
| `query` | Config summary; `--live` for Docker/HTTP probe on `host_port` (default 3000) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_OPEN_WEBUI_SECRET_KEY` (required for deploy/maintain); per `openai_backends[].api_key_vault_key` (e.g. `HDC_LITELLM_MASTER_KEY`). Set `ollama_backends[].url` to reachable Ollama APIs (e.g. `http://192.0.2.25:11434` for `vm-ollama-a`); does not bundle Ollama — use the `ollama` package for inference hosts. Optional LiteLLM: `openai_backends[].url` like `http://192.0.2.116:4000/v1`.

Example: `hdc run service open-webui deploy --`

## Vaultwarden in this repo

- **Config:** [`clumps/services/vaultwarden/config.json`](clumps/services/vaultwarden/config.json) (copy from [`config.example.json`](clumps/services/vaultwarden/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vaultwarden-a.json`](operations/inventory/systems/vaultwarden-a.json); service sidecar [`operations/inventory/services/vaultwarden.json`](operations/inventory/services/vaultwarden.json).
- **Schema:** [`apps/hdc-cli/schema/vaultwarden.config.schema.json`](apps/hdc-cli/schema/vaultwarden.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 16 GiB rootfs) + Docker Vaultwarden (`vaultwarden.domain` must be `https://…` for nginx-waf; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env` from config, `docker compose pull` + `up -d`, ClamAV baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/alive` on `vaultwarden.domain` |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_VAULTWARDEN_ADMIN_TOKEN` (required for deploy/maintain; stays in **local** hdc vault). After deploy, add BIND A record and nginx-waf `sites[]` upstream to the CT IP (port 80). Does not configure nginx-waf automatically.

**hdc secret backend:** When `HDC_VAULTWARDEN_URL` and `HDC_VAULTWARDEN_EMAIL` (or personal API key `HDC_VAULTWARDEN_KEY_CLIENT_ID` + `HDC_VAULTWARDEN_KEY_CLIENT_SECRET`) are set, `HDC_SECRET_BACKEND=auto` (default) routes `getSecret` / `secrets set` through **Bitwarden CLI (`bw`)** against Vaultwarden. Login items live in the **HDC organization** (`HDC_VAULTWARDEN_ORGANIZATION_ID` or name `HDC`) and **collection** (`HDC_VAULTWARDEN_COLLECTION_ID`); item names match env keys (`HDC_PROXMOX_API_TOKEN`, …). **Website URLs** on login items are derived from clump configs (`secrets sync-uris`; also set on `secrets push` / `secrets set` when a URL is known). Bootstrap keys stay local only: `HDC_VAULTWARDEN_MASTER_PASSWORD`, `HDC_VAULTWARDEN_ADMIN_TOKEN`, `HDC_VAULTWARDEN_KEY_CLIENT_ID`, `HDC_VAULTWARDEN_KEY_CLIENT_SECRET`. Bulk migrate: `secrets push --force`. Unlock: masked master-password prompt, or `secrets unlock`. See [`docs/manually-deployed/bitwarden-cli.md`](docs/manually-deployed/bitwarden-cli.md).

Example: `hdc run service vaultwarden deploy -- --instance a`

## Mailcow in this repo

- **Config:** [`clumps/services/mailcow/config.json`](clumps/services/mailcow/config.json) (copy from [`config.example.json`](clumps/services/mailcow/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/mailcow-a.json`](operations/inventory/systems/mailcow-a.json) (LXC), [`vm-mailcow-a.json`](operations/inventory/systems/vm-mailcow-a.json) (QEMU); service sidecar [`operations/inventory/services/mailcow.json`](operations/inventory/services/mailcow.json).
- **Schema:** [`apps/hdc-cli/schema/mailcow.config.schema.json`](apps/hdc-cli/schema/mailcow.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC or QEMU: mailcow-dockerized clone + `generate_config.sh`; reconcile `domains[]` + DKIM + relay + `mailboxes[]` / `aliases[]` via Mailcow API; publish DKIM TXT to Cloudflare when token present (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--destroy-existing`, `--skip-provision` for QEMU, `--skip-domains`, `--skip-cloudflare-dkim`, `--skip-mailboxes`, `--skip-aliases`, `--prune`) |
| `maintain` | `docker compose pull` + `up -d`; reconcile `domains[]`, `mailboxes[]`, `aliases[]` via Mailcow API; publish DKIM TXT to Cloudflare (`--skip-domains`, `--skip-mailboxes`, `--skip-aliases`, `--skip-cloudflare-dkim`, `--skip-upgrade`, `--prune`, `--rotate-mailbox-passwords`); guest baseline with `--skip-mail-relay` |
| `query` | Config summary; `--live` for Docker/admin probe, domain/mailbox/alias drift, DNS checklist (MX/SPF/DKIM/DMARC) |
| `teardown` | Optional compose down then destroy LXC or QEMU (`--dry-run`, `--yes`, `--skip-compose-down`) |

QEMU: set `mode: proxmox-qemu`, `system_id: vm-mailcow-a`, `proxmox.qemu` (`template_vmid`, `ip`, `vmid`, optional `data_disk_gb` + `data_disk_storage`), `configure.ssh.host`. Data disk mounts at `/data/mailcow`; Docker data-root on the data mount when `data_disk_gb` > 0.

Set `mailcow.hostname` (MAILCOW_HOSTNAME FQDN), optional `mailcow.api_url` (defaults to `https://{hostname}`; `admin_url` is for browser UI via nginx-waf), and `mailcow.domains[]` with `outbound.mode`: `direct` (mailcow sends) or `postfix-relay` (internal smarthost from [`postfix-relay` config](clumps/services/postfix-relay/config.json) `client_defaults`). Nest `mailboxes[]` (`local_part`, `name`, `quota_mb`, `password_vault_key`) and `aliases[]` (`address`, `goto[]`) under each domain. MX/SPF/DMARC: publish via BIND or [`cloudflare`](clumps/infrastructure/cloudflare/) config. DKIM TXT: auto-published to Cloudflare when `HDC_CLOUDFLARE_API_TOKEN` is set and `mailcow.dns_publish.cloudflare_dkim` is not false.

Vault: `HDC_MAILCOW_DBPASS`, `HDC_MAILCOW_DBROOT`, `HDC_MAILCOW_REDISPASS` (auto-generated on first deploy if missing); `HDC_MAILCOW_API_KEY` (create in Mailcow admin after deploy; required for API reconciliation); per-mailbox `password_vault_key` values (auto-generated on first maintain when missing).

Example: `hdc run service mailcow deploy -- --instance a --destroy-existing`

## Wallos in this repo

- **Config:** [`clumps/services/wallos/config.json`](clumps/services/wallos/config.json) (copy from [`config.example.json`](clumps/services/wallos/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/wallos-a.json`](operations/inventory/systems/wallos-a.json); service sidecar [`operations/inventory/services/wallos.json`](operations/inventory/services/wallos.json).
- **Schema:** [`apps/hdc-cli/schema/wallos.config.schema.json`](apps/hdc-cli/schema/wallos.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 16 GiB rootfs) + Docker Wallos (`bellamy/wallos`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 8282) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1 — complete first-run admin setup in the web UI after deploy. `wallos.public_url` is optional (set when adding nginx-waf later). Data persists under `/opt/wallos/db` and `/opt/wallos/logos` on the CT.

Example: `hdc run service wallos deploy -- --instance a`

## Memos in this repo

- **Config:** [`clumps/services/memos/config.json`](clumps/services/memos/config.json) (copy from [`config.example.json`](clumps/services/memos/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/memos-a.json`](operations/inventory/systems/memos-a.json); service sidecar [`operations/inventory/services/memos.json`](operations/inventory/services/memos.json).
- **Schema:** [`apps/hdc-cli/schema/memos.config.schema.json`](apps/hdc-cli/schema/memos.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 16 GiB rootfs) + Docker Memos (`neosmemo/memos`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 5230) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1 — create the first account in the Memos web UI after deploy. `memos.public_url` is optional (set when adding nginx-waf later). Data persists under `/opt/memos/data` on the CT.

Example: `hdc run service memos deploy -- --instance a`

## MeshCentral in this repo

- **Config:** [`clumps/services/meshcentral/config.json`](clumps/services/meshcentral/config.json) (copy from [`config.example.json`](clumps/services/meshcentral/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/meshcentral-a.json`](operations/inventory/systems/meshcentral-a.json); service sidecar [`operations/inventory/services/meshcentral.json`](operations/inventory/services/meshcentral.json).
- **Schema:** [`apps/hdc-cli/schema/meshcentral.config.schema.json`](apps/hdc-cli/schema/meshcentral.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker MeshCentral + MongoDB (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from vault; `docker compose pull` + `up -d`; guest Linux baseline; **or** device ops: `--device` + `--power wake\|on\|off\|reset\|sleep`, `--updates`, `--install`/`--remove`, `--disk`, `--dry-run` |
| `query` | Config summary; `--live` for Docker/HTTP (port 4430) **and** MeshCentral device list via API; `--device` for disk/info; `--import --yes` upserts `meshcentral.devices[]` |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `meshcentral.public_url` (`https://…`) for TLS offload behind nginx-waf. Vault: `HDC_MESHCENTRAL_MONGO_PASSWORD` (auto-generated on first deploy if missing); `HDC_MESHCENTRAL_USERNAME` / `HDC_MESHCENTRAL_PASSWORD` (MeshCentral account for device API). BIND CNAME `meshcentral` → nginx-waf; upstream `http://<ct-ip>:4430` with WebSockets. Create the first admin account in the web UI after deploy, then install agents. Device management coexists with WinRM/SSH client packages.

Examples:

```bash
hdc run service meshcentral deploy -- --instance a
hdc run service meshcentral query -- --live
hdc run service meshcentral query -- --import --yes
hdc run service meshcentral maintain -- --device lan-1 --power wake
```

## Rackula in this repo

- **Config:** [`clumps/services/rackula/config.json`](clumps/services/rackula/config.json) (copy from [`config.example.json`](clumps/services/rackula/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/rackula-a.json`](operations/inventory/systems/rackula-a.json); service sidecar [`operations/inventory/services/rackula.json`](operations/inventory/services/rackula.json).
- **Schema:** [`apps/hdc-cli/schema/rackula.config.schema.json`](apps/hdc-cli/schema/rackula.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 1 GiB RAM, 8 GiB rootfs) + Docker Rackula with persistence (`rackula:persist` + `rackula-api`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml` + `.env`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Optional vault `HDC_RACKULA_API_WRITE_TOKEN` when `rackula.api_write_token_enabled` is true (API PUT/DELETE protection). LAN UI: `http://<ct-ip>:8080`. Layouts persist under `/opt/rackula/data` (UID 1001).

Example: `hdc run service rackula deploy -- --instance a`

## OpenSpeedTest in this repo

- **Config:** [`clumps/services/openspeedtest/config.json`](clumps/services/openspeedtest/config.json) (copy from [`config.example.json`](clumps/services/openspeedtest/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/openspeedtest-a.json`](operations/inventory/systems/openspeedtest-a.json); service sidecar [`operations/inventory/services/openspeedtest.json`](operations/inventory/services/openspeedtest.json).
- **Schema:** [`apps/hdc-cli/schema/openspeedtest.config.schema.json`](apps/hdc-cli/schema/openspeedtest.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 512 MiB RAM, 8 GiB rootfs) + Docker OpenSpeedTest (`openspeedtest/latest`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 3000) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1. LAN UI: `http://<ct-ip>:3000`. Optional `openspeedtest.public_url` when adding nginx-waf later.

Example: `hdc run service openspeedtest deploy -- --instance a`

## A2A Registry in this repo

**Not deployed** — replaced by LiteLLM A2A gateway (`litellm.a2a_agents[]`). Package retained for reference like Nagios.

- **Config:** [`clumps/services/a2a-registry/config.example.json`](clumps/services/a2a-registry/config.example.json) (no live hdc-private config).
- **Schema:** [`apps/hdc-cli/schema/a2a-registry.config.schema.json`](apps/hdc-cli/schema/a2a-registry.config.schema.json).

Use **litellm** `a2a_agents[]` and [docs/multi-agent-ops.md](docs/multi-agent-ops.md) instead of standing up this in-memory registry.

## IT-Tools in this repo

- **Config:** [`clumps/services/it-tools/config.json`](clumps/services/it-tools/config.json) (copy from [`config.example.json`](clumps/services/it-tools/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/it-tools-a.json`](operations/inventory/systems/it-tools-a.json); service sidecar [`operations/inventory/services/it-tools.json`](operations/inventory/services/it-tools.json).
- **Schema:** [`apps/hdc-cli/schema/it-tools.config.schema.json`](apps/hdc-cli/schema/it-tools.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 512 MiB RAM, 8 GiB rootfs) + Docker IT-Tools (`corentinth/it-tools:latest`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1. LAN UI: `http://<ct-ip>:8080`. Optional `it_tools.public_url` when adding nginx-waf later.

Example: `hdc run service it-tools deploy -- --instance a`

## OmniTools in this repo

- **Config:** [`clumps/services/omni-tools/config.json`](clumps/services/omni-tools/config.json) (copy from [`config.example.json`](clumps/services/omni-tools/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/omni-tools-a.json`](operations/inventory/systems/omni-tools-a.json); service sidecar [`operations/inventory/services/omni-tools.json`](operations/inventory/services/omni-tools.json).
- **Schema:** [`apps/hdc-cli/schema/omni-tools.config.schema.json`](apps/hdc-cli/schema/omni-tools.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (1 vCPU, 512 MiB RAM, 8 GiB rootfs) + Docker OmniTools (`iib0011/omni-tools:latest`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `docker-compose.yml`; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on `host_port` (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1. LAN UI: `http://<ct-ip>:8080`. Optional `omni_tools.public_url` when adding nginx-waf later.

Example: `hdc run service omni-tools deploy -- --instance a`

## Stirling PDF in this repo

- **Config:** [`clumps/services/stirling-pdf/config.json`](clumps/services/stirling-pdf/config.json) (copy from [`config.example.json`](clumps/services/stirling-pdf/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/stirling-pdf-a.json`](operations/inventory/systems/stirling-pdf-a.json); service sidecar [`operations/inventory/services/stirling-pdf.json`](operations/inventory/services/stirling-pdf.json).
- **Schema:** [`apps/hdc-cli/schema/stirling-pdf.config.schema.json`](apps/hdc-cli/schema/stirling-pdf.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 24 GiB rootfs) + Docker Stirling PDF (`stirlingtools/stirling-pdf:latest`; `deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from vault; `docker compose pull` + `up -d`; guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/api/v1/info/status` on `host_port` (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Vault: `HDC_STIRLING_PDF_ADMIN_PASSWORD` (initial admin login when `stirling_pdf.security.enable_login` is true). LAN UI: `http://<ct-ip>:8080`. Optional `stirling_pdf.public_url` when adding nginx-waf later (raise `client_max_body_size` for large PDF uploads).

Example: `hdc run service stirling-pdf deploy -- --instance a`

## n8n in this repo

- **Config:** [`clumps/services/n8n/config.json`](clumps/services/n8n/config.json) (copy from [`config.example.json`](clumps/services/n8n/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/n8n-a.json`](operations/inventory/systems/n8n-a.json); service sidecar [`operations/inventory/services/n8n.json`](operations/inventory/services/n8n.json).
- **Schema:** [`apps/hdc-cli/schema/n8n.config.schema.json`](apps/hdc-cli/schema/n8n.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker n8n with SQLite (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `.env` from config, `docker compose pull` + `up -d`, ClamAV baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/healthz` on port 5678 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `n8n.public_url` (`https://…`) when using nginx-waf for webhooks and UI; omit for HTTP on the CT IP only. Vault: `HDC_N8N_ENCRYPTION_KEY` (required for credential encryption; auto-generated on first deploy if missing). After deploy, add BIND A record and nginx-waf `sites[]` upstream to `http://<ct-ip>:5678` when using a public hostname.

Example: `hdc run service n8n deploy -- --instance a`

## Listmonk in this repo

- **Config:** [`clumps/services/listmonk/config.json`](clumps/services/listmonk/config.json) (copy from [`config.example.json`](clumps/services/listmonk/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/listmonk-a.json`](operations/inventory/systems/listmonk-a.json); service sidecar [`operations/inventory/services/listmonk.json`](operations/inventory/services/listmonk.json).
- **Schema:** [`apps/hdc-cli/schema/listmonk.config.schema.json`](apps/hdc-cli/schema/listmonk.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker Listmonk + PostgreSQL (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/api/health` on port 9000 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `listmonk.public_url` (`https://…`) when using nginx-waf; omit for HTTP on the CT IP only. Vault: `HDC_LISTMONK_ADMIN_PASSWORD` (required before deploy; creates super-admin on first `compose up`); `HDC_LISTMONK_DB_PASSWORD` (auto-generated on first deploy if missing). Optional `listmonk.mail.enabled` maps internal postfix-relay to `LISTMONK_smtp__main__*` env vars; otherwise configure SMTP in the Listmonk UI. After deploy, add BIND A record and nginx-waf `sites[]` upstream to `http://<ct-ip>:9000` when using a public hostname.

Example: `hdc run service listmonk deploy -- --instance a`

## Shlink in this repo

- **Config:** [`clumps/services/shlink/config.json`](clumps/services/shlink/config.json) (copy from [`config.example.json`](clumps/services/shlink/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/shlink-a.json`](operations/inventory/systems/shlink-a.json); service sidecar [`operations/inventory/services/shlink.json`](operations/inventory/services/shlink.json).
- **Schema:** [`apps/hdc-cli/schema/shlink.config.schema.json`](apps/hdc-cli/schema/shlink.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker Shlink + PostgreSQL + Redis + optional web client (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/rest/health` on port 8080 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `shlink.default_domain` and `shlink.public_url` (`https://…`) when using nginx-waf for short links and the REST API; set `shlink.web_client.public_url` for the admin UI. Vault: `HDC_SHLINK_DB_PASSWORD` and `HDC_SHLINK_INITIAL_API_KEY` (auto-generated on first deploy if missing); optional `HDC_SHLINK_GEOLITE_LICENSE_KEY` for visit geolocation. After deploy, add BIND A records and nginx-waf `sites[]` upstreams to `http://<ct-ip>:8080` (short/API) and `http://<ct-ip>:8081` (web client).

Example: `hdc run service shlink deploy -- --instance a`

## Vikunja in this repo

- **Config:** [`clumps/services/vikunja/config.json`](clumps/services/vikunja/config.json) (copy from [`config.example.json`](clumps/services/vikunja/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vikunja-a.json`](operations/inventory/systems/vikunja-a.json); service sidecar [`operations/inventory/services/vikunja.json`](operations/inventory/services/vikunja.json).
- **Schema:** [`apps/hdc-cli/schema/vikunja.config.schema.json`](apps/hdc-cli/schema/vikunja.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (2 vCPU, 2 GiB RAM, 20 GiB rootfs) + Docker Vikunja + PostgreSQL (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + `/api/v1/info` on port 3456 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `vikunja.public_url` (`https://…/` with trailing slash) when using nginx-waf. Vault: `HDC_VIKUNJA_JWT_SECRET` and `HDC_VIKUNJA_DB_PASSWORD` (auto-generated on first deploy if missing). Optional `vikunja.mail.enabled` maps internal postfix-relay to `VIKUNJA_MAILER_*` env vars. Register the first account in the Vikunja UI after deploy. nginx-waf upstream: `http://<ct-ip>:3456` with WebSockets enabled.

Example: `hdc run service vikunja deploy -- --instance a`

## Paperless-ngx in this repo

- **Config:** [`clumps/services/paperless-ngx/config.json`](clumps/services/paperless-ngx/config.json) (copy from [`config.example.json`](clumps/services/paperless-ngx/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/paperless-ngx-a.json`](operations/inventory/systems/paperless-ngx-a.json); service sidecar [`operations/inventory/services/paperless-ngx.json`](operations/inventory/services/paperless-ngx.json).
- **Schema:** [`apps/hdc-cli/schema/paperless-ngx.config.schema.json`](apps/hdc-cli/schema/paperless-ngx.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (4 vCPU, 6 GiB RAM, 64 GiB rootfs) + Docker Paperless-ngx + PostgreSQL + Redis; optional Tika/Gotenberg when `paperless_ngx.tika_enabled` is true (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` / `paperless.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`) |
| `query` | Config summary; `--live` for Docker + HTTP probe on port 8000 |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Set `paperless_ngx.public_url` (`https://…`) when using nginx-waf. Vault: `HDC_PAPERLESS_SECRET_KEY` and `HDC_PAPERLESS_DB_PASSWORD` (auto-generated on first deploy if missing). Optional `paperless_ngx.admin.enabled` + `HDC_PAPERLESS_ADMIN_PASSWORD` for first-boot superuser. Drop files in `/opt/paperless-ngx/consume` for automatic import. nginx-waf upstream: `http://<ct-ip>:8000` (consider larger `client_max_body_size` for uploads).

Example: `hdc run service paperless-ngx deploy -- --instance a`

## Paperclip in this repo

- **Config:** [`clumps/services/paperclip/config.json`](clumps/services/paperclip/config.json) (copy from [`config.example.json`](clumps/services/paperclip/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/paperclip-a.json`](operations/inventory/systems/paperclip-a.json); service sidecar [`operations/inventory/services/paperclip.json`](operations/inventory/services/paperclip.json).
- **Schema:** [`apps/hdc-cli/schema/paperclip.config.schema.json`](apps/hdc-cli/schema/paperclip.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (4 vCPU, 8 GiB RAM, 32 GiB rootfs) + Docker Paperclip + PostgreSQL from `ghcr.io/paperclipai/paperclip` (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push compose + `.env` from config, `docker compose pull` + `up -d`, guest Linux baseline (omit `--skip-clamav`); adopts live guest secrets into vault when they differ (no automatic volume wipe); `--reset-db --yes` destroys volumes for a full reset |
| `query` | Config summary; `--live` for Docker + `/api/health` on port 3100; `--bootstrap-company --yes` imports HDC skills and agents (see [`docs/manually-deployed/paperclip-hdc-company.md`](docs/manually-deployed/paperclip-hdc-company.md)) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

Default deployment mode is **authenticated/private** (login required on LAN). Optional `paperclip.public_url` when adding nginx-waf later. Vault: `HDC_PAPERCLIP_BETTER_AUTH_SECRET` and `HDC_PAPERCLIP_DB_PASSWORD` (auto-generated on first deploy if missing); `HDC_PAPERCLIP_API_KEY` for company bootstrap. **HDC skills** under [`clumps/services/paperclip/skills/`](clumps/services/paperclip/skills/) target **hdc-web-server** / the **hdc-agents** fleet (`HDC_WEB_API_TOKEN`). After deploy, open the LAN URL and **Claim this instance** in the browser for first admin (CLI fallback: `paperclipai auth bootstrap-ceo` in the server container). Pin `paperclip.image_tag` to a [GitHub release tag](https://github.com/paperclipai/paperclip/releases).

Example: `hdc run service paperclip deploy -- --instance a`

## Home Assistant in this repo

- **Config:** [`clumps/services/homeassistant/config.json`](clumps/services/homeassistant/config.json) (copy from [`config.example.json`](clumps/services/homeassistant/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-homeassistant-a.json`](operations/inventory/systems/vm-homeassistant-a.json); service sidecar [`operations/inventory/services/homeassistant.json`](operations/inventory/services/homeassistant.json).
- **Schema:** [`apps/hdc-cli/schema/homeassistant.config.schema.json`](apps/hdc-cli/schema/homeassistant.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU on configured host (e.g. `pve-h`): import HAOS OVA qcow2, USB passthrough for Zigbee/Z-Wave; when `public_url` is HTTPS, sync nginx-waf `trusted_proxies` into HAOS `configuration.yaml` (`deployments[]`; `--instance a`, `--destroy-existing`, `--usb-id`, `--no-wait-http`, `--skip-reverse-proxy`) |
| `maintain` | Sync nginx-waf `trusted_proxies` when `public_url` is HTTPS; HTTP probe on port 8123; `--reapply-usb` to refresh USB mapping; `--skip-reverse-proxy` to skip |
| `query` | Config summary; `--live` for Proxmox guest + HTTP probe |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Pin `homeassistant.release` (HAOS version). Set static IP in HA UI if deploy HTTP wait fails. When exposed via nginx-waf (`public_url` `https://…`), `deploy`/`maintain` write `http.trusted_proxies` for `vm-nginx-waf-a`/`vm-nginx-waf-b` LAN IPs (or `homeassistant.trusted_proxies[]` override). No vault secrets for v1.

Example: `hdc run service homeassistant deploy -- --instance a --destroy-existing`

## Kali desktop in this repo

- **Config:** [`clumps/services/kali-desktop/config.json`](clumps/services/kali-desktop/config.json) (copy from [`config.example.json`](clumps/services/kali-desktop/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-kali-a.json`](operations/inventory/systems/vm-kali-a.json); service sidecar [`operations/inventory/services/kali-desktop.json`](operations/inventory/services/kali-desktop.json).
- **Schema:** [`apps/hdc-cli/schema/kali-desktop.config.schema.json`](apps/hdc-cli/schema/kali-desktop.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Build Kali cloud-init QEMU template (`--build-template`; download + `virt-customize` on hypervisor), clone, cloud-init static IP (`deployments[]`; `--instance a`, `--destroy-existing`) |
| `maintain` | Guest Linux baseline, optional apt upgrade, CPU/RAM sync (`--skip-package-upgrade`, `--skip-clamav`) |
| `query` | Config summary; `--live` for guest agent + SSH |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Hypervisor prerequisites for template build: `libguestfs-tools`, `p7zip-full`. Vault: `HDC_KALI_DESKTOP_PASSWORD` (cloud-init password for user `kali`). Default image: Kali `qemu-amd64.7z` from `cdimage.kali.org`.

Example:

```bash
hdc run service kali-desktop deploy -- --instance a --build-template
hdc run service kali-desktop deploy -- --instance a
```

## Windows desktop in this repo

- **Config:** [`clumps/services/windows-desktop/config.json`](clumps/services/windows-desktop/config.json) (copy from [`config.example.json`](clumps/services/windows-desktop/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-win11-a.json`](operations/inventory/systems/vm-win11-a.json); service sidecar [`operations/inventory/services/windows-desktop.json`](operations/inventory/services/windows-desktop.json).
- **Schema:** [`apps/hdc-cli/schema/windows-desktop.config.schema.json`](apps/hdc-cli/schema/windows-desktop.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | **Template:** `--build-template` — verified ISO install + Sysprep + Proxmox template on configured `proxmox.template.vmid`. **Instance:** `proxmox-qemu-clone` (default) full clone + specialize autounattend + OEM MSDM/SLIC; or `proxmox-qemu-iso` one-shot ISO install. OVMF/TPM/VirtIO; `disk_format: raw` on `local-lvm` (`deployments[]`; `--instance a`, `--destroy-existing`, `--skip-oem`, `--skip-install`, `--wait-install`, `--refresh-iso`, `--force-rebuild-template`) |
| `maintain` | Re-dump and re-apply OEM ACPI tables + SMBIOS on the guest |
| `query` | Config summary; `--live` for VM power state and OEM probe on hypervisor |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_WINDOWS_DESKTOP_ADMIN_PASSWORD` (required). Windows + virtio-win ISOs on the node (`proxmox.iso.windows_volid`, `virtio_volid`); optional `download_url` + `sha256` verify. VirtIO URL: `…/stable-virtio/virtio-win.iso`. **One** OEM-licensed Windows VM per hypervisor (OEM on clone deploy, not template builder).

Examples:

```bash
hdc run service windows-desktop deploy -- --build-template --destroy-existing --wait-install
hdc run service windows-desktop deploy -- --instance a --wait-install
```

## Nextcloud in this repo

- **Config:** [`clumps/services/nextcloud/config.json`](clumps/services/nextcloud/config.json) (copy from [`config.example.json`](clumps/services/nextcloud/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/nextcloud-a.json`](operations/inventory/systems/nextcloud-a.json); service sidecar [`operations/inventory/services/nextcloud.json`](operations/inventory/services/nextcloud.json).
- **Schema:** [`apps/hdc-cli/schema/nextcloud.config.schema.json`](apps/hdc-cli/schema/nextcloud.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC on `hypervisor-a` (4 vCPU, 8 GiB RAM, 64 GiB rootfs, privileged + nesting) + Nextcloud AIO mastercontainer via Docker Compose (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Re-push `compose.yaml` from config, `docker compose pull` + `up -d` for mastercontainer (omit `--skip-upgrade`); ClamAV unless `--skip-clamav`. Full stack updates remain in the AIO UI. |
| `query` | Config summary; `--live` for Docker/mastercontainer and HTTPS probe on AIO interface port (default 8080) |
| `teardown` | Optional `docker compose down` then destroy LXC (`--dry-run`, `--yes`, `--skip-compose-down`) |

No vault secrets for v1. After deploy, open `https://<ct-ip>:8080` (use IP, not domain, per AIO HSTS guidance) and complete the AIO wizard. For nginx-waf, set `nextcloud.aio.reverse_proxy.enabled` and follow [AIO reverse-proxy docs](https://github.com/nextcloud/all-in-one/blob/main/reverse-proxy.md).

Example: `hdc run nextcloud deploy --`

## Postiz in this repo

- **Config:** [`clumps/services/postiz/config.json`](clumps/services/postiz/config.json) (copy from [`config.example.json`](clumps/services/postiz/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/postiz-a.json`](operations/inventory/systems/postiz-a.json); service sidecar [`operations/inventory/services/postiz.json`](operations/inventory/services/postiz.json).
- **Schema:** [`apps/hdc-cli/schema/postiz.config.schema.json`](apps/hdc-cli/schema/postiz.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC (4 vCPU, 8 GiB RAM, 20 GiB rootfs) + native Postiz from GitHub tarball: PostgreSQL, Redis, Temporal dev server, pnpm build, nginx on port 80 (`deployments[]`; `--instance a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`) |
| `maintain` | Upgrade to `postiz.version` / latest (`--check-latest`, `--version <tag>`); `--rebuild` after URL or `env_extra` changes (`NEXT_PUBLIC_*` baked at build); `--skip-upgrade` for service restart only; ClamAV unless `--skip-clamav` |
| `query` | Config summary; `--live` for systemd, nginx test, HTTP probe on `listen_port` |
| `teardown` | Stop Postiz systemd units then destroy LXC (`--dry-run`, `--yes`, `--instance`) |

Vault: `HDC_POSTIZ_DB_PASSWORD`, `HDC_POSTIZ_JWT_SECRET` (auto-generated on first deploy if missing). Set `postiz.public_url` before deploy when using a stable HTTPS URL; otherwise deploy uses CT IP and `maintain --rebuild` after nginx-waf. Community helper script is marked in development — pin `postiz.version` after validation.

Example: `hdc run service postiz deploy --`

## LMS (LM Studio) in this repo

- **Config:** [`clumps/services/lms/config.json`](clumps/services/lms/config.json) (copy from [`config.example.json`](clumps/services/lms/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/vm-lms-a.json`](operations/inventory/systems/vm-lms-a.json); service sidecar [`operations/inventory/services/lms.json`](operations/inventory/services/lms.json).
- **Schema:** [`apps/hdc-cli/schema/lms.config.schema.json`](apps/hdc-cli/schema/lms.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox QEMU Ubuntu clone, cloud-init static IP, llmster via `https://lmstudio.ai/install.sh`, systemd `lmstudio.service` (`deployments[]`; `--instance a`; `--destroy-existing`, `--skip-provision`, `--skip-install`, `--skip-models`) |
| `maintain` | Re-run install.sh, restart service, sync `lms.models[]` via `lms get`; guest Linux baseline; Proxmox CPU/RAM sync (`--skip-models`, `--skip-resources`, `--prune` ignored for removals) |
| `query` | Config summary; `--live` for systemd, `lms ls`, HTTP `/v1/models` |
| `teardown` | Destroy QEMU guest (`--dry-run`, `--yes`, `--instance`) |

Set `lms.load_on_start` to pin a model at boot. Optional `install.gpu` + `hostpci[]` for NVIDIA passthrough (hypervisor VFIO required). API default: `http://<guest-ip>:1234`.

No vault secrets for v1.

Example: `hdc run service lms deploy -- --instance a`

## Llama.cpp in this repo

- **Config:** [`clumps/services/llama-cpp/config.json`](clumps/services/llama-cpp/config.json) (copy from [`config.example.json`](clumps/services/llama-cpp/config.example.json); keep local config out of git).
- **Inventory:** optional [`operations/inventory/systems/llama-cpp-{a,b}.json`](operations/inventory/systems/) (LXC) or `vm-llama-cpp-a.json` (QEMU GPU).
- **Schema:** [`apps/hdc-cli/schema/llama-cpp.config.schema.json`](apps/hdc-cli/schema/llama-cpp.config.schema.json).

| Verb | Summary |
| --- | --- |
| `deploy` | Proxmox LXC or QEMU + `llama-server` from GitHub releases (`deployments[]`; per-deployment `install.backend`: cpu/cuda/vulkan/rocm; `--instance a`; QEMU: `--destroy-existing`, `--skip-provision`) |
| `maintain` | Upgrade binary to latest/pinned release and restart `llama-server`; guest Linux baseline on QEMU/LXC (`--skip-restart` optional) |
| `query` | Config summary; `--live` for systemd/health (LXC via `pct exec`, QEMU via SSH; GPU name when CUDA) |
| `teardown` | Destroy LXC or QEMU guests (`--dry-run`, `--yes`, `--instance`) |

**QEMU GPU (`vm-llama-cpp-a`):** `mode: proxmox-qemu`, `proxmox.qemu.hostpci[]`, `install.backend: vulkan` (or `cuda` if you build from source — upstream no longer ships Ubuntu CUDA tarballs). Installs NVIDIA drivers in guest for GPU passthrough. Complete VFIO/IOMMU on the Proxmox host before deploy; PCI BDF from `lspci`.

Set `server.model` or `server.hf_model` in config to enable and start the unit at deploy; otherwise install leaves the service disabled until a model is configured.

Example: `hdc run service llama-cpp deploy -- --instance a --destroy-existing`

## Home clients in this repo

- **Config:** per-clump `config.json` under `clumps/clients/{windows,ubuntu,raspberrypi}/` (copy from each `config.example.json`; keep local config out of git).
- **Packages:** [`clumps/clients/windows/`](clumps/clients/windows/), [`clumps/clients/ubuntu/`](clumps/clients/ubuntu/) (manifest id `client-ubuntu`), [`clumps/clients/raspberrypi/`](clumps/clients/raspberrypi/).
- **Inventory:** manual `operations/inventory/systems/*.json` with `automation_targets: ["client"]`, `access.nodes[]` with `ip`, `mac`, and `ssh` or `winrm` as needed.
- **Schema:** [`apps/hdc-cli/schema/client.config.schema.json`](apps/hdc-cli/schema/client.config.schema.json).
- **Docs:** [`docs/manually-deployed/client-winrm.md`](docs/manually-deployed/client-winrm.md), [`docs/manually-deployed/client-wol.md`](docs/manually-deployed/client-wol.md).

| Command | Summary |
| --- | --- |
| `run client windows maintain` | WinRM disk + Windows Update (PSWindowsUpdate on target); WoL if offline; auto WinRM bootstrap via PsExec when HTTPS port closed; optional Ollama Windows service when `hosts[].ollama.enabled` |
| `run client windows query` | WinRM disk + pending update count; Ollama service/API status when enabled; same PsExec WinRM bootstrap when needed |
| `run client client-ubuntu maintain` | SSH `df`, apt dist-upgrade; reboot only with `--reboot` |
| `run client client-ubuntu query` | SSH disk + upgradable package count |
| `run client raspberrypi maintain` | Same as ubuntu (Debian/apt) |
| `run client raspberrypi query` | Same as ubuntu |

Flags (after `--`): `--host-id`, `--dry-run`, `--skip-updates`, `--reboot`, `--no-wol`, `--no-winrm-bootstrap`, `--skip-ollama`, `--ollama-only`, `--ollama-start`, `--ollama-models-only`, `--no-report`, `--report`.

**WinRM bootstrap:** When port 5986 is not open, `maintain`/`query` can run Sysinternals **PsExec** on the operator Windows host (current logon must be remote admin) to enable WinRM + HTTPS listener. Config: `winrm_bootstrap` in [`clumps/clients/windows/config.json`](clumps/clients/windows/config.json); env `HDC_PSEXEC_PATH`. See [`docs/manually-deployed/client-winrm.md`](docs/manually-deployed/client-winrm.md).

Vault: `HDC_WINRM_USER_PASSWORD` (shared WinRM password); optional per-host `HDC_WINRM_PASSWORD_<SUFFIX>` via `winrm_password_vault_suffix`. Env: `HDC_WINRM_USER` (MSA: `MicrosoftAccount\email@domain.com`; local: `.\user`; Entra: `AzureAD\UPN`). Per-host username override: `auth.winrm_user` or `auth.winrm_user_env`. Env: `HDC_CLIENT_SSH_USER`.

Examples:

```bash
hdc run client windows query --
hdc run client client-ubuntu maintain -- --reboot --host-id ws-example
```

## Proxmox in this repo

- **Config:** [`clumps/infrastructure/proxmox/config.json`](clumps/infrastructure/proxmox/config.json) (copy from [`config.example.json`](clumps/infrastructure/proxmox/config.example.json); keep local config out of git).
- **Inventory:** hypervisors in `operations/inventory/systems/` (tag `proxmox` or `automation_targets: ["proxmox"]`), plus [`operations/inventory/targets/proxmox.json`](operations/inventory/targets/proxmox.json).
- **Schema:** [`apps/hdc-cli/schema/proxmox.config.schema.json`](apps/hdc-cli/schema/proxmox.config.schema.json).

| hdc service id | Verb | Summary |
| --- | --- | --- |
| `lxc-create` | deploy | Create LXC via API (`create-container`) |
| `qemu-clone` | deploy | Clone QEMU VM from template (`create-vm`); enables `agent=1` after clone (in-guest install via service deploy or SSH) |
| `qemu-list-templates` | deploy | List QEMU templates |
| `verify-templates` | maintain | SSH keys, no-subscription APT sources and subscription nag removal, host firewall (SSH/8006 to allowed LANs), API token ACL, templates, NAS storage, scheduled backup jobs, storage replication jobs, HA groups/resources, guest startup order (`provision.startup`; `--skip-startup`), host OS updates, OEM Windows SLIC/MSDM license reporting, configured load report, QEMU guest agent (config + ping), markdown report under `clumps/infrastructure/proxmox/reports/` |
| `cluster-snapshot` | query | Cluster/guest inventory JSON on stdout |

Bootstrap the local `hdc` user on Ubuntu/bootstrap hosts with `run infrastructure ubuntu maintain` or `users bootstrap-hdc` — not from `proxmox maintain`.

**QEMU guest agent:** Deploy scripts enable `agent=1` on new QEMU VMs and install `qemu-guest-agent` in Linux guests when deploy has SSH (e.g. BIND). LXC deploys are unchanged. See [`.cursor/rules/proxmox-qemu-guest-agent.mdc`](.cursor/rules/proxmox-qemu-guest-agent.mdc). Maintain `verify-templates` reports agent config + ping.

**Guest root disk expansion (opt-in):** Pass `--expand-guest-rootfs` on `proxmox maintain` to probe `/` on running Linux LXC/QEMU guests and expand root disks in 8 GiB steps until used space is below 50% (defaults from `provision.guest_rootdisk` in config). Skips Windows/HAOS name patterns and guests without a working probe (LXC `pct exec`, QEMU guest agent, or inventory SSH). Optional `--guest-rootfs-threshold`, `--guest-rootfs-increment-gb`, `--dry-run`. Does not update per-service `rootfs_gb` in clump configs.

```bash
hdc run infrastructure proxmox maintain -- --expand-guest-rootfs --dry-run
hdc run infrastructure proxmox maintain -- --expand-guest-rootfs
```

**QEMU first-boot SSH wait:** Ubuntu cloud templates use `serial0: socket` / `vga: serial0`; clones can hang at the serial console on first boot. Deploy and maintain use [`qemu-guest-ssh-wait.mjs`](clumps/lib/qemu-guest-ssh-wait.mjs): optional settle delay, short SSH probe, then Proxmox API reboot if the probe fails. Tune `provision.qemu.first_boot` in proxmox config; flags: `--skip-first-boot-reboot`, `--first-boot-reboot`.

**Guest CPU/RAM:** QEMU clones and LXC creates apply `proxmox.qemu` / `proxmox.lxc` `memory_mb` and `cores` after the Proxmox task completes (template sizing is not kept when config differs). **Service maintain** syncs the same fields on live guests without destroy (QEMU reboot when running and sizing changed; LXC stop/PUT/start). Shared helpers: [`proxmox-guest-resources.mjs`](clumps/infrastructure/proxmox/lib/proxmox-guest-resources.mjs), [`proxmox-guest-resources-maintain.mjs`](clumps/lib/proxmox-guest-resources-maintain.mjs) (via [`guest-linux-baseline.mjs`](clumps/lib/guest-linux-baseline.mjs) for Proxmox guests). Flags: `--skip-resources`, `--no-reboot` (disable auto-reboot on change); `--reboot` forces reboot. Infrastructure deploy: `create-vm` / `create-container` accept `--memory-mb`, `--cores`, and `--reboot`. Service deploy: optional `--reboot` when resizing a running guest.

**Resource planning** (CPU, RAM, storage, bridges): follow [`.cursor/skills/proxmox-resource-planning/SKILL.md`](.cursor/skills/proxmox-resource-planning/SKILL.md) and [`.cursor/rules/proxmox-resource-planning.mdc`](.cursor/rules/proxmox-resource-planning.mdc).

## Azure (Entra + compute) in this repo

- **Config:** [`clumps/infrastructure/azure/config.json`](clumps/infrastructure/azure/config.json) (copy from [`config.example.json`](clumps/infrastructure/azure/config.example.json); keep local config in hdc-private). Schema v2: `entra` (Graph apps; `entra.automation.app_id` default `hdc`) + `compute` (VM/ACI); optional `$hdc.include` under `entra/applications/` and `compute/deployments/`.
- **Schema:** [`apps/hdc-cli/schema/azure.config.schema.json`](apps/hdc-cli/schema/azure.config.schema.json).
- **Docs:** [`docs/manually-deployed/azure.md`](docs/manually-deployed/azure.md).
- **Routing:** `--section entra|compute|all` (default `entra` for deploy/maintain/query; teardown is compute-only).

| Verb | Summary |
| --- | --- |
| `query` | Entra: discover/diff apps; `--import --yes` merges into `entra.applications` (preserve `id`/`managed`). Compute: config + optional `--live`. `--section all` for both. |
| `deploy` | Entra: create managed apps missing from tenant. Compute: VM/ACI with Retail Prices estimate + cost confirm (`--dry-run`, `--yes`, `--accept-unknown-cost`). |
| `maintain` | Entra: patch redirect URIs / API permissions / audience. Compute: reconcile tags / ACI. |
| `teardown` | Compute only: destroy VM or ACI (`--section compute`, `--dry-run`, `--yes`). |

Env (Entra): `HDC_AZURE_ENTRA_TENANT_ID`, `HDC_AZURE_ENTRA_<APP>_APPLICATION_ID` (Application/client ID — not Secret ID; default app `hdc` → `HDC_AZURE_ENTRA_HDC_APPLICATION_ID`). Optional `HDC_AZURE_ENTRA_<APP>_SECRET_ID` (metadata only). Vault: `HDC_AZURE_ENTRA_<APP>_SECRET_VALUE`. Legacy `HDC_AZURE_ENTRA_CLIENT_ID` / `HDC_AZURE_ENTRA_CLIENT_SECRET` still work. Env (compute): `HDC_AZURE_COMPUTE_SUBSCRIPTION_ID`, `HDC_AZURE_COMPUTE_TENANT_ID`, `HDC_AZURE_COMPUTE_CLIENT_ID`. Vault: `HDC_AZURE_COMPUTE_CLIENT_SECRET`. HostProvisioner: [`azure-compute-host-provisioner.mjs`](clumps/infrastructure/azure/lib/compute/azure-compute-host-provisioner.mjs). Does not create or rotate secrets on managed Entra applications.

Examples:

```bash
hdc run infrastructure azure query -- --section all
hdc run infrastructure azure query -- --section entra --import --yes
hdc run infrastructure azure deploy -- --section entra --dry-run
hdc run infrastructure azure deploy -- --section compute --instance a --dry-run
hdc run infrastructure azure maintain -- --section entra
```

## GCP compute in this repo

- **Config:** [`clumps/infrastructure/gcp-compute/config.json`](clumps/infrastructure/gcp-compute/config.json) (copy from [`config.example.json`](clumps/infrastructure/gcp-compute/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/gcp-compute.config.schema.json`](apps/hdc-cli/schema/gcp-compute.config.schema.json).
- **Docs:** [`docs/manually-deployed/gcp-compute.md`](docs/manually-deployed/gcp-compute.md).

| Verb | Summary |
| --- | --- |
| `deploy` | GCE VM or Cloud Run from `deployments[]`; cost estimate + confirmation before provision |
| `maintain` | Reconcile labels / Cloud Run revision; cost confirm on serverless reconcile |
| `query` | Config summary; `--live` for API state + cost snapshot |
| `teardown` | Destroy VM or Cloud Run service (`--dry-run`, `--yes`) |

Env: `HDC_GCP_COMPUTE_PROJECT_ID`. Vault: `HDC_GCP_COMPUTE_SERVICE_ACCOUNT_JSON`. Modes: `gcp-vm`, `gcp-cloud-run`. HostProvisioner: [`gcp-compute-host-provisioner.mjs`](clumps/infrastructure/gcp-compute/lib/gcp-compute-host-provisioner.mjs).

Example: `hdc run infrastructure gcp-compute deploy -- --instance a --dry-run`

## Oracle Cloud compute in this repo

- **Config:** [`clumps/infrastructure/oci-compute/config.json`](clumps/infrastructure/oci-compute/config.json) (copy from [`config.example.json`](clumps/infrastructure/oci-compute/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/oci-compute.config.schema.json`](apps/hdc-cli/schema/oci-compute.config.schema.json).
- **Docs:** [`docs/manually-deployed/oci-compute.md`](docs/manually-deployed/oci-compute.md).

| Verb | Summary |
| --- | --- |
| `deploy` | VCN + subnet + NSG + Compute VM / Container Instance; cost estimate + confirmation before billable creates (`--dry-run`, `--yes`, `--resource <id>`) |
| `maintain` | Reconcile drift; optional `--prune` removes live HDC-tagged resources not in config |
| `query` | Config summary; `--live` for OCI state + planned actions |
| `teardown` | Destroy by `--resource <id>`, `--instance <id>`, or `--all` (`--dry-run`, `--yes`) |

Env: `HDC_OCI_TENANCY_OCID`, `HDC_OCI_USER_OCID`, `HDC_OCI_FINGERPRINT`, `HDC_OCI_REGION`. Vault: `HDC_OCI_API_PRIVATE_KEY`. HostProvisioner: [`oci-compute-host-provisioner.mjs`](clumps/infrastructure/oci-compute/lib/oci-compute-host-provisioner.mjs) (`oci-vm`, `oci-container` modes).

Example: `hdc run infrastructure oci-compute deploy -- --dry-run`

## AWS infrastructure in this repo

- **Config:** [`clumps/infrastructure/aws/config.json`](clumps/infrastructure/aws/config.json) (copy from [`config.example.json`](clumps/infrastructure/aws/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/aws.config.schema.json`](apps/hdc-cli/schema/aws.config.schema.json).
- **Docs:** [`docs/manually-deployed/aws.md`](docs/manually-deployed/aws.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff VPC, subnets, security groups, IAM, EC2, EBS, S3, ECS vs config; `--import --yes` writes hdc-private snapshot |
| `deploy` | Plan → monthly cost estimate → operator confirm → create managed resources (`--dry-run`, `--yes`, `--skip-cost-confirm`) |
| `maintain` | Reconcile drift; billable creates trigger cost gate; `--prune` removes live resources not in config |
| `teardown` | Destroy by `--resource <id>` or `--all` (`--yes` required non-interactive) |

Env: `HDC_AWS_ACCESS_KEY_ID` in `.env`. Vault: `HDC_AWS_SECRET_ACCESS_KEY` (required); optional `HDC_AWS_SESSION_TOKEN`. Deploy/maintain write **Cost estimate** sections to operation reports via [`clumps/lib/cost-report.mjs`](clumps/lib/cost-report.mjs).

Service packages may use `aws-ec2` / `aws-ecs` deploy modes (pilot: **scanopy**) via [`clumps/infrastructure/aws/lib/aws-host-provisioner.mjs`](clumps/infrastructure/aws/lib/aws-host-provisioner.mjs).

Examples:

```bash
hdc run infrastructure aws query --
hdc run infrastructure aws deploy -- --dry-run
hdc run infrastructure aws deploy -- --yes
hdc run infrastructure aws maintain --
```

## GCP OAuth (Google Auth Platform) in this repo

- **Config:** [`clumps/infrastructure/gcp-oauth/config.json`](clumps/infrastructure/gcp-oauth/config.json) (copy from [`config.example.json`](clumps/infrastructure/gcp-oauth/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/gcp-oauth.config.schema.json`](apps/hdc-cli/schema/gcp-oauth.config.schema.json).
- **Docs:** [`docs/manually-deployed/gcp-oauth.md`](docs/manually-deployed/gcp-oauth.md).

| Verb | Summary |
| --- | --- |
| `query` | Effective redirect URIs per app; diff vs `--import` Console JSON; vault key presence (JSON on stdout) |
| `maintain` | Validate config; `--import` writes vault; print Console checklist (no API create — Console is source of truth) |

Vault: per-app `HDC_GCP_OAUTH_<APP>_CLIENT_ID` and `HDC_GCP_OAUTH_<APP>_CLIENT_SECRET` (see config `vault` block). Optional `derive_from` nginx-waf `site_id` + `callback_path`.

Examples:

```bash
hdc run infrastructure gcp-oauth maintain -- --dry-run
hdc run infrastructure gcp-oauth maintain -- --import ./client_secret.json
hdc run infrastructure gcp-oauth query -- --import ./client_secret.json --require-vault
```

## Cloudflare in this repo

- **Config:** [`clumps/infrastructure/cloudflare/config.json`](clumps/infrastructure/cloudflare/config.json) (copy from [`config.example.json`](clumps/infrastructure/cloudflare/config.example.json); keep local config out of git).
- **Schema:** [`apps/hdc-cli/schema/cloudflare.config.schema.json`](apps/hdc-cli/schema/cloudflare.config.schema.json).
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
hdc run infrastructure cloudflare query --
hdc run infrastructure cloudflare query -- --import-page-rules --yes
hdc run infrastructure cloudflare maintain -- --dry-run
hdc run infrastructure cloudflare maintain -- --zone example.invalid --prune
```

## Cloudflare Workers and Pages in this repo

- **Config:** [`clumps/infrastructure/cloudflare-workers/config.json`](clumps/infrastructure/cloudflare-workers/config.json) (copy from [`config.example.json`](clumps/infrastructure/cloudflare-workers/config.example.json); keep local config and project trees in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/cloudflare-workers.config.schema.json`](apps/hdc-cli/schema/cloudflare-workers.config.schema.json).
- **Docs:** [`docs/manually-deployed/cloudflare-workers.md`](docs/manually-deployed/cloudflare-workers.md).

| Verb | Summary |
| --- | --- |
| `query` | List Workers scripts, routes, Pages projects; diff vs config; `--import --yes` bootstraps `workers[]` / `pages[]` (JSON on stdout) |
| `deploy` | `wrangler deploy` / `wrangler pages deploy` per managed entry; push secrets from vault via API |
| `maintain` | Sync routes + secrets from config; optional `--redeploy` to refresh code |
| `teardown` | `wrangler delete` / `wrangler pages project delete` (`--yes` required) |

Token: `HDC_CLOUDFLARE_API_TOKEN` (shared with DNS package). Account id: `HDC_CLOUDFLARE_ACCOUNT_ID` or `cloudflare_workers.account_id` (required). Install **wrangler** v4+ globally or per project.

Project source lives under hdc-private `clumps/infrastructure/cloudflare-workers/workers/<id>/` and `pages/<id>/`.

Example: `hdc run infrastructure cloudflare-workers deploy -- --worker waitlist-mailer`

## Synology NAS in this repo

- **Config:** [`clumps/infrastructure/synology-nas/config.json`](clumps/infrastructure/synology-nas/config.json) (copy from [`config.example.json`](clumps/infrastructure/synology-nas/config.example.json); keep local config out of git).
- **Inventory:** [`operations/inventory/systems/nas-a.json`](operations/inventory/systems/nas-a.json), [`nas-b.json`](operations/inventory/systems/nas-b.json).
- **Schema:** [`apps/hdc-cli/schema/synology-nas.config.schema.json`](apps/hdc-cli/schema/synology-nas.config.schema.json).

| Verb | Summary |
| --- | --- |
| `query` | DSM version, volume `df`, `/proc/mdstat` RAID, disk enum, Docker/Container Manager status over SSH; JSON on stdout |
| `maintain` | Bootstrap SSH keys, ensure Container Manager/Docker (`synopkg` install/start when missing), `synoupgrade`, `synopkg upgradeall`; one NAS at a time; markdown report |

**Docker library (for other packages):** Import from `clumps/infrastructure/synology-nas/lib/` — `ensureSynologyDocker`, `deployComposeStack`, `createSynologyExecContext`, `createSynologyDockerHostProvisioner` (`backendId: synology-docker`). Default compose root: `/volume1/docker` (`defaults.docker.compose_base_dir` in config). Maintain runs docker ensure when `maintain.docker_ensure` is true (default). `synopkg install` may require Package Center EULA on some DSM builds; install manually if unattended install fails.

**Prerequisite:** Enable SSH in DSM (Control Panel → Terminal & SNMP).

Vault: `HDC_SYNOLOGY_SSH_USER` (optional, default `admin` in config); `HDC_SYNOLOGY_SSH_PASSWORD_NAS_1`, `HDC_SYNOLOGY_SSH_PASSWORD_NAS_2` (required for first bootstrap unless pubkey already works).

Flags: `--instance a|b`, `--system-id nas-a`, `--skip-dsm-upgrade`, `--skip-package-upgrade`, `--skip-ssh-keys`, `--skip-docker-ensure`, `--dry-run`.

Examples:

```bash
hdc run infrastructure synology-nas query --
hdc run infrastructure synology-nas maintain --
```

## SMTP2GO in this repo

- **Config:** [`clumps/infrastructure/smtp2go/config.json`](clumps/infrastructure/smtp2go/config.json) (copy from [`config.example.json`](clumps/infrastructure/smtp2go/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/smtp2go.config.schema.json`](apps/hdc-cli/schema/smtp2go.config.schema.json).
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
hdc run infrastructure smtp2go query --
hdc run infrastructure smtp2go query -- --import --yes
hdc run infrastructure smtp2go maintain --
hdc run infrastructure smtp2go maintain -- --prune
hdc run infrastructure smtp2go maintain -- --skip-ip-allow-list
```

## OpenRouter in this repo

- **Config:** [`clumps/infrastructure/openrouter/config.json`](clumps/infrastructure/openrouter/config.json) (copy from [`config.example.json`](clumps/infrastructure/openrouter/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/openrouter.config.schema.json`](apps/hdc-cli/schema/openrouter.config.schema.json).
- **Docs:** [`docs/manually-deployed/openrouter.md`](docs/manually-deployed/openrouter.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff credits and API keys vs config; per-key inference usage via `GET /key`; `--import --yes` writes live snapshot to hdc-private config |
| `maintain` | Create or update managed inference API keys; optional `--prune` removes live keys not in config |

Vault: `HDC_OPENROUTER_MANAGEMENT_API_KEY` (Management API). Consumers use separate inference keys (e.g. `HDC_HERMES_OPENROUTER_API_KEY` for **hermes**).

**Bootstrap:** `query -- --import --yes` replaces `api_keys[]`; set `managed: true` before `maintain`.

Examples:

```bash
hdc run infrastructure openrouter query --
hdc run infrastructure openrouter query -- --import --yes
hdc run infrastructure openrouter maintain --
hdc run infrastructure openrouter maintain -- --key-id hermes --dry-run
```

## Discord in this repo

- **Config:** [`clumps/infrastructure/discord/config.json`](clumps/infrastructure/discord/config.json) (copy from [`config.example.json`](clumps/infrastructure/discord/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/discord.config.schema.json`](apps/hdc-cli/schema/discord.config.schema.json).
- **Docs:** [`docs/manually-deployed/discord.md`](docs/manually-deployed/discord.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff Developer applications vs config per bot token; `--import --yes` merges live metadata into hdc-private config |
| `maintain` | PATCH managed apps for API-supported fields; prints Developer Portal checklist for privileged intents |

Vault: per-app `bot_token_vault_key` (e.g. `HDC_HERMES_DISCORD_BOT_TOKEN` for Hermes — shared with **hermes** compose). Discord has no API to list or create applications; declare each app in `applications[]` after creating it in the Developer Portal.

**Bootstrap:** `query -- --import --yes` after bot tokens are in vault; set `managed: true` before `maintain`.

Examples:

```bash
hdc run infrastructure discord query --
hdc run infrastructure discord query -- --import --yes --require-vault
hdc run infrastructure discord maintain -- --app hermes --dry-run
```

## Twilio in this repo

- **Config:** [`clumps/infrastructure/twilio/config.json`](clumps/infrastructure/twilio/config.json) (copy from [`config.example.json`](clumps/infrastructure/twilio/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/twilio.config.schema.json`](apps/hdc-cli/schema/twilio.config.schema.json).
- **Docs:** [`docs/manually-deployed/twilio.md`](docs/manually-deployed/twilio.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff Elastic SIP trunks and Incoming Phone Numbers vs config; `--import --yes` writes live snapshot to hdc-private config (JSON on stdout) |

Vault: `HDC_TWILIO_ACCOUNT_SID`, `HDC_TWILIO_AUTH_TOKEN` (API). Asterisk SIP Credential List uses separate `HDC_TWILIO_SIP_USERNAME` / `HDC_TWILIO_SIP_PASSWORD` in the **asterisk** package.

**Bootstrap:** `query -- --import --yes` replaces `sip_trunks[]` and `phone_numbers[]`.

Examples:

```bash
hdc run infrastructure twilio query --
hdc run infrastructure twilio query -- --import --yes
```

## UptimeRobot in this repo

- **Config:** [`clumps/infrastructure/uptimerobot/config.json`](clumps/infrastructure/uptimerobot/config.json) (copy from [`config.example.json`](clumps/infrastructure/uptimerobot/config.example.json); keep local config in hdc-private).
- **Schema:** [`apps/hdc-cli/schema/uptimerobot.config.schema.json`](apps/hdc-cli/schema/uptimerobot.config.schema.json).
- **Docs:** [`docs/manually-deployed/uptimerobot.md`](docs/manually-deployed/uptimerobot.md).

| Verb | Summary |
| --- | --- |
| `query` | Diff monitors, status pages, and alert contacts vs config; `--import --yes` writes live snapshot to hdc-private config (JSON on stdout) |
| `maintain` | Reconcile `managed: true` entries via UptimeRobot API v2; optional `--prune` removes live resources not listed in config |

Vault: `HDC_UPTIMEROBOT_API_KEY` (Main API key from Integrations & API → API).

**Bootstrap:** `query -- --import --yes` replaces `monitors[]`, `status_pages[]`, and `alert_contacts[]`.

Examples:

```bash
hdc run infrastructure uptimerobot query --
hdc run infrastructure uptimerobot query -- --import --yes
hdc run infrastructure uptimerobot maintain --
```

## External reference: Proxmox VE Helper-Scripts

[community-scripts/ProxmoxVE](https://github.com/community-scripts/ProxmoxVE) — community one-command installers for LXC containers and VMs on Proxmox VE ([community-scripts.org](https://community-scripts.org)).

Use this collection as a **reference** when:

- Choosing self-hosted services or comparing default resource allocations.
- Understanding post-install helpers and common CT/VM patterns.
- Drafting new HDC service packages or manual runbooks.

**Do not** treat pasted install curls from that project as hdc automation. Prefer tracked packages under `clumps/`, inventory sidecars, and `hdc run` for operations you want repeatable and documented in-repo.

## Secrets and safety

- Never commit `.env`, vault files, or secret values in chat, sidecars, or markdown.
- Store secrets via `hdc secrets set <ENV_NAME>` (Vaultwarden when configured, else local `~/.hdc/vault.enc`); document only env var **names** in JSON `auth` fields.
- **Backends:** `HDC_SECRET_BACKEND` = `local` | `vaultwarden` | `auto` (default). Vaultwarden mode requires [Bitwarden CLI](docs/manually-deployed/bitwarden-cli.md), `HDC_VAULTWARDEN_URL`, and `HDC_VAULTWARDEN_EMAIL` or API key pair (`HDC_VAULTWARDEN_KEY_CLIENT_ID` + `HDC_VAULTWARDEN_KEY_CLIENT_SECRET`) in `.env`.
- See [`.env.example`](.env.example) for Proxmox, Nagios, Postfix relay, vault, and Vaultwarden backend variables.

## Testing

After changes under `apps/hdc-cli/`:

```bash
npm install   # devDependencies only (Vitest)
npm run test
```

Before merging substantive CLI changes, run `npm run test:coverage` and keep thresholds green ([`vitest.config.mjs`](vitest.config.mjs)).

## Agent team (hdc-agent-server fleet)

Nine role-specific agents under [`apps/hdc-agent-server/agents/`](apps/hdc-agent-server/agents/) coordinate HDC operations with shared state in **hdc-private** `operations/`. Runtime: LiteLLM tool loop + scripted dispatcher (not Cursor). The **hdc** platform is human/operator-owned — fleet agents must not write that repo.

| Agent | Role | Repository |
| --- | --- | --- |
| [`hdc-manager`](apps/hdc-agent-server/agents/hdc-manager.md) | Task triage, A2A assignment, Discord escalation, `hdc_clumps_sync` on fleet host | — |
| [`hdc-monitor`](apps/hdc-agent-server/agents/hdc-monitor.md) | Uptime Kuma, Proxmox health digests | — |
| [`hdc-sre-ops`](apps/hdc-agent-server/agents/hdc-sre-ops.md) | Approved deploy/maintain on live systems | hdc-private |
| [`hdc-sre-engineer`](apps/hdc-agent-server/agents/hdc-sre-engineer.md) | Package scripts, manifests, examples (git commit/push) | hdc-clumps |
| [`hdc-qa`](apps/hdc-agent-server/agents/hdc-qa.md) | Clump validation (`hdc_validate_clump`), quality digests | — |
| [`hdc-security-expert`](apps/hdc-agent-server/agents/hdc-security-expert.md) | Wazuh, CrowdSec, nginx-waf response | — |
| [`hdc-security-architect`](apps/hdc-agent-server/agents/hdc-security-architect.md) | Read-only security proposals | — |
| [`hdc-network-architect`](apps/hdc-agent-server/agents/hdc-network-architect.md) | Read-only network/DNS proposals | — |
| [`hdc-research`](apps/hdc-agent-server/agents/hdc-research.md) | Tool research briefs | — |

Shared skills: [`apps/hdc-agent-server/skills/`](apps/hdc-agent-server/skills/). IDE pointers under `.cursor/` / `.claude/` remain for human local sessions. Architecture: [docs/multi-agent-ops.md](docs/multi-agent-ops.md).

**Clump cache handoff:** sre-engineer pushes hdc-clumps git → manager `hdc_clumps_sync` on the fleet MCP host → sre-ops runs approved live ops.

**Operations state:** `operations/tasks/*.md`, `task-report.md`, `delegation-policy.md`, `ip-allocations.md`, `reports/`, `proposals/`. Approvals via hdc-web-server Tasks UI / A2A on hdc-agents-a `:9120`.

**Scheduled runs:** container dispatcher intervals (manager ~15m, monitor ~60m, …); LLM only when work detected. Deterministic cron schedules live in `hdc_agents.schedules[]` on the hdc-agents guest.

**IP allocations:** Before assigning a static address for a new Proxmox guest, read `hdc-private/operations/ip-allocations.md` — pick the workload's IP group and **Next free** address, then cross-check BIND and inventory. Site IPs live in **hdc-private** only, not in the public hdc repo.

**Discord alerts:** CLI `hdc run … deploy|maintain` summaries use vault `HDC_OPS_DISCORD_WEBHOOK_URL` (disable with `HDC_OPS_DISCORD_NOTIFY=0` or `--no-discord-notify`). The hdc-agents fleet (scheduler, `hdc_notify_discord`, manager escalations) uses `HDC_AGENTS_DISCORD_WEBHOOK_URL` (`notify-discord.mjs --webhook-vault-key HDC_AGENTS_DISCORD_WEBHOOK_URL`). Message headers attribute **system** (`HDC_OPS_SYSTEM_ID`, else legacy `HDC_OPS_DISCORD_HOST`, else OS hostname) and **application** (`HDC_OPS_NOTIFY_APP`, else `HDC_AGENT_ROLE`, else `cli`).

Legacy alias: [`hdc-ops`](apps/hdc-agent-server/agents/hdc-ops.md) → prefer **hdc-sre-ops** / **hdc-manager**. Role id **`hdc-sre`** is deprecated.

## hdc-mcp-server and run-daily in this repo

- **MCP server:** [`apps/hdc-mcp-server/server.mjs`](apps/hdc-mcp-server/server.mjs) — stdio MCP exposing `hdc_list`, `hdc_help`, `hdc_maintain_daily`, `hdc_run`, `hdc_clumps_sync` (manager only), `hdc_notify_discord`. Policy blocks secrets, teardown, and destructive flags.
- **Scheduled daily:** [`apps/hdc-agent-server/bin/run-daily.mjs`](apps/hdc-agent-server/bin/run-daily.mjs) — deterministic `maintain daily` + Discord (no LLM). hdc-agents schedule `hdc-ops-daily` uses `cli: ["run-daily"]`.
- **Docs:** [`docs/manually-deployed/hdc-mcp-server.md`](docs/manually-deployed/hdc-mcp-server.md).

Examples:

```bash
node apps/hdc-mcp-server/server.mjs
node apps/hdc-agent-server/bin/run-daily.mjs --dry-run
hdc run service hdc-agents maintain --
```

## Deeper context (pointers)

| Topic | Location |
| --- | --- |
| Automation conventions | [`.cursor/rules/hdc-automation.mdc`](.cursor/rules/hdc-automation.mdc) |
| Inventory naming | [`.cursor/rules/hdc-inventory-naming.mdc`](.cursor/rules/hdc-inventory-naming.mdc) |
| Nagios + manual docs | [`.cursor/rules/hdc-nagios-monitoring.mdc`](.cursor/rules/hdc-nagios-monitoring.mdc) |
| Agent team | [`apps/hdc-agent-server/skills/hdc-agent-team/`](apps/hdc-agent-server/skills/hdc-agent-team/SKILL.md), [`apps/hdc-agent-server/agents/`](apps/hdc-agent-server/agents/) |
| Multi-agent architecture | [`docs/multi-agent-ops.md`](docs/multi-agent-ops.md) |
| Claude Code entry point | [`CLAUDE.md`](CLAUDE.md); thin pointers under `.claude/skills/` and `.claude/agents/` |
| Operator workflow | [`apps/hdc-agent-server/skills/hdc-ops/SKILL.md`](apps/hdc-agent-server/skills/hdc-ops/SKILL.md), [`apps/hdc-agent-server/agents/hdc-sre-ops.md`](apps/hdc-agent-server/agents/hdc-sre-ops.md) |
| Human README | [README.md](README.md) |
