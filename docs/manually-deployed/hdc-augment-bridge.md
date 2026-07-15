# HDC augmentor bridge

External IDE and cloud agents augment fleet roles (**hdc-engineer**, **hdc-sre-engineer**,
**hdc-qa**, **hdc-research**, **hdc-security-expert**, **hdc-security-architect**,
**hdc-network-architect**) by accepting A2A `message/send` tasks and running Cursor Cloud,
Cursor CLI, or Claude Code.

Fleet agents discover augmentors via LiteLLM `a2a_agents[]` and delegate with MCP tools
`hdc_list_augmentors` and `hdc_delegate_augment`.

## Architecture

| Runtime | Host | LiteLLM name (example) |
| --- | --- | --- |
| `cursor-cloud` | hdc-agents-a sidecar (`cursor-cloud-bridge`, port 9210) | `cursor-cloud-bridge` |
| `cursor-cli` | Operator workstation (Tailscale/LAN) | `cursor-cli-hdc`, `cursor-cli-clumps` |
| `claude-code` | Operator workstation | `claude-code-hdc`, `claude-code-clumps` |

Register every bridge in hdc-private `clumps/services/litellm/config.json` → `a2a_agents[]`
with `kind: augmentor`, `runtime`, `repos`, and `delegatable_by`. Run
`hdc run service litellm maintain --` after edits.

Fleet deploy/maintain can auto-merge fleet + sidecar entries when augmentation is enabled
(`hdc run service hdc-agents maintain --`; skip with `--skip-litellm-register`).

## Fleet sidecar (Cursor Cloud)

Enabled in `clumps/services/hdc-agents/config.json`:

```jsonc
"hdc_agents": {
  "augmentation": {
    "enabled": true,
    "sidecars": ["cursor-cloud-bridge"],
    "cursor_cloud": {
      "repos": ["hdc", "hdc-clumps"],
      "delegatable_by": [
        "hdc-engineer",
        "hdc-sre-engineer",
        "hdc-qa",
        "hdc-research",
        "hdc-security-expert",
        "hdc-security-architect",
        "hdc-network-architect"
      ],
      "repository_url": "https://github.com/YOUR_ORG/hdc"
    }
  }
}
```

Vault / clump `.env`:

- `HDC_CURSOR_CLOUD_API_KEY` — Cursor Cloud Agents API key
- `HDC_AUGMENT_BRIDGE_TOKEN` — optional bearer token for direct bridge access
- `HDC_AUGMENT_REPOSITORY_URL` — default git URL for cloud agents

## Workstation bridge (Cursor CLI / Claude Code)

On the operator machine with local hdc / hdc-clumps checkouts:

```bash
# Cursor CLI example (repo: hdc)
export HDC_AUGMENT_RUNTIME=cursor-cli
export HDC_AUGMENT_BRIDGE_NAME=cursor-cli-hdc
export HDC_AUGMENT_BRIDGE_PORT=9211
export HDC_AUGMENT_REPOS=hdc
export HDC_AUGMENT_DELEGATABLE_BY=hdc-engineer
export HDC_AUGMENT_WORKSPACE=/path/to/hdc
export HDC_AUGMENT_CLI_COMMAND="cursor agent"
export HDC_AUGMENT_BRIDGE_TOKEN=your-bridge-secret
node apps/hdc-augment-bridge/server.mjs
```

Register in litellm config (use your Tailscale or LAN URL):

```json
{
  "name": "cursor-cli-hdc",
  "url": "http://workstation.tailnet:9211",
  "kind": "augmentor",
  "runtime": "cursor-cli",
  "repos": ["hdc"],
  "delegatable_by": ["hdc-engineer"]
}
```

Claude Code: set `HDC_AUGMENT_RUNTIME=claude-code` and
`HDC_AUGMENT_CLI_COMMAND="claude -p"` (or your installed CLI).

## Delegation flow

1. Parent task exists for a delegating role (`hdc-engineer`, `hdc-sre-engineer`, `hdc-qa`, `hdc-research`, security/network architects, …).
2. Agent calls `hdc_list_augmentors` for an allowed target repo (`hdc` or `hdc-clumps`).
3. Agent calls `hdc_delegate_augment` with `parent_task_id` and a bounded `prompt`.
4. A subtask file is created (`<parent>--aug-<slug>-<hash>.md`) and A2A is sent via LiteLLM.
5. Parent agent reviews augmentor output, runs tests as needed, sets subtask `delegation_status: completed`, continues handoff.

## Security

- Bridges accept optional `Authorization: Bearer <HDC_AUGMENT_BRIDGE_TOKEN>`.
- LiteLLM virtual keys gate fleet → augmentor A2A calls.
- LAN/VPN only — do not expose bridges on the public internet.
- Augmentors do not receive hdc deploy/maintain MCP tools.

## Related

- [multi-agent-ops.md](../../docs/multi-agent-ops.md) — fleet architecture
- [hdc-mcp-server.md](./hdc-mcp-server.md) — MCP tools for IDE sessions
- `apps/hdc-augment-bridge/` — bridge server source
