# hdc-agent-server

A2A Protocol **0.3** HTTP server for a single HDC agent role. Used inside `hdc/agent-runtime` containers on the **hdc-agents** host.

Canonical agent definitions, skills, rules, and automation specs live in this package:

```text
apps/hdc-agent-server/
  agents/          # role prompts
  skills/          # injected into the LiteLLM system prompt
  rules/           # short fleet constraints
  automations/     # when the scripted dispatcher runs vs invokes the model
  lib/dispatcher.mjs
```

## Env

| Variable | Purpose |
| --- | --- |
| `HDC_AGENT_ROLE` | Roster id (`hdc-monitor`, …) — drives mcp policy + prompt |
| `HDC_AGENT_PORT` | Listen port (9200–9207) |
| `HDC_ROOT` | Path to hdc checkout (default: repo root) |
| `HDC_PRIVATE_ROOT` | Path to hdc-private (required for dispatcher) |
| `HDC_LITELLM_BASE_URL` | LiteLLM base (e.g. `http://10.0.0.116:4000`) |
| `HDC_AGENT_LITELLM_KEY` | Virtual key for this agent |
| `HDC_AGENT_MODEL` | Model id on LiteLLM (default `lan-best-available`) |
| `HDC_AGENT_SCHEDULE_MINUTES` | Override schedule (`0` / `off` disables) |

## Run

```bash
HDC_AGENT_ROLE=hdc-monitor HDC_AGENT_PORT=9201 HDC_PRIVATE_ROOT=/opt/hdc-private node apps/hdc-agent-server/server.mjs
```

## Endpoints

- `GET /.well-known/agent.json` — agent card
- `GET /health` — liveness
- `POST /a2a` — JSON-RPC (`message/send`, `tasks/get`, `tasks/list`)

Tools are the hdc-mcp-server allowlisted handlers for the role. Model calls go to LiteLLM `/v1/chat/completions`.

## Daily maintain (no LLM)

```bash
node apps/hdc-agent-server/bin/run-daily.mjs --dry-run
npm run run-daily --prefix apps/hdc-agent-server -- --dry-run
```

Deterministic `maintain daily` + Discord reporting (hdc-agents schedule `hdc-ops-daily` / `cli: ["run-daily"]`).

## Schedules (scripted first)

Defaults: manager 15m, monitor 60m, security-expert 120m, research 7d. Each tick runs `lib/dispatcher.mjs`:

- **Manager:** refresh `task-report.md`, Discord for `needs_decision`, A2A-delegate approved/auto-run tasks; LLM triage only when new digests/failure reports appear.
- **Monitor / security:** run allowlisted `hdc` queries; LLM only when the combined probe stdout hash changes.
- **Research:** LLM only when today's brief file is missing.

Tasks UI and job API are served by hdc-web-server on the hdc-agents guest (`:9120`).
