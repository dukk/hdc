# Ollama LLM runtime (`ollama`)

Deploy Ollama on Proxmox LXC or QEMU (optional GPU passthrough on `vm-ollama-*`), or Docker on an Ubuntu SSH host.

## Prerequisites

- **Config:** [`config.example.json`](config.example.json) → `config.json` (`deployments[]`; `vm-ollama-*` uses `proxmox.qemu.hostpci[]` for GPU)
- **Inventory:** [`inventory/manual/systems/vm-ollama-a.json`](../../../inventory/manual/systems/vm-ollama-a.json); optional `ollama-b/c`
- **Vault:** none required for default install
- **GPU (QEMU):** complete VFIO/IOMMU on the Proxmox host before deploy; PCI BDF from `lspci` on the hypervisor

## Commands

| Verb | Purpose |
|------|---------|
| `deploy` | LXC or QEMU provision + Ollama install (`install.gpu_backend`: `nvidia` or `intel`) |
| `maintain` | Stub (no remote changes yet) |
| `query` | Config and deployment summaries |
| `teardown` | Destroy LXC or QEMU guest |

```bash
node tools/hdc/cli.mjs run service ollama deploy -- --instance a --destroy-existing
node tools/hdc/cli.mjs run service ollama query --
node tools/hdc/cli.mjs run service ollama teardown -- --instance a --yes
```

## Common flags

`--instance a|b|c`, `--system-id vm-ollama-a`, `--skip-install`, `--skip-existing`, `--redeploy-existing`, `--destroy-existing`, LXC `--password` (or vault/env), `--dry-run`, `--yes` (teardown).

## After deploy

1. **Guest IP:** `node tools/hdc/cli.mjs run service ollama query --` or `inventory/manual/systems/vm-ollama-a.json` → `access.nodes[].ip`. Example static IP in `config.example.json`: `192.0.2.25/24` for `vm-ollama-a`.
2. **API (default):** `http://<guest-ip>:11434` (`OLLAMA_HOST=0.0.0.0` in systemd; Docker mode uses `ubuntu.docker.host_port` from config, default **11434**).
   - List models: `curl http://<guest-ip>:11434/api/tags`
   - Run a model from another host: `ollama run <model>` with `OLLAMA_HOST=http://<guest-ip>:11434`
3. **Chat UI:** deploy [open-webui](../open-webui/README.md) and set `ollama_backends[].url` to this API URL.
4. **GPU node:** migrating from LXC — run `teardown --instance a --yes` before QEMU redeploy.

## Related

- [AGENTS.md — Ollama](../../../AGENTS.md)
- Schema: [`tools/hdc/schema/ollama.config.schema.json`](../../../tools/hdc/schema/ollama.config.schema.json)
- [open-webui README](../open-webui/README.md)
