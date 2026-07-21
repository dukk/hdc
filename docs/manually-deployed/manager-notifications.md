# Manager multi-channel notifications

The hdc-manager scripted dispatcher and manager mailbox can deliver alerts on **email**, **Discord**, **Slack** (incoming webhook and/or HDC Slack app), **Microsoft Teams**, or **Telegram**. Channels are selected **per event** in `clumps/services/hdc-agents/config.json` under `defaults.hdc_agents.notifications`.

CLI deploy/maintain summaries, Proxmox maintain, scheduler job Discord posts, `run-daily`, and MCP `hdc_notify_discord` also **mirror to Slack** when `HDC_AGENTS_SLACK_WEBHOOK_URL` (or CLI `HDC_OPS_SLACK_WEBHOOK_URL`) is set — no per-schedule Slack block required. Prefer the **`slack-hdc-app`** channel for interactive Approve/Deny buttons (see below).

Legacy channel id `slack` is accepted and normalized to `slack-incoming-webhook`.

## Configuration

Guest runtime reads `/opt/hdc-agents-meta/notifications.json` (written on `hdc run service hdc-agents maintain`).

```jsonc
"notifications": {
  "channels": {
    "email": {
      "enabled": true,
      "to": "ops@example.invalid",
      "from": "manager@hdc.example.invalid",
      "subject_prefix": "[HDC]"
    },
    "discord": {
      "enabled": true,
      "webhook_vault_key": "HDC_AGENTS_DISCORD_WEBHOOK_URL",
      "fallback_webhook_vault_key": "HDC_OPS_DISCORD_WEBHOOK_URL"
    },
    "slack-incoming-webhook": {
      "enabled": true,
      "webhook_vault_key": "HDC_AGENTS_SLACK_WEBHOOK_URL"
    },
    "slack-hdc-app": {
      "enabled": true,
      "bot_token_vault_key": "HDC_SLACK_BOT_TOKEN",
      "channel_env": "HDC_SLACK_DECISION_CHANNEL",
      "decision_authorized_users": ["dukk"]
    },
    "teams": {
      "enabled": true,
      "webhook_vault_key": "HDC_AGENTS_TEAMS_WEBHOOK_URL"
    },
    "telegram": {
      "enabled": true,
      "bot_token_vault_key": "HDC_AGENTS_TELEGRAM_BOT_TOKEN",
      "chat_id": "123456789"
    }
  },
  "routes": {
    "needs_decision": ["discord", "slack-hdc-app"],
    "mailbox_received": ["discord", "slack-incoming-webhook"],
    "mailbox_spoof": ["discord", "slack-incoming-webhook"],
    "mailbox_task_update": ["discord", "slack-incoming-webhook"]
  }
}
```

### Route keys

| Route | When |
| --- | --- |
| `needs_decision` | Dispatcher finds a task with `needs_decision: true` |
| `mailbox_received` | New message on the manager IMAP inbox |
| `mailbox_spoof` | Trusted sender claimed without SPF/DKIM/DMARC pass |
| `mailbox_task_update` | Task created/updated from mailbox processing |

When `notifications` is omitted, all manager routes default to **Discord** (legacy behavior).

## Vault keys

| Key | Channel |
| --- | --- |
| `HDC_AGENTS_DISCORD_WEBHOOK_URL` | Discord (fallback: `HDC_OPS_DISCORD_WEBHOOK_URL`) |
| `HDC_AGENTS_SLACK_WEBHOOK_URL` | Slack incoming webhook (fleet + manager; CLI falls back here) |
| `HDC_OPS_SLACK_WEBHOOK_URL` | Optional CLI-only Slack webhook (preferred over agents when set) |
| `HDC_SLACK_BOT_TOKEN` | Slack HDC app bot token (`xoxb-…`) |
| `HDC_SLACK_DECISION_CHANNEL` | Slack channel id for bot posts (`C…` / `#name`) |
| `HDC_SLACK_DECISION_AUTHORIZED_USERS` | Comma-separated Slack usernames and/or user ids allowed to Approve/Deny **and** chat prompts (optional env override) |
| `HDC_SLACK_HDC_APP_SIGNING_SECRET` | Slack app signing secret (hdc-web interactions) |
| `HDC_AGENTS_TEAMS_WEBHOOK_URL` | Teams / Power Automate workflow webhook |
| `HDC_AGENTS_TELEGRAM_BOT_TOKEN` | Telegram Bot API token |

Email uses postfix satellite on the hdc-agents guest (no extra vault key); `to` / `from` come from `notifications.channels.email` or `hdc_agents.mail`.

## Channel setup

### Email

Requires postfix satellite on `hdc-agents-a` (guest baseline). Decision emails include:

- Task id and title
- Reply subjects `APPROVE <task-id>` / `REJECT <task-id>` to the manager mailbox
- Tasks UI link when `hdc_agents.public_url` is set

### Discord

Same as before for manager routes. When `needs_decision` includes Discord and the hdc-ops bot is configured (`application_id`, `public_key`, `bot_token`, `channel_id`), messages include Approve/Deny buttons. See [discord.md](discord.md).

### Slack incoming webhook (`slack-incoming-webhook`)

Plain-text outbound only (no buttons).

1. Create a Slack app → **Incoming Webhooks** → add webhook to a channel (e.g. `#hdc`).
2. `hdc secrets set HDC_AGENTS_SLACK_WEBHOOK_URL`
3. Set `notifications.channels.slack-incoming-webhook.enabled: true` and add `slack-incoming-webhook` to desired `routes`.
4. CLI / scheduler / MCP automatically mirror Discord posts when the webhook resolves (same disable flags as Discord for CLI: `HDC_OPS_DISCORD_NOTIFY=0`, `--no-discord-notify`).

### Slack HDC app (`slack-hdc-app`)

Interactive Approve/Deny buttons via Bot API + hdc-web interactions endpoint (mirrors Discord), plus **manager chat** (DM / `@mention` / `/hdc`).

1. Register/maintain the app with the **slack** infrastructure package: `hdc run infrastructure slack deploy --` (App Manifest API; see [slack.md](slack.md)).
2. Install the app to the workspace; `hdc secrets set HDC_SLACK_BOT_TOKEN` with the bot token. Reauthorize when scopes change (Events + slash + `users:read`).
3. Set `HDC_SLACK_DECISION_CHANNEL` (channel id) or `notifications.channels.slack-hdc-app.channel_id`, and enable `notifications.channels.slack-hdc-app`.
4. Add `slack-hdc-app` to `routes.needs_decision`.
5. Restrict Approve/Deny **and chat prompts** to specific operators with `decision_authorized_users` (prefer Slack `U…` user ids; usernames also work when `users:read` resolves). Example: `"decision_authorized_users": ["dukk"]` or `["U0123ABCD"]`. Override via vault/env `HDC_SLACK_DECISION_AUTHORIZED_USERS=dukk,other`. When the list is empty/unset, any workspace member who can click the button (or message the bot) is allowed (legacy behavior).
6. Ensure hdc-web is reachable at:
   - Interactivity: `…/api/slack/interactions`
   - Events: `…/api/slack/events`
   - Slash: `…/api/slack/commands`  
   with `HDC_SLACK_HDC_APP_SIGNING_SECRET` on the fleet guest. Button clicks are acknowledged synchronously with a `replace_original` JSON response (no `response_url` round-trip). Chat acks within 3s, then the manager replies via `chat.postMessage`.
7. Invite the bot to the decision channel and any channel where you `@mention` it (`/invite @HDC`). Without an invite, Slack does not deliver `app_mention` events.
#### Manager chat usage

- DM the bot, or `@mention` it in a channel, or run `/hdc <prompt>`.
- Examples: `/hdc what's down?`, `@HDC create a task to check mailcow`.
- hdc-web writes `operations/tasks/slack-*.md` and calls manager `/internal/operator-prompt`; the reply lands in the Slack thread (or channel for slash).

### Slack HDC app troubleshooting

If Discord (or incoming webhook) works but bot messages do not:

1. Confirm `HDC_SLACK_BOT_TOKEN` and `HDC_SLACK_DECISION_CHANNEL` are in vault (`hdc secrets set …`).
2. Run `hdc run service hdc-agents maintain --` so `/opt/hdc-agents-meta/.env` on the fleet guest receives both keys.
3. Use a channel **id** (`C…`), not a display name; invite the bot to that channel.
4. Run `node apps/hdc-cli/lib/notify-slack-app.mjs --message "test"` — stderr shows `not_in_channel` or other Slack API errors.
5. Run `node apps/hdc-cli/lib/notify.mjs --route needs_decision --decision --task-id test --message "Approve?"` — stderr logs per-channel results even when Discord succeeds.
6. Decision alerts only fire for tasks with `needs_decision: true` that are not already in dispatcher `notified_task_ids`.

### Microsoft Teams

Prefer a **Power Automate** workflow: trigger **When a Teams webhook request is received** → post to channel. Copy the workflow URL into vault as `HDC_AGENTS_TEAMS_WEBHOOK_URL`.

Classic Office 365 Connector webhooks still work for MessageCard payloads but are deprecated by Microsoft.

### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather); store token in `HDC_AGENTS_TELEGRAM_BOT_TOKEN`.
2. Send the bot a message, then resolve `chat_id` (e.g. `https://api.telegram.org/bot<token>/getUpdates`).
3. Set `notifications.channels.telegram.chat_id` and enable the channel in routes.

v1 sends plain text plus Tasks UI link for decisions (no inline keyboard handlers).

## CLI (debug)

```bash
node apps/hdc-cli/lib/notify.mjs --route needs_decision --title "Test" --message "Hello" --dry-run
node apps/hdc-cli/lib/notify.mjs --route needs_decision --decision --task-id my-task --message "Approve?"
node apps/hdc-cli/lib/notify-slack-incoming-webhook.mjs --title "Slack webhook test" --message "Hello" --dry-run
node apps/hdc-cli/lib/notify-slack-app.mjs --title "Slack app test" --message "Hello" --decision --task-id my-task --dry-run
```

## Apply

After editing hdc-private `clumps/services/hdc-agents/config.json`:

```bash
hdc run service hdc-agents maintain --
```
