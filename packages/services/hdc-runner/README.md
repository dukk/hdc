# HDC Runner

Scheduled automation host: runs the full **hdc** CLI on cron, synced from your operator workstation via `maintain`, with secrets from **Vaultwarden** (`bw`) and operation reports emailed as HTML through the internal postfix-relay.

## Config

Copy [`config.example.json`](config.example.json) to **hdc-private** at `packages/services/hdc-runner/config.json`.

Key blocks:

| Block | Purpose |
| --- | --- |
| `hdc_runner.install_root` | Public hdc tree on guest (default `/opt/hdc`) |
| `hdc_runner.private_root` | hdc-private mirror (default `/opt/hdc-private`) |
| `hdc_runner.env` | Non-secret env vars (`HDC_SECRET_BACKEND`, `HDC_VAULTWARDEN_*`) |
| `hdc_runner.schedules[]` | Cron + hdc CLI argv + optional mail overrides |
| `hdc_runner.mail` | Default email recipient and subject prefix |
| `configure.ssh.host` | Guest IP for operator rsync (set after first deploy) |

## Deploy

```bash
node tools/hdc/cli.mjs run service hdc-runner deploy -- --instance a
```

Supports `proxmox-lxc` (default) and `proxmox-qemu`. Installs Node.js, Bitwarden CLI, syncs repos from the operator, pushes cron + `.env`, applies guest baseline (mail relay; skips ClamAV).

## Maintain

Primary workflow after changing hdc code, hdc-private config, or schedules:

```bash
node tools/hdc/cli.mjs run service hdc-runner maintain --
```

- Rsync `--delete` from operator `hdc` + `hdc-private` to the guest (requires `rsync` on the operator and SSH to the guest as `hdc`)
- Refreshes `/opt/hdc-runner/.env` including `HDC_VAULTWARDEN_MASTER_PASSWORD` from the operator vault
- Regenerates `/etc/cron.d/hdc-runner-*` (use `--prune` to remove stale schedules)

Flags: `--dry-run`, `--skip-sync`, `--skip-clamav`, `--prune`

## Schedules

Each schedule runs:

```bash
node /opt/hdc/tools/hdc/cli.mjs <cli...> <cli_args...>
```

Example: `maintain daily` with `--skip-clients` at 03:00 daily.

Test manually on the guest:

```bash
sudo -u hdc node /opt/hdc-runner/bin/run-scheduled-job.mjs daily-maintain
```

## Email

When mail is enabled, the job wrapper sends the operation report markdown as **multipart HTML** via local `sendmail` → postfix-relay. Requires guest baseline mail relay (applied automatically).

## Query

```bash
node tools/hdc/cli.mjs run service hdc-runner query --
node tools/hdc/cli.mjs run service hdc-runner query -- --live
```

## Teardown

```bash
node tools/hdc/cli.mjs run service hdc-runner teardown -- --instance a --yes
```

## Inventory

Add `inventory/manual/systems/hdc-runner-a.json` and `inventory/manual/services/hdc-runner.json` in hdc-private.
