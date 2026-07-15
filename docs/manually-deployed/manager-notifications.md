# Manager multi-channel notifications

The hdc-manager scripted dispatcher and manager mailbox can deliver alerts on **email**, **Discord**, **Slack**, **Microsoft Teams**, or **Telegram**. Channels are selected **per event** in `clumps/services/hdc-agents/config.json` under `defaults.hdc_agents.notifications`.

Scheduler job notifications (`schedules[].mail` / `schedules[].discord`) and the MCP `hdc_notify_discord` tool are unchanged.

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
    "slack": {
      "enabled": true,
      "webhook_vault_key": "HDC_AGENTS_SLACK_WEBHOOK_URL"
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
    "needs_decision": ["email"],
    "mailbox_received": ["discord"],
    "mailbox_spoof": ["email", "slack"],
    "mailbox_task_update": ["discord"]
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
| `HDC_AGENTS_SLACK_WEBHOOK_URL` | Slack incoming webhook |
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

### Slack

1. Create a Slack app → **Incoming Webhooks** → add webhook to a channel.
2. `hdc secrets set HDC_AGENTS_SLACK_WEBHOOK_URL`
3. Set `notifications.channels.slack.enabled: true` and add `slack` to desired `routes`.

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
```

## Apply

After editing hdc-private `clumps/services/hdc-agents/config.json`:

```bash
hdc run service hdc-agents maintain --
```
