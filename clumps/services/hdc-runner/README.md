# HDC Runner

Scheduled automation host: runs the full **hdc** CLI on cron, synced from your operator workstation via `maintain`, with secrets from **Vaultwarden** (`bw`) and operation reports emailed as HTML through the internal postfix-relay.

## Config

Copy [`config.example.json`](config.example.json) to **hdc-private** at `clumps/services/hdc-runner/config.json`.

Key blocks:

| Block | Purpose |
| --- | --- |
| `hdc_runner.install_root` | Public hdc tree on guest (default `/opt/hdc`) |
| `hdc_runner.private_root` | hdc-private mirror (default `/opt/hdc-private`) |
| `hdc_runner.cron_tz` | Timezone for `/etc/cron.d/hdc-runner-*` (`CRON_TZ`; default `UTC`) |
| `hdc_runner.env` | Non-secret env vars (`HDC_SECRET_BACKEND`, `HDC_VAULTWARDEN_*`, org/collection IDs) |
| `hdc_runner.schedules[]` | Cron + hdc CLI argv + optional mail/discord overrides |
| `hdc_runner.mail` | Default email recipient and subject prefix |
| `hdc_runner.discord` | Discord #hdc-ops notifications (webhook from vault `HDC_OPS_DISCORD_WEBHOOK_URL`) |
| `hdc_runner.web` | LAN web UI (default port **9120**; vault `HDC_HDC_RUNNER_UI_PASSWORD`, `HDC_HDC_RUNNER_API_TOKEN`) |
| `hdc_runner.paperclip_bridge` | Paperclip HTTP adapter bridge (default port **9121**; vault `HDC_PAPERCLIP_AGENT_BRIDGE_SECRET`) |
| `configure.ssh.host` | Guest IP for operator rsync (set after first deploy) |

## Deploy

```bash
node apps/hdc-cli/cli.mjs run service hdc-runner deploy -- --instance a
```

Supports `proxmox-lxc` (default) and `proxmox-qemu`. Installs Node.js, Bitwarden CLI, **cron**, syncs repos from the operator, pushes cron + `.env`, applies guest baseline (mail relay; skips ClamAV).

## Maintain

Primary workflow after changing hdc code, hdc-private config, or schedules:

```bash
node apps/hdc-cli/cli.mjs run service hdc-runner maintain --
```

- Rsync `--delete` from operator `hdc` + `hdc-private` to the guest (requires `rsync` on the operator and SSH to the guest as `hdc`)
- Ensures **cron** is installed and active
- Refreshes `/opt/hdc-runner/.env` including `HDC_VAULTWARDEN_MASTER_PASSWORD` from the operator vault; when API key login is configured, also pushes `HDC_VAULTWARDEN_KEY_CLIENT_ID` and `HDC_VAULTWARDEN_KEY_CLIENT_SECRET` (from repo root `.env`, clump `.env`, or local hdc vault); org/collection IDs from `hdc_runner.env`
- Regenerates `/etc/cron.d/hdc-runner-*` (use `--prune` to remove stale schedules)

Flags: `--dry-run`, `--skip-sync`, `--skip-clamav`, `--prune`, `--test-discord`, `--test-schedule <id>`, `--skip-ui`, `--skip-bridge`

## Web UI

When `hdc_runner.web.enabled` is true (default), maintain deploys a **systemd** service `hdc-runner-ui` on the guest.

1. Set vault password (auto-generated on first maintain if missing):

```bash
node apps/hdc-cli/cli.mjs secrets set HDC_HDC_RUNNER_UI_PASSWORD
```

2. After maintain, browse **`http://<guest-ip>:9120`** from the LAN (default username `hdc`).

Features: schedule history and manual runs, ad-hoc **query** / **maintain** for any hdc package, read-only inventory browser. Session auth via httpOnly cookie (`HDC_HDC_RUNNER_UI_SESSION_SECRET` auto-generated). **Bearer token** auth for Paperclip agents (`HDC_HDC_RUNNER_API_TOKEN` auto-generated). See [`API.md`](API.md). Skip UI deploy with `--skip-ui` or `"web": { "enabled": false }`.

## Paperclip bridge

When `hdc_runner.paperclip_bridge.enabled` is true, maintain installs `hdc-paperclip-bridge.service` on port **9121**. Paperclip HTTP adapter agents POST to `/paperclip/heartbeat` with header `X-HDC-Bridge-Secret`. Skip with `--skip-bridge`.

`query --live` reports `ui_service`, `ui_health`, and `ui_port`.

Smoke-test Discord or a single schedule after maintain:

```bash
node apps/hdc-cli/cli.mjs run service hdc-runner maintain -- --test-discord
node apps/hdc-cli/cli.mjs run service hdc-runner maintain -- --test-schedule monitor-uptime-kuma
```

## Schedules

Each schedule runs:

```bash
node /opt/hdc/apps/hdc-cli/cli.mjs <cli...> <cli_args...>
```

Example: `maintain daily` with `--skip-clients` at 03:00 daily.

**hdc-ops-daily** (`cli: ["run-daily"]`) runs [`apps/hdc-ops-agent/bin/run-daily.mjs`](../../apps/hdc-ops-agent/bin/run-daily.mjs) — same maintain recipe with richer Discord summaries via hdc-mcp. Disable the legacy `daily-maintain` schedule after validation to avoid duplicate runs.

Test manually on the guest:

```bash
sudo -u hdc node /opt/hdc-runner/bin/run-scheduled-job.mjs daily-digest
```

Logs: `/var/log/hdc-runner/<schedule-id>.log`

## Email

When mail is enabled, the job wrapper sends the operation report markdown as **multipart HTML** via local `sendmail` → postfix-relay. Requires guest baseline mail relay (applied automatically).

## Discord

When `discord.enabled` is true, the job wrapper posts **started** and **finished** messages to the ops Discord channel. The webhook URL is read from Vaultwarden (`HDC_OPS_DISCORD_WEBHOOK_URL` in the HDC org collection — never put the URL in config). Per-schedule `discord` overrides mirror `mail` (`on_failure_only`, `title_prefix`) but can differ — for example Discord on every completion while email stays failure-only.

Every ops Discord message includes the host label from `HDC_OPS_DISCORD_HOST` (set automatically to the deployment `system_id`, e.g. `hdc-runner-a`). During **maintain**, the webhook URL is read from the operator vault/Vaultwarden and pushed to `/opt/hdc-runner/.env` on the guest (same delivery path as `HDC_VAULTWARDEN_MASTER_PASSWORD` — never stored in `config.json`). Successful scheduled jobs post **silently** (Discord `SUPPRESS_NOTIFICATIONS` — visible in channel, no ping); failures ping normally. Each run posts a **started** and **finished** message so activity is visible in #hdc-ops.

### Troubleshooting Discord

1. Run `maintain -- --test-discord` — posts a smoke-test message to #hdc-ops.
2. Run `query -- --live` — check `cron_service`, `schedules[].last_run_iso`, and `discord_probe`.
3. If logs show `bw login failed`, re-run `maintain` to refresh `HDC_VAULTWARDEN_MASTER_PASSWORD` (and API key vars when used) on the guest.
4. Confirm `HDC_OPS_DISCORD_WEBHOOK_URL` exists in the Vaultwarden HDC collection.

## Query

```bash
node apps/hdc-cli/cli.mjs run service hdc-runner query --
node apps/hdc-cli/cli.mjs run service hdc-runner query -- --live
```

`--live` reports cron service status, per-schedule log metadata (`last_run_iso`, `last_exit_code`), and a Discord dry-run probe.

## Teardown

```bash
node apps/hdc-cli/cli.mjs run service hdc-runner teardown -- --instance a --yes
```

## Inventory

Add `inventory/manual/systems/hdc-runner-a.json` and `inventory/manual/services/hdc-runner.json` in hdc-private.
