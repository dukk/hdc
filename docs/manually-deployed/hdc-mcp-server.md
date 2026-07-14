# hdc MCP server

Expose hdc CLI operations to MCP clients (Cursor, Google ADK agents) over **stdio**.

## Install

```bash
cd apps/hdc-mcp
npm install --omit=dev
```

Requires Node.js 18+ and the hdc repo root `.env` (vault, `HDC_PRIVATE_ROOT`, …).

## Run

```bash
node apps/hdc-mcp/server.mjs
```

The server communicates over stdin/stdout (JSON-RPC). Do not log to stdout except MCP protocol messages.

## Tools (v1)

| Tool | Purpose |
| --- | --- |
| `hdc_list` | List clumps and verbs |
| `hdc_help` | CLI help topics |
| `hdc_maintain_daily` | Non-destructive daily maintain recipe |
| `hdc_run` | Single clump verb (role-dependent; see below) |
| `hdc_notify_discord` | Post to ops Discord (`HDC_OPS_DISCORD_WEBHOOK_URL`) |

**Blocked globally:** `secrets`, `teardown`, `users`, and destructive flags (`--prune`, `--reboot`, `--destroy-existing`, `--rolling-restart`).

## Per-role policy (`HDC_AGENT_ROLE`)

When unset, the **default** profile matches the historical safe set (`query`/`maintain`, daily maintain, Discord). Container agents set `HDC_AGENT_ROLE` to a roster id:

| Role | Tools | `hdc_run` verbs |
| --- | --- | --- |
| *(default)* | all five | `query`, `maintain` |
| `hdc-manager` | all five | `query`, `maintain`, `deploy` (needs `task_id` **approved**) |
| `hdc-sre` | list, help, run, Discord | `query`, `maintain`, `deploy` (needs `task_id` **approved**) |
| `hdc-monitor` | list, help, run, Discord | `query` |
| `hdc-security-expert` | list, help, run, Discord | `query`, `maintain` |
| `hdc-security-architect` / `hdc-network-architect` / `hdc-research` / `hdc-engineer` | list, help, run | `query` |

Deploy checks `hdc-private/operations/tasks/<task_id>.md` frontmatter `status: approved`. Policy lives in [`apps/hdc-mcp/lib/policy.mjs`](../../apps/hdc-mcp/lib/policy.mjs).

## Cursor configuration

Add to your MCP config (paths adjusted for your checkout):

```json
{
  "mcpServers": {
    "hdc": {
      "command": "node",
      "args": ["C:/dev/dukk/hdc/apps/hdc-mcp/server.mjs"],
      "env": {
        "HDC_PRIVATE_ROOT": "C:/dev/dukk/hdc-private"
      }
    }
  }
}
```

## Security

The MCP server inherits the operator vault and hdc-private access of the host process. Run only on trusted workstations or the hdc-runner guest.

## Related

- [`hdc-ops-agent.md`](hdc-ops-agent.md) — ADK agent and scheduled `run-daily` workflow
- [`../services/hdc-runner/README.md`](../../clumps/services/hdc-runner/README.md) — cron schedules including `hdc-ops-daily`
