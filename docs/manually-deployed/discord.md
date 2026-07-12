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

## Limitations

| Capability | hdc v1 |
| --- | --- |
| Create application | Developer Portal only |
| List all developer apps | Declare each app in config |
| Privileged Gateway Intents | Portal checklist only |
| Bot token rotation | Manual vault update |
| Global slash commands | Not in scope |

## Related

- [Hermes service](../../clumps/services/hermes/README.md)
- [AGENTS.md](../../AGENTS.md)
