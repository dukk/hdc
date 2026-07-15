# Getting Started — Build Your Own HDC

This guide walks you from **nothing** to a working home data center with an AI agent
fleet you can hand work to. It stays high-level on purpose; each step links to the
detailed doc when you need it.

**What you'll end up with:** a deployment platform (Proxmox or a cloud), the `hdc` CLI
driving everything, and a fleet of agents that deploy, monitor, secure, and maintain your
services — asking you to approve anything risky.

> New to the moving parts? Skim [ARCHITECTURE.md](../ARCHITECTURE.md) first (10 minutes) —
> it explains clumps, the three repos, the agents, and the topology with diagrams.

> ### 💡 Recommended: let a coding agent drive the whole thing
>
> **Until your agent fleet is up, use a coding agent — [Claude Code](https://claude.com/claude-code)
> or [Cursor](https://cursor.com) — to do the deployment for you.** Open the `hdc` repo in
> it and it already understands the project: the repo ships `CLAUDE.md`, `.cursor/rules/`,
> and skills (`hdc-ops`, `hdc-service-deploy`, `proxmox-resource-planning`) that teach the
> agent the CLI, the clump layout, and the safety rules.
>
> So instead of running every command by hand, you can just say things like *"register my
> Proxmox cluster and deploy LiteLLM with Ollama"* — the coding agent runs the `hdc`
> commands, reads the errors, and **tweaks the clump `config.json` for your environment**
> as it goes. This is the fastest way through Steps 3–4, where most of the environment-
> specific fiddling lives. Once the fleet (`hdc-agents`) is running, the fleet's own agents
> take over ongoing deploys and maintenance; the coding agent is your bootstrap crew.
>
> The manual commands below are still the source of truth — read them so you know what the
> agent is doing, and reach for them whenever you want to drive it yourself.

---

## Before you start — what you need

| Thing | Why | Notes |
| --- | --- | --- |
| A **control machine** | Runs the `hdc` CLI + your coding agent | Any Linux/macOS/Windows box with **Node.js 18+** and a GitHub token (`read:packages`) to install the CLI. |
| A **deployment target** | Where services run | **Proxmox** is recommended and first-class. Cloud works too (OCI/GCP/Azure/AWS) via compute packages — see Step 1. |
| A **model source** | The agents need an LLM | Either a local GPU box running **Ollama**, or an **OpenRouter** API key. This is the one dependency the agents can't run without. |
| A **notify + approve channel** | How agents reach you | Pick one to start: **Discord** (easiest, supports Approve/Deny buttons), email, or the built-in web UI. |

You do **not** need all services planned up front — that's the point. Get the platform +
agents running, then ask the agents to build the rest.

---

## Step 1 — Stand up deployment infrastructure

Pick where your services will live. Everything HDC deploys becomes an LXC container or VM
on this target.

- **Proxmox VE (recommended).** Install Proxmox on one or more hosts (a single node is
  fine to start). Create an API token for automation. This is the most complete path —
  LXC + QEMU provisioning, backups, and the guest baseline all work out of the box.
- **Cloud alternative.** HDC has infrastructure packages for **OCI** (`oci-compute`),
  **GCP** (`gcp-compute`), **Azure** (`azure-compute`), and **AWS** that provision VMs;
  some services (e.g. `uptime-kuma`) support an `oci-vm` mode. Expect a bit more manual
  wiring than Proxmox.

For sizing VMs/containers and checking cluster headroom, see
[proxmox-resource-planning](../.cursor/skills/proxmox-resource-planning/SKILL.md).

> Keep going once you can reach your target's API from the control machine (Proxmox API,
> or your cloud CLI credentials).

---

## Step 2 — Install the CLI and create your site repo

The simplest path is a **single private repo** that holds your site data and pulls the CLI
in as an npm package (`@dukk/hdc-cli`) — no need to clone the full platform git tree on
every workstation. Start from the workspace template:

```bash
# 1. Copy the operator-workspace template into your own private git repo
cp -r templates/hdc-private-workspace ~/my-hdc-site   # or download the template
cd ~/my-hdc-site && git init

# 2. Authenticate to GitHub Packages (a PAT with read:packages)
cp .npmrc.example .npmrc
export GITHUB_TOKEN=ghp_…          # keep the token in the env, not committed

# 3. Install the CLI package, then point config + vault at this repo
npm install                        # installs @dukk/hdc-cli → `npx hdc`
cp .env.example .env               # ensure HDC_PRIVATE_ROOT=.  (this repo is your site)
npx hdc secrets set HDC_EXAMPLE    # creates ~/.hdc/vault.enc on first use

# 4. Bootstrap package code (the "clumps") into the local cache
npx hdc clumps init
npx hdc list                       # confirm packages resolved
```

That's it — run everything with `npx hdc <command>` from this one repo. (Prefer the
classic three-git-repo layout? Clone [hdc](https://github.com/dukk/hdc), create an
`hdc-private` sibling, and run `./hdc` / `hdc.cmd` instead — see
[Three repositories](three-repos.md).)

Key rules that keep you safe:

- **Secrets live only in the vault.** To start, that's the local encrypted file
  (`~/.hdc/vault.enc`). Config and inventory reference secrets by **env-var name** — never
  paste values into JSON or git. *(Once you can host services, transition this vault to
  Vaultwarden — see Step 3.)*
- **Your live config + inventory stay in this private repo**, never in a public tree. Seed
  starter configs with `npx hdc`'s import flags or the bootstrap script.

Details: [npm workspace](npm-workspace.md) · [Three repositories](three-repos.md).

> The steps below write commands as `hdc …`. In the npm workspace, run them as
> `npx hdc …` — or just let your coding agent run them for you.

---

## Step 3 — Register your infrastructure (the manual part)

Tell HDC about your deployment target so the CLI can provision onto it. For Proxmox, that
means one config pointing at your cluster and a vault key for the API token:

```bash
# Configure clumps/infrastructure/proxmox/config.json in hdc-private
# (node names, storage, bridge, token vault key — copy from config.example.json)
hdc secrets set HDC_PROXMOX_API_TOKEN
hdc run infrastructure proxmox query          # confirm HDC can see your cluster
```

This is the "manually set up the infrastructure components" step. At minimum you need the
**deployment target** registered (above). Optionally, set up the shared building blocks
your services will lean on — you can do these now by hand, or ask the agents to later:

- **DNS** (`bind`) and **reverse proxy + WAF** (`nginx-waf`) for clean hostnames and TLS
- **UniFi** (`unifi-network`) if HDC should manage VLANs/firewall rules
- **Identity** (`keycloak`) if you want SSO for the web UIs

Each package has a `config.example.json` and a per-package doc — run `hdc list` to see
them, and see the [hdc-clumps README](../../hdc-clumps/README.md) for details.

> This is where per-environment tweaking of clumps happens (node names, storage, bridges,
> IPs, ports). It's exactly the fiddly work a coding agent is good at — point Claude Code
> or Cursor at the clump's `config.json` and `config.example.json` and let it adapt the
> package to your setup, then run the deploy and fix any script errors it hits.

### Recommended: move secrets to Vaultwarden

The local `~/.hdc/vault.enc` file is perfect for bootstrapping, but it lives on one
machine. Once you have a host to run services on, deploy **Vaultwarden** (a
Bitwarden-compatible server) and transition the vault to it — so secrets are shared across
your workstation and the agent fleet, versioned, and accessible from anywhere.

```bash
hdc run service vaultwarden deploy          # stand up the server
# In .env: HDC_SECRET_BACKEND=auto, HDC_VAULTWARDEN_URL/EMAIL/COLLECTION_ID (see linked doc)
hdc secrets unlock                          # log in via the Bitwarden CLI (bw)
hdc secrets push -- --dry-run               # preview the migration
hdc secrets push -- --force                 # copy local secrets into the HDC collection
hdc secrets sync-uris                       # attach service URLs to each item
```

`HDC_SECRET_BACKEND=auto` uses Vaultwarden when reachable and falls back to the local file
otherwise; a few **bootstrap keys** (like the Vaultwarden master password) stay local by
design. The agent fleet's scheduled host reads secrets from Vaultwarden
(`HDC_SECRET_BACKEND=vaultwarden`), so doing this before Step 4 means the fleet inherits
your secrets automatically. Full setup, ID resolution, and troubleshooting:
[Bitwarden CLI for hdc secrets](manually-deployed/bitwarden-cli.md).

---

## Step 4 — Deploy the agent fleet and its dependencies

The fleet needs a **model gateway** (LiteLLM) in front of your model source, then the
agent containers, then a way to reach you.

**4a. Model gateway.** Deploy LiteLLM pointed at your model source from Step 0:

```bash
# Local models: deploy Ollama first, then point LiteLLM at it
hdc run service ollama deploy
# Cloud models: set an OpenRouter key instead
hdc secrets set HDC_OPENROUTER_API_KEY
# Then deploy the gateway (edit clumps/services/litellm/config.json: ollama_backends[]/model_list[])
hdc run service litellm deploy
hdc run service litellm query -- --live
```

LiteLLM is also the **A2A registry** the agents use to find each other — see
[multi-agent operations](multi-agent-ops.md#8-litellm-model-gateway--a2a-registry).

**4b. The agent fleet.** Deploy the `hdc-agents` host (one container per role) plus the
web UI:

```bash
hdc run service hdc-agents deploy
```

**4c. Pick how agents notify you.** Wire **one** channel to start (Discord is easiest):

```bash
hdc secrets set HDC_AGENTS_DISCORD_WEBHOOK_URL
# In clumps/services/hdc-agents/config.json, set notifications.routes (default: Discord)
```

Options: Discord · email · Slack · Teams · Telegram, selected per event. See
[manager notifications](manually-deployed/manager-notifications.md).

**4d. Pick how you approve or deny.** Agents never run destructive work without your OK.
Choose at least one approval path:

| Path | How it works | Setup |
| --- | --- | --- |
| **Discord buttons** | Approve/Deny buttons on the alert message | Configure the hdc-ops Discord app (`application_id`, `public_key`, bot token, `channel_id`) |
| **Email reply** | Reply with subject `APPROVE <task-id>` / `REJECT <task-id>` | Manager mailbox (`manager@your-domain`), SPF/DKIM/DMARC passing |
| **Web UI** | The Tasks tab on `hdc-web-server` (`:9120`) | Comes with `hdc-agents`; log in and click Approve |

Details: [Web API](../apps/hdc-web-server/API.md) · [manager notifications](manually-deployed/manager-notifications.md).

---

## Step 5 — Hand work to the agents

Now the fun part. Create a task and let the fleet run it. You can:

- **Open the web UI** at `http://<hdc-agents-host>:9120` → Tasks tab, or drop a request in
  your notify channel / manager mailbox.
- **Ask for something concrete**, e.g. *"Deploy Immich for photos"* or *"Stand up Uptime
  Kuma and start monitoring everything."* The Manager triages it into a task, plans the
  deploy, and asks you to approve before it touches production.
- **Watch it work**: `hdc-monitor` sweeps health, `hdc-security-expert` watches for
  threats, and `hdc-sre-ops` runs approved deploys — all reporting back through your
  channel and the Tasks UI.

From here it's iterative: ask for the next service, approve, repeat. The agents handle the
baseline (automation user, antivirus, auto-updates, backups) on every guest they deploy.

---

## Where to go next

| Topic | Doc |
| --- | --- |
| The whole system, with diagrams | [ARCHITECTURE.md](../ARCHITECTURE.md) |
| How the three repos fit together | [Three repositories](three-repos.md) |
| The agent roster, handoffs, safety rails | [Multi-agent operations](multi-agent-ops.md) |
| Notification channels + approval routing | [Manager notifications](manually-deployed/manager-notifications.md) |
| The agent tool surface (MCP) | [hdc-mcp-server](manually-deployed/hdc-mcp-server.md) |
| Full CLI + per-package reference | [AGENTS.md](../AGENTS.md) |
| Every deployable package | [hdc-clumps README](../../hdc-clumps/README.md) |

**A note on philosophy:** HDC is built for a hobby that's *always learning and always
growing*. You are not expected to plan the perfect lab up front — stand up the platform,
get the agents running, and **fail forward**: ask, deploy, learn from what breaks, repeat.
