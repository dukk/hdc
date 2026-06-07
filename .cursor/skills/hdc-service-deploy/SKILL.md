---
name: hdc-service-deploy
description: >-
  Configures and deploys HDC service packages via the hdc CLI: interactive
  discovery (IP, Proxmox node, VM vs LXC vs Synology), writes plan.md for
  approval, runs deploy with script fixes on failure, and optional dependency
  packages (bind, nginx-waf, cloudflare, synology-nas). Use when deploying a
  service, scaffolding a new package, fixing a deploy script, or wiring reverse
  proxy and DNS for an app.
disable-model-invocation: true
---

# HDC service deploy

End-to-end workflow for **configure → plan → approve → deploy → validate**, with optional infrastructure dependencies. Pair with [hdc-ops](../hdc-ops/SKILL.md) (CLI) and [proxmox-resource-planning](../proxmox-resource-planning/SKILL.md) (sizing).

## Hard rules

1. **Never invent** hostnames, IPs, bridges, VLANs, vmids, or credentials — use inventory, hdc-private config, BIND zones, or ask the user.
2. **Write `plan.md` and wait for explicit approval** before any `deploy` / `maintain` that changes infrastructure or live DNS/proxy config.
3. **Dependencies are opt-in** — list them in the plan; run only what the user approved ([dependencies.md](dependencies.md)).
4. **Secrets:** vault key **names** only in plans and chat; use `readLineQuestion(..., { mask: true })` when prompting; never log values.
5. **Logging:** package progress on **stderr**; keep **stdout** clean for JSON ([hdc-automation-logging](../../../.cursor/rules/hdc-automation-logging.mdc)).

## Entry points

```bash
node tools/hdc/cli.mjs list
node tools/hdc/cli.mjs run service <id> query --
node tools/hdc/cli.mjs run service <id> deploy -- [--instance a] [flags]
```

Windows: `hdc.cmd` from repo root. Config and inventory live in **hdc-private** when present (`HDC_PRIVATE_ROOT` or `../hdc-private`).

---

## Phase 0 — Classify work

| Situation | Action |
|-----------|--------|
| Package exists under `packages/services/<id>/` | Deploy or re-deploy existing service |
| No package yet | New package — plan must include scaffolding (see [New package](#new-package-scaffolding)) |
| `configure-only` in config | Guest already exists; plan SSH/configure steps only (nginx, nginx-waf) |

Identify: `manifest.json`, `AGENTS.md` section, `config.example.json`, `tools/hdc/schema/<id>.config.schema.json`.

---

## Phase 1 — Discovery questions

Use **AskQuestion** when available; otherwise ask in chat. Batch into **1–2 rounds**. Skip questions already answered in inventory or hdc-private config.

### Required (if missing)

| Topic | Guidance |
|-------|----------|
| **Service id** | Manifest id (e.g. `searxng`, `vaultwarden`) or new slug |
| **Deploy backend** | `proxmox-lxc`, `proxmox-qemu`, `proxmox-qemu-haos`, `proxmox-qemu-iso`, `synology-docker`, `configure-only` |
| **Proxmox node** | `proxmox.host_id` / inventory `hosted_on_system_id` (e.g. `hypervisor-a`) |
| **Static IP** | CIDR + gateway; check BIND forward zones in hdc-private `packages/services/bind/config.json` for a free name/IP |
| **Instance letter** | `-a`, `-b` — [hdc-inventory-naming](../../../.cursor/rules/hdc-inventory-naming.mdc) |
| **Public HTTPS?** | LAN-only vs `https://` hostname — drives dependency section |

### Conditional

- **VM vs LXC** — if unsure on Proxmox: LXC = less overhead; VM = isolation, Windows, GPU/USB, QEMU guest agent. Read **proxmox-resource-planning** for CPU/RAM/disk.
- **GPU / USB / privileged Docker** — flag early (ollama, homeassistant, Docker-in-LXC).
- **Secrets** — from `manifest.json` `env_required`; confirm `secrets set` before deploy.
- **Dependencies** — present checklist from [dependencies.md](dependencies.md); **default off**.

---

## Phase 2 — Read-only research

Before writing the plan:

1. Read public `packages/services/<id>/` (manifest, example config, README).
2. Read hdc-private overrides: `packages/services/<id>/config.json`, `inventory/manual/systems/<system-id>.json`, `inventory/manual/services/<id>.json`.
3. `node tools/hdc/cli.mjs run service <id> query --` (add `--live` if safe and useful).
4. Proxmox capacity unknown → **proxmox-resource-planning** or `run infrastructure proxmox query --`.

Do **not** run `deploy` in this phase.

---

## Phase 3 — Write `plan.md` (approval gate)

**Default path:** `hdc-private/packages/services/<service-id>/plan.md`  
**Fallback:** `packages/services/<id>/plan.md` in public hdc — warn that operator-specific data may be committed.

1. Copy structure from [plan-template.md](plan-template.md); replace `{{placeholders}}`.
2. Include copy-paste **CLI sequence**, file paths, vault key names, rollback/teardown commands.
3. Section **7 (Dependencies)** — unchecked boxes until user confirms.
4. Section **10 (Approval)** — must be satisfied before Phase 4.

**Present the plan** to the user (summary + path). **Stop.** Cursor Plan tool approval counts as explicit approval; still write `plan.md` as the durable record.

---

## Phase 4 — Prepare (after approval only)

1. Ensure hdc-private `config.json` exists (`config.example.json` → copy, or `node tools/hdc/scripts/bootstrap-hdc-private-configs.mjs`).
2. Create/update inventory sidecars (`kind: system`, `kind: services`) — id matches filename; naming rules enforced.
3. `node tools/hdc/cli.mjs secrets set <KEY>` for each required secret (masked).
4. Validate JSON against `tools/hdc/schema/*.schema.json` (use `docs lint` if implemented in CLI).

---

## Phase 5 — Deploy and fix loop

```bash
node tools/hdc/cli.mjs run service <id> deploy -- [--instance a] [package flags]
```

**On success:** note IP, ports, and report path on stderr (`packages/services/<id>/reports/deploy-*.md` in hdc-private).

**On failure:**

1. Read stderr + latest deploy report.
2. Classify: config / inventory typo | Proxmox conflict (vmid, IP) | missing vault | script bug.
3. Fix with **minimal scope** — prefer hdc-private config and inventory; edit `packages/**/*.mjs` only when the script is wrong.
4. Retry with same flags; use package flags (`--skip-existing`, `--redeploy-existing`, `--skip-install`) per README.
5. If `tools/hdc/` changed: `npm run test`.

**QEMU:** `agent=1` + in-guest `qemu-guest-agent` per [proxmox-qemu-guest-agent](../../../.cursor/rules/proxmox-qemu-guest-agent.mdc).

---

## Phase 6 — Dependencies (approved items only)

Follow order in [dependencies.md](dependencies.md). Example after guest is up:

```bash
node tools/hdc/cli.mjs run service bind maintain --
node tools/hdc/cli.mjs run service nginx-waf maintain -- --site <site-id>
node tools/hdc/cli.mjs run infrastructure cloudflare maintain -- --zone <zone>
node tools/hdc/cli.mjs run service nagios maintain --
```

Use upstream from deploy output (e.g. `http://10.0.0.x:5678`). For nginx-waf behind Cloudflare, set `client_ip: cloudflare` on the site when appropriate.

If the user approved only deploy in section 10, **skip this phase** and remind them what remains.

---

## Phase 7 — Validate and close

```bash
node tools/hdc/cli.mjs run service <id> query -- --live
```

- Update `inventory/manual/systems/<system-id>.json` — `access.nodes[].ip`, `web_ui`.
- Summarize: IP, URL, report path, `manifest.json` `operation_report.next_steps`.
- Do not commit unless the user asks.

---

## New package scaffolding

When no `packages/services/<id>/` exists, the plan must include:

| Artifact | Notes |
|----------|--------|
| `manifest.json` | `id`, `verbs`, `env_required`, `inventory_docs`, `operation_report.next_steps` |
| `config.example.json` + schema | `tools/hdc/schema/<id>.config.schema.json` |
| `deploy/maintain/query/run.mjs` (+ `teardown` if destructive) | Match logging rules |
| `lib/` | deployments resolver, install helpers |
| README | Prerequisites, flags, after-deploy |

**Reference clones:**

| Pattern | Clone from |
|---------|------------|
| Docker on Proxmox LXC | `searxng`, `yacy`, `scanopy` |
| QEMU + SSH install | `postgresql`, `step-ca`, `splunk` |
| Synology Docker | `immich` (`synology-docker` deployment) |
| Multi-mode | `immich`, `ollama` |

AGENTS.md registration can be a separate user request to keep deploy PRs focused.

---

## Quick examples

### searxng (LAN, minimal deps)

- Backend: `proxmox-lxc`, hypervisor from config, static IP from BIND-free range.
- Plan: deploy only; optional BIND/nginx unchecked.
- Deploy: `run service searxng deploy -- --instance a`
- Validate: `query --live` → `http://<ip>:8080`

### vaultwarden (HTTPS + nginx-waf)

- Set `vaultwarden.domain` in config; vault `HDC_VAULTWARDEN_ADMIN_TOKEN`.
- Plan: deploy + checked deps (bind → nginx-waf → optional cloudflare → nagios).
- Upstream after deploy: `http://<ct-ip>:80` (from output, not guessed).

---

## Related

- [plan-template.md](plan-template.md) — plan skeleton
- [dependencies.md](dependencies.md) — dependency matrix and order
- [hdc-ops](../hdc-ops/SKILL.md) — CLI reference
- [proxmox-resource-planning](../proxmox-resource-planning/SKILL.md) — sizing
- [.cursor/rules/hdc-automation.mdc](../../../.cursor/rules/hdc-automation.mdc) — inventory and private repo
