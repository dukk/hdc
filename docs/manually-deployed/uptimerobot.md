# UptimeRobot (hdc)

Monitors, public status pages, and alert contacts for your UptimeRobot account are managed with the **uptimerobot** infrastructure package (`clumps/infrastructure/uptimerobot/`). Self-hosted LAN monitoring remains in the **uptime-kuma** service package.

## API key

1. Log in to [UptimeRobot](https://uptimerobot.com/).
2. Open **Integrations & API** → **API** in the sidebar.
3. Create or copy your **Main API Key** (not a monitor-specific key unless you only need read-only monitor status).
4. Store it in the hdc vault (never commit):

```bash
node apps/hdc-cli/cli.mjs secrets set HDC_UPTIMEROBOT_API_KEY
```

You may also set `HDC_UPTIMEROBOT_API_KEY` in repo `.env` (env takes precedence over vault).

## Config

Copy `clumps/infrastructure/uptimerobot/config.example.json` to **hdc-private** as `clumps/infrastructure/uptimerobot/config.json`, or bootstrap from the live account:

```bash
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot query -- --import --yes
```

Optional `uptimerobot.primary_status_page_url` (for example `https://stats.uptimerobot.com/RepjIrpxEZ`) is hdc metadata used to highlight your status page in query output — it is not sent to the API.

Set `managed: true` on entries you want `maintain` to create or update.

## Query and import

```bash
# Diff live account vs config (JSON on stdout; exit 1 on drift)
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot query --

# Refresh hdc-private config from live API
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot query -- --import --yes

# Filter diff report
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot query -- --monitor my-monitor-id
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot query -- --status-page my-status-id
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot query -- --contact my-contact-id
```

Import replaces `monitors[]`, `status_pages[]`, and `alert_contacts[]` and updates `uptimerobot.account` from `getAccountDetails`. Existing entries are matched by `uptimerobot_id` to preserve stable `id`, `managed`, and `notes`.

HTTP passwords and other secrets are not persisted when the API returns them empty or masked.

## Maintain

```bash
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot maintain --
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot maintain -- --dry-run
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot maintain -- --monitor my-monitor-id
```

`maintain` applies only entries with **`managed: true`**. Monitor **type** cannot be changed via the API — a type mismatch is reported as an error (delete and recreate in the UptimeRobot UI or adjust config).

### Prune

```bash
node apps/hdc-cli/cli.mjs run infrastructure uptimerobot maintain -- --prune
```

Run `query --import --yes` first so config lists the full inventory. With `--prune`, live monitors/status pages/alert contacts whose `uptimerobot_id` is **not** in config are deleted when at least one entry of that resource type has `managed: true`.

## Rate limits

UptimeRobot enforces per-plan API rate limits (for example 10 requests/minute on Free). The hdc client spaces requests and retries briefly on HTTP 429.

## API reference

- [UptimeRobot API v2 (legacy)](https://uptimerobot.com/api/legacy/) — form POST endpoints used by this package
- [UptimeRobot API overview](https://uptimerobot.com/api/) — v3 docs for future migration
