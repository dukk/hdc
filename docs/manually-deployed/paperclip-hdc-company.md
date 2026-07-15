# Paperclip Home Data Center company

Provision the **Home Data Center** Paperclip company with HDC skills and agents that call **hdc-web-server** (on hdc-agents-a) / the **hdc-agents** fleet for homelab automation. The former Paperclip↔hdc-runner HTTP bridge is removed.

## Prerequisites

- Paperclip deployed (`paperclip-a`, `https://paperclip.home.example.invalid`)
- Instance claimed (CEO / first admin)
- hdc-agents deployed with hdc-web-server (`:9120`) and agent containers (`:9200–9207`)
- Vault keys: `HDC_PAPERCLIP_API_KEY`, `HDC_WEB_API_TOKEN` (legacy `HDC_HDC_RUNNER_API_TOKEN` still accepted by hdc-web-server)
- HDC skills committed to public hdc repo (for GitHub import URL in config)

## 1. Push hdc-agents (web + fleet)

```bash
hdc run service hdc-agents maintain --
```

## 2. Bootstrap company

```bash
hdc run service paperclip query -- --bootstrap-company --yes
```

## 3. Agents (example)

| Agent | Role | Skills |
|-------|------|--------|
| HDC Manager | manager | paperclip, hdc-agent-team |
| HDC Monitor | operator | paperclip, hdc-monitor |
| HDC SRE | engineer | paperclip, hdc-sre, hdc-agent-team |
| HDC Security | operator | paperclip, hdc-security |

## 4. Smoke test

1. Create Paperclip issue: **Run uptime-kuma live query via hdc-web-server**
2. Assign to **HDC Monitor**
3. Agent should POST `/api/jobs` or trigger a monitor schedule
4. Confirm job in hdc-web-server UI or `GET /api/jobs/:id` on hdc-agents-a `:9120`

## References

- hdc-web-server API: [`apps/hdc-web-server/API.md`](../../apps/hdc-web-server/API.md)
- Skills: [`clumps/services/paperclip/skills/`](../../clumps/services/paperclip/skills/)
- Delegation policy: `hdc-private/operations/delegation-policy.md`
