# hdc-agent-server

A2A Protocol **0.3** HTTP server for a single HDC agent role. Used inside `hdc/agent-runtime` containers on the **hdc-agents** host.

## Env

| Variable | Purpose |
| --- | --- |
| `HDC_AGENT_ROLE` | Roster id (`hdc-monitor`, …) — drives mcp policy + prompt |
| `HDC_AGENT_PORT` | Listen port (9200–9207) |
| `HDC_ROOT` | Path to hdc checkout (default: repo root) |
| `HDC_PRIVATE_ROOT` | Path to hdc-private |
| `HDC_LITELLM_BASE_URL` | LiteLLM base (e.g. `http://10.0.0.116:4000`) |
| `HDC_AGENT_LITELLM_KEY` | Virtual key for this agent |
| `HDC_AGENT_MODEL` | Model id on LiteLLM (default `lan-best-available`) |

## Run

```bash
HDC_AGENT_ROLE=hdc-monitor HDC_AGENT_PORT=9201 node apps/hdc-agent-server/server.mjs
```

## Endpoints

- `GET /.well-known/agent.json` — agent card
- `GET /health` — liveness
- `POST /a2a` — JSON-RPC (`message/send`, `tasks/get`, `tasks/list`)

Tools are the hdc-mcp allowlisted handlers for the role (same policy as stdio MCP). Model calls go to LiteLLM `/v1/chat/completions` with optional `X-LiteLLM-*` header forwarding.

## Schedules

Set `HDC_AGENT_SCHEDULE_MINUTES` (or rely on defaults: monitor 240, security-expert 360, research 10080). `0` / `off` disables. hdc-runner Cursor automations remain the fallback plane.
