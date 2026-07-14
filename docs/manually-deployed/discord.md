# Discord applications (hdc)

Discord Developer applications (bots and OAuth2 clients) are declared in the **discord** infrastructure package (`clumps/infrastructure/discord/`). Consumer services such as **hermes** use the same bot token vault keys in their own compose config.

Discord does **not** provide a public API to list or create applications. hdc automates **declaration**, **live drift detection** via `GET /applications/@me`, **PATCH sync** for API-supported fields, and **Developer Portal checklists** for privileged Gateway Intents.

## Config (hdc-private)

Copy `clumps/infrastructure/discord/config.example.json` to **hdc-private** as `config.json` (same path).

Each `applications[]` entry needs a `bot_token_vault_key` pointing at the app's bot token in vault or `.env`.

## Vault keys

Per application, store the bot token from the Developer Portal:

```bash
node apps/hdc-cli/cli.mjs secrets set HDC_HERMES_DISCORD_BOT_TOKEN
```

You may also set the same env var name in repo `.env` (env takes precedence over vault).

## Workflow

1. Create the application in the [Discord Developer Portal](https://discord.com/developers/applications) and copy the bot token.
2. Add the app to `applications[]` in config (or start from the Hermes example entry).
3. Store the bot token: `node apps/hdc-cli/cli.mjs secrets set HDC_HERMES_DISCORD_BOT_TOKEN`
4. **Import live metadata:** `node apps/hdc-cli/cli.mjs run infrastructure discord query -- --import --yes`
5. **Verify drift:** `node apps/hdc-cli/cli.mjs run infrastructure discord query -- --require-vault`
6. Set `managed: true` on entries hdc should PATCH automatically.
7. **Sync:** `node apps/hdc-cli/cli.mjs run infrastructure discord maintain --`

Enable **Message Content Intent** (and other privileged intents) manually under **Bot → Privileged Gateway Intents** when `portal_checklist.privileged_intents` lists them.

## OAuth redirect URIs

Optional `derive_from` merges redirect URIs from nginx-waf site hostnames (same pattern as **gcp-oauth**):

```json
"derive_from": {
  "nginx_waf_config_path": "clumps/services/nginx-waf/config.json",
  "site_id": "example-app",
  "callback_path": "/oauth/callback"
}
```

Maintain adds missing redirect URIs from config but does **not** remove extra live URIs in v1 (reported as drift only).

## Commands

```bash
node apps/hdc-cli/cli.mjs run infrastructure discord query --
node apps/hdc-cli/cli.mjs run infrastructure discord query -- --app hermes --require-vault
node apps/hdc-cli/cli.mjs run infrastructure discord query -- --import --yes
node apps/hdc-cli/cli.mjs run infrastructure discord maintain --
node apps/hdc-cli/cli.mjs run infrastructure discord maintain -- --app hermes --dry-run
```

Flags: `--app <id>`, `--import`, `--yes`, `--require-vault`, `--no-derive`, `--dry-run`, `--no-report`.

## HDC Ops decision buttons

The **hdc-ops** application (see `config.example.json`) drives Approve/Deny
buttons on Manager `needs_decision` Discord messages.

1. Create a Discord application + bot in the Developer Portal (separate from Hermes).
2. Invite the bot to the ops guild with **Send Messages** (no privileged intents required).
3. Copy **Application ID**, **Public Key**, bot token, and the target **channel ID**.
4. Vault: `node apps/hdc-cli/cli.mjs secrets set HDC_OPS_DISCORD_BOT_TOKEN`
5. In **discord** config (`hdc-ops` entry): set `match.application_id`, `public_key`,
   `ops_decisions.channel_id`, and `interactions_endpoint_url` to the public HTTPS
   URL for hdc-web, e.g. `https://hdc-web.example/api/discord/interactions`
   (nginx-waf → `hdc-agents-a:9120`).
6. Mirror the same non-secret fields under
   `hdc-agents.defaults.hdc_agents.discord` (`application_id`, `public_key`,
   `channel_id`, `bot_token_vault_key`).
7. `discord maintain` (when `managed: true`) PATCHes `interactions_endpoint_url`.
8. `hdc-agents maintain` writes the keys into guest meta `.env` for notify + web verify.

When any of those four values is missing, decision notifies fall back to the plain
`HDC_AGENTS_DISCORD_WEBHOOK_URL` text path when set on the hdc-agents guest (falls back to `HDC_OPS_DISCORD_WEBHOOK_URL`; no buttons).

## Limitations

| Capability | hdc v1 |
| --- | --- |
| Create application | Developer Portal only |
| List all developer apps | Declare each app in config |
| Privileged Gateway Intents | Portal checklist only |
| Bot token rotation | Manual vault update |
| Global slash commands | Not in scope |
| Ops decision buttons | hdc-ops app + hdc-web interactions endpoint |

## Related

- [Hermes service](../../clumps/services/hermes/README.md)
- [Multi-agent ops](../multi-agent-ops.md)
- [AGENTS.md](../../AGENTS.md)
