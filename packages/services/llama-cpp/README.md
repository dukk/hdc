# Llama.cpp (`llama-cpp`)

Deploy `llama-server` on Proxmox LXC from GitHub releases (CPU, CUDA, Vulkan, or ROCm backends).

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json`
- **Inventory:** optional [`inventory/manual/systems/llama-cpp-a.json`](../../../inventory/manual/systems/llama-cpp-a.json) per instance
- **Vault:** none required
- Set `server.model` or `server.hf_model` to enable the systemd unit at deploy

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC + `llama-server` (`install.backend`: cpu/cuda/vulkan/rocm) |
| `maintain` | Upgrade binary; restart service |
| `query` | Config summary; `--live` for systemd/health |
| `teardown` | Destroy LXC |

```bash
node tools/hdc/cli.mjs run service llama-cpp deploy -- --instance a
node tools/hdc/cli.mjs run service llama-cpp query -- --live
```

## Common flags

`--instance a|b`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--skip-restart` (maintain), `--dry-run`, `--yes`.

## After deploy

1. **HTTP API:** `http://<guest-ip>:8080` by default (`server.port` / `server.host` in config — default port **8080**, bind `0.0.0.0`).
2. Service stays **disabled** until `server.model` or `server.hf_model` is set in config.
3. Use OpenAI-compatible or llama.cpp client endpoints documented for `llama-server` against that URL.

## Related

- [AGENTS.md — Llama.cpp](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/llama-cpp.config.schema.json`](../../../tools/hdc/schema/llama-cpp.config.schema.json)
