# Paperclip Home Data Center company

Provision the **Home Data Center** Paperclip company with HDC skills and agents that call **hdc-runner** for homelab automation.

## Prerequisites

- Paperclip deployed (`paperclip-a`, `https://paperclip.home.example.invalid`)
- Instance claimed (CEO / first admin)
- hdc-runner deployed with web API and optional HTTP bridge (`192.0.2.125:9120`, bridge `:9121`)
- Vault keys: `HDC_PAPERCLIP_API_KEY`, `HDC_HDC_RUNNER_API_TOKEN`, `HDC_PAPERCLIP_AGENT_BRIDGE_SECRET`
- HDC skills committed to public hdc repo (for GitHub import URL in config)

## 1. Push hdc-runner API + bridge

```bash
node tools/hdc/cli.mjs run service hdc-runner maintain --
```

This auto-generates `HDC_HDC_RUNNER_API_TOKEN` and `HDC_PAPERCLIP_AGENT_BRIDGE_SECRET` when missing.

Verify:

```bash
curl -s http://192.0.2.125:9120/api/health
curl -s -H "Authorization: Bearer <token>" http://192.0.2.125:9120/api/schedules
curl -s http://192.0.2.125:9121/api/health
```

## 2. Create Paperclip board API key

In Paperclip UI: Settings → API keys → create key with agent/company management permissions.

Store in vault:

```bash
node tools/hdc/cli.mjs secrets set HDC_PAPERCLIP_API_KEY
```

## 3. Automated bootstrap

Config block: `packages/services/paperclip/config.json` → `defaults.paperclip.company`

Dry run:

```bash
node tools/hdc/cli.mjs run service paperclip query -- --bootstrap-company --dry-run
```

Apply:

```bash
node tools/hdc/cli.mjs run service paperclip query -- --bootstrap-company --yes
```

Imports skills from GitHub and creates/syncs agents:

| Agent | Role | Skills |
|-------|------|--------|
| HDC Manager | manager | paperclip, hdc-agent-team, hdc-runner |
| HDC Monitor | operator | paperclip, hdc-monitor, hdc-runner |
| HDC SRE | engineer | paperclip, hdc-sre, hdc-agent-team, hdc-runner |
| HDC Security | operator | paperclip, hdc-security, hdc-runner |
| HDC Monitor (HTTP) | operator | hdc-monitor, hdc-runner (HTTP adapter → bridge) |

## 4. Manual alternative (curl)

Set env:

```bash
export PAPERCLIP_API_URL=https://paperclip.home.example.invalid
export PAPERCLIP_API_KEY=<board-token>
export COMPANY_ID=<uuid-after-list>
```

Import a skill:

```bash
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/skills/import" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"https://github.com/dukk/hdc/tree/main/packages/services/paperclip/skills/hdc-runner"}'
```

Create agent:

```bash
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/agents" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "HDC Monitor",
    "role": "operator",
    "adapterType": "cursor",
    "desiredSkills": ["paperclip", "hdc-monitor", "hdc-runner"]
  }'
```

## 5. Company secrets (Paperclip UI)

| Secret | Value |
|--------|-------|
| `HDC_RUNNER_API_URL` | `http://192.0.2.125:9120` |
| `HDC_RUNNER_API_TOKEN` | From vault `HDC_HDC_RUNNER_API_TOKEN` |
| `HDC_PAPERCLIP_BRIDGE_SECRET` | From vault (HTTP adapter agents) |

Optional: `HDC_PAPERCLIP_CURSOR_API_KEY` for Cursor Cloud adapters (also in guest `.env` via hdc maintain). OpenAI and Gemini keys map to guest `OPENAI_API_KEY` and `GOOGLE_API_KEY` when set in package `.env` or vault.

## 6. LLM providers (Ollama, OpenAI, Gemini)

`paperclip maintain` pushes optional provider keys and the primary Ollama URL to guest `/opt/paperclip/.env`:

| Operator vault / `.env` key | Guest compose env |
|-----------------------------|---------------------|
| `HDC_PAPERCLIP_OPENAI_API_KEY` | `OPENAI_API_KEY` |
| `HDC_PAPERCLIP_GOOGLE_GEMINI_API_KEY` | `GOOGLE_API_KEY` |
| `paperclip.ollama_backends[]` (primary) | `OLLAMA_BASE_URL` |

Configure backends in `packages/services/paperclip/config.json`:

```json
"ollama_backends": [
  { "id": "ollama-a", "url": "http://192.0.2.111:11434", "primary": true },
  { "id": "ollama-b", "url": "http://192.0.2.112:11434" }
]
```

Then run `node tools/hdc/cli.mjs run service paperclip maintain --`.

**Paperclip UI (optional local models — HDC agents stay on Cursor):**

1. Open Paperclip → pick any agent (or create a test agent).
2. Adapter → choose **Ollama**, **OpenCode local**, or **OpenAI-compatible**.
3. Primary Ollama (`vm-ollama-a`): leave `baseUrl` empty or set `http://192.0.2.111:11434`.
4. Secondary Ollama (`vm-ollama-b`): set `baseUrl` to `http://192.0.2.112:11434`.
5. Select a model pulled on that host (see `packages/services/ollama/config.json`).
6. Run **Test environment** so Paperclip discovers models from `GET /api/tags`.

For OpenAI/Codex or Gemini local adapters, server-side keys from guest `.env` are used automatically; you may also bind the same values as company secrets under **Company Settings → Secrets** in authenticated mode.

## 7. Smoke test

1. Create Paperclip issue: **Run uptime-kuma live query via hdc-runner**
2. Assign to **HDC Monitor**
3. Agent should POST `/api/jobs` or trigger `monitor-uptime-kuma` schedule
4. Confirm job in hdc-runner UI or `GET /api/jobs/:id`

## References

- hdc-runner API: [`packages/services/hdc-runner/API.md`](../../packages/services/hdc-runner/API.md)
- Skills: [`packages/services/paperclip/skills/`](../../packages/services/paperclip/skills/)
- Delegation policy: `hdc-private/operations/delegation-policy.md`
