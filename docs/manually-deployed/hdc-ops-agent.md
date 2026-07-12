# hdc ops agent

Google **ADK** (TypeScript) agent that drives hdc automation through the **hdc-mcp** server, plus a deterministic **run-daily** script for cron.

## Packages

| Path | Role |
| --- | --- |
| [`apps/hdc-mcp`](../../apps/hdc-mcp/) | MCP stdio server (tool layer) |
| [`apps/hdc-ops-agent`](../../apps/hdc-ops-agent/) | ADK `rootAgent` + `bin/run-daily.mjs` |

## Install

```bash
cd apps/hdc-mcp && npm install --omit=dev
cd ../hdc-ops-agent && npm install --omit=dev
```

On **hdc-runner**, `hdc-runner maintain` runs `npm install` in both app directories after rsync.

## Environment

Copy [`apps/hdc-ops-agent/.env.example`](../../apps/hdc-ops-agent/.env.example). For interactive ADK:

- `GOOGLE_API_KEY` — Gemini API key (required for `npx adk run`)
- `HDC_OPS_AGENT_MODEL` — optional (default `gemini-2.5-flash`)
- `HDC_PRIVATE_ROOT` — same as hdc CLI

Discord uses vault `HDC_OPS_DISCORD_WEBHOOK_URL` via hdc-mcp (no URL in config).

## Interactive ADK agent

```bash
cd apps/hdc-ops-agent
npx adk run agent.ts
```

The agent connects to hdc-mcp over stdio and can run `hdc_maintain_daily`, post Discord summaries, and query/maintain single clumps.

## Deterministic daily job (cron)

No LLM — suitable for hdc-runner cron:

```bash
node apps/hdc-ops-agent/bin/run-daily.mjs
node apps/hdc-ops-agent/bin/run-daily.mjs --dry-run
node apps/hdc-ops-agent/bin/run-daily.mjs --skip-discord
```

Workflow:

1. Discord started (silent)
2. `hdc_maintain_daily` with `--skip-clients`
3. Discord finished summary (silent on success)

## hdc-runner schedule

Example in [`clumps/services/hdc-runner/config.example.json`](../../clumps/services/hdc-runner/config.example.json):

```json
{
  "id": "hdc-ops-daily",
  "cron": "15 3 * * *",
  "cli": ["run-daily"],
  "cli_args": []
}
```

The job runner invokes `apps/hdc-ops-agent/bin/run-daily.mjs` when `cli` is `["run-daily"]`. Discord notifications are handled inside run-daily (not duplicated by the hdc-runner wrapper).

**Coexistence:** disable the legacy `daily-maintain` schedule in hdc-private after validating `hdc-ops-daily` to avoid running maintain twice.

## Test on guest

```bash
node apps/hdc-cli/cli.mjs run service hdc-runner maintain -- --test-schedule hdc-ops-daily
```
