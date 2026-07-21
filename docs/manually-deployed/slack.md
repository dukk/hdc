# Slack applications (infrastructure package)

Manage the **HDC Slack app** via Slack’s App Manifest API (`apps.manifest.*`), similar to Azure Entra app registration. Runtime uses the bot token + hdc-web for Approve/Deny buttons **and** manager chat (Events API + `/hdc` slash) — see [manager-notifications.md](manager-notifications.md).

## Prerequisites

1. Create **App Configuration Tokens** at [api.slack.com/apps](https://api.slack.com/apps) (Your App Configuration Tokens).
2. Store them in the vault:

```bash
hdc secrets set HDC_SLACK_CONFIG_TOKEN
hdc secrets set HDC_SLACK_CONFIG_REFRESH_TOKEN
```

3. Copy hdc-clumps `infrastructure/slack/config.example.json` to hdc-private `clumps/infrastructure/slack/config.json` (or bootstrap via query `--import`).

## Verbs

```bash
hdc run infrastructure slack query --
hdc run infrastructure slack deploy -- --dry-run
hdc run infrastructure slack deploy --
hdc run infrastructure slack maintain --
hdc run infrastructure slack health --
```

| Verb | Summary |
| --- | --- |
| `query` | Export live manifests for apps with `match.app_id`; report manifest and icon drift. `--import --yes` merges display name / scopes / request URL into config. |
| `deploy` | Create managed apps missing from Slack; write signing secret / client id / secret to vault; persist `match.app_id`; upload icon when `icon.repo_path` is set. |
| `maintain` | Patch manifest drift (scopes, interactivity / Events / slash URLs, background color). Upload icon when local file hash differs from `icon.applied_sha256`. Rotates config tokens. Prints portal checklist. |
| `health` | Config present (`infra-api`). |

Config tokens are rotated via `tooling.tokens.rotate` on deploy/maintain/query (skip with `--no-rotate`). Skip icon upload with `--skip-icon`.

## App icon

Set per-app `icon.repo_path` (relative to the **hdc** repo root, e.g. `assets/beetle-agent-no-bg.png`) and optional `icon.background_color` for manifest hovercards. Deploy/maintain upload the image via Slack `apps.icon.set` — the same icon appears for the app and its bot user. After a successful upload, `icon.applied_sha256` is written to hdc-private config; maintain re-uploads only when the local file changes.

## After deploy / chat enablement

1. Install the app to the workspace in the Slack UI (reinstall / reauthorize when scopes change).
2. `hdc secrets set HDC_SLACK_BOT_TOKEN` (Bot User OAuth Token).
3. Set `HDC_SLACK_DECISION_CHANNEL` to the ops channel id (`C…`), or set `notifications.channels.slack-hdc-app.channel_id` in hdc-agents config.
4. Ensure hdc-web URLs (derived from `hdc_agents.public_url` when `derive_from.hdc_agents_public_url` is true):
   - Interactivity: `…/api/slack/interactions`
   - Events: `…/api/slack/events` (`app_mention`, `message.im`)
   - Slash: `…/api/slack/commands` (`/hdc`)
5. Enable `notifications.channels.slack-hdc-app`, set `decision_authorized_users` (e.g. `["dukk"]`), and add `slack-hdc-app` to `routes.needs_decision`. The same allowlist gates manager chat prompts.
6. `hdc run service hdc-agents maintain --` so the fleet guest receives signing secret, bot token, channel, and authorized users.
7. Invite the bot to channels where you `@mention` it.
8. For DMs: the managed manifest enables App Home **Messages Tab** (writable). If Slack still shows “Sending messages to this app has been turned off,” run `slack maintain` (or flip **App Home → Messages Tab** in the portal), then reopen the DM with the bot.

### Manager chat

| Ingress | How |
| --- | --- |
| DM | Message the bot privately (requires Messages Tab enabled / not read-only) |
| Channel | `@HDC <prompt>` (or your bot display name) |
| Slash | `/hdc <prompt>` |

hdc-web creates an audit task (`slack-…`), enqueues hdc-manager `/internal/operator-prompt`, and the manager posts the reply in-thread (or in-channel for slash).

**Scope note:** After adding Events / slash / `users:read`, run `slack maintain` then **reinstall or reauthorize** the app in Slack so the bot token picks up new scopes.

## Vault keys

| Key | Purpose |
| --- | --- |
| `HDC_SLACK_CONFIG_TOKEN` | App Manifest API access token |
| `HDC_SLACK_CONFIG_REFRESH_TOKEN` | Config token refresh |
| `HDC_SLACK_HDC_APP_SIGNING_SECRET` | Written by deploy; hdc-web signature verify |
| `HDC_SLACK_HDC_APP_CLIENT_ID` / `_CLIENT_SECRET` | Written by deploy |
| `HDC_SLACK_BOT_TOKEN` | Bot token after workspace install |
| `HDC_SLACK_DECISION_CHANNEL` | Channel for decision `chat.postMessage` |
| `HDC_SLACK_DECISION_AUTHORIZED_USERS` | Optional comma-separated usernames / `U…` ids for Approve/Deny **and** chat prompts (overrides config when set in vault) |

## Related

- Incoming webhook (plain text only): channel `slack-incoming-webhook` / `HDC_AGENTS_SLACK_WEBHOOK_URL`
- Interactive decisions: `POST /api/slack/interactions` on hdc-web-server
- Manager chat: `POST /api/slack/events`, `POST /api/slack/commands`
