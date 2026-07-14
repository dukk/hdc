# hdc-mcp-server

Expose hdc CLI operations to MCP clients (Cursor, agent containers) over **stdio**, with per-role policy and optional **scoped API keys**.

## Install

```bash
cd apps/hdc-mcp-server
npm install --omit=dev
```

Requires Node.js 18+ and the hdc repo root `.env` (vault, `HDC_PRIVATE_ROOT`, …).

## Run

```bash
node apps/hdc-mcp-server/server.mjs
```

The server communicates over stdin/stdout (JSON-RPC). Do not log to stdout except MCP protocol messages.

## Tools (v1)

| Tool | Purpose |
| --- | --- |
| `hdc_list` | List clumps and verbs |
| `hdc_help` | CLI help topics |
| `hdc_maintain_daily` | Non-destructive daily maintain recipe |
| `hdc_run` | Single clump verb (role-dependent; see below) |
| `hdc_notify_discord` | Post to agents Discord (`HDC_AGENTS_DISCORD_WEBHOOK_URL`, fallback `HDC_OPS_DISCORD_WEBHOOK_URL`) |

**Blocked globally:** `secrets`, `teardown`, `users`, and destructive flags (`--prune`, `--reboot`, `--destroy-existing`, `--rolling-restart`).

## Per-role policy (`HDC_AGENT_ROLE`)

When unset, the **default** profile matches the historical safe set (`query`/`maintain`, daily maintain, Discord). Container agents set `HDC_AGENT_ROLE` to a roster id:

| Role | Tools | `hdc_run` verbs |
| --- | --- | --- |
| *(default)* | all five | `query`, `health`, `maintain` |
| `hdc-manager` | all five | `query`, `health`, `maintain`, `deploy` (needs `task_id` **approved**) |
| `hdc-sre` | list, help, run, Discord | `query`, `health`, `maintain`, `deploy` (needs `task_id` **approved**) |
| `hdc-monitor` | list, help, run, Discord | `query`, `health` |
| `hdc-security-expert` | list, help, run, Discord | `query`, `health`, `maintain` |
| `hdc-scheduler` | list, help, daily, run, Discord | `query`, `health`, `maintain` |
| `hdc-security-architect` / `hdc-network-architect` / `hdc-research` / `hdc-engineer` | list, help, run | `query`, `health` |

Deploy checks `hdc-private/operations/tasks/<task_id>.md` frontmatter `status: approved`. Policy lives in [`apps/hdc-mcp-server/lib/policy.mjs`](../../apps/hdc-mcp-server/lib/policy.mjs).

## Scoped API keys

Fleet containers present `HDC_MCP_API_KEY` (minted on `hdc-agents` deploy into vault as `HDC_MCP_API_KEY_<ROLE>`). Hashes are recorded in `hdc-private/operations/mcp-api-keys.json`. When `HDC_MCP_REQUIRE_API_KEY=1`, a valid key is required and its bound role’s scopes apply (preferred over rewriting `HDC_AGENT_ROLE` alone).

Local Cursor stdio may omit the key when `HDC_MCP_REQUIRE_API_KEY` is unset.

## Cursor configuration

```json
{
  "mcpServers": {
    "hdc": {
      "command": "node",
      "args": ["C:/dev/dukk/hdc/apps/hdc-mcp-server/server.mjs"],
      "env": {
        "HDC_PRIVATE_ROOT": "C:/dev/dukk/hdc-private"
      }
    }
  }
}
```

## Security

The MCP server inherits the operator vault and hdc-private access of the host process. Run only on trusted workstations or the hdc-agents guest.

## Related

- [`../multi-agent-ops.md`](../multi-agent-ops.md) — fleet architecture
- Agent daily maintain: `node apps/hdc-agent-server/bin/run-daily.mjs`
