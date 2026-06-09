# UptimeRobot (HDC infrastructure)

Manage UptimeRobot monitors, public status pages, and alert contacts via [API v2](https://uptimerobot.com/api/legacy/).

## Secrets

Store the Main API key in the hdc vault (never commit):

```bash
node tools/hdc/cli.mjs secrets set HDC_UPTIMEROBOT_API_KEY
```

Create the key in UptimeRobot → **Integrations & API** → **API**.

## Config

Copy `config.example.json` to **hdc-private** as `packages/infrastructure/uptimerobot/config.json`, or bootstrap from the live account:

```bash
node tools/hdc/cli.mjs run infrastructure uptimerobot query -- --import --yes
```

## Query

```bash
node tools/hdc/cli.mjs run infrastructure uptimerobot query --
node tools/hdc/cli.mjs run infrastructure uptimerobot query -- --import --yes
node tools/hdc/cli.mjs run infrastructure uptimerobot query -- --monitor my-monitor-id
```

## Maintain

Set `managed: true` on entries hdc should create or update. Run a full import before using `--prune` so config lists the complete inventory.

```bash
node tools/hdc/cli.mjs run infrastructure uptimerobot maintain --
node tools/hdc/cli.mjs run infrastructure uptimerobot maintain -- --dry-run
node tools/hdc/cli.mjs run infrastructure uptimerobot maintain -- --prune
```

See [`docs/manually-deployed/uptimerobot.md`](../../../docs/manually-deployed/uptimerobot.md).

Self-hosted LAN monitoring remains in the **uptime-kuma** service package.
