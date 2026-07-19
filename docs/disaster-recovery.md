# Disaster recovery runbook

How to rebuild HDC from backups after losing the operator workstation, a guest,
or a hypervisor. Read top to bottom once; in an incident jump to the matching
scenario. Commands run from the hdc repo root (`hdc.cmd` on Windows, `./hdc` on
Unix); replace `hdc` below with that invocation.

## What is backed up, where

| Asset | Mechanism | Location | Verified by |
| --- | --- | --- | --- |
| Secrets vault (`~/.hdc/vault.enc`) | `secrets backup` (built into `maintain daily` when `HDC_VAULT_BACKUP_DIRS` is set) | Each dir in `HDC_VAULT_BACKUP_DIRS` as `hdc-vault-<ts>.enc` | Daily maintain step `hdc/vault-backup` |
| Bootstrap `.env` files (root + per-clump, hdc and hdc-private) | Same command; encrypted bundle with the vault passphrase | `hdc-bootstrap-<ts>.enc` beside the vault copies | Daily maintain step `hdc/vault-backup` |
| Site state (configs, inventory, reports) | git — **hdc-private** must be committed and pushed | hdc-private remote | Daily maintain step `hdc/private-git-check` fails when dirty/unpushed |
| Package code | git — hdc and hdc-clumps remotes | GitHub | CI |
| Guest disks (VMs + LXC) | Proxmox vzdump jobs reconciled by `proxmox maintain` (`provision.backups`) | NAS storage configured as backup target | `proxmox maintain` step `backup-verify` (last-run status/age per job) |
| Application data (consistent dumps) | `hdc-dump-<app>` systemd timers installed by service maintain | `/var/backups/hdc/<app>/` inside the guest (covered by vzdump) | Timer is re-ensured on every maintain |
| Vaultwarden server data | App dump: nightly sqlite `.backup` + data tar | `/var/backups/hdc/vaultwarden/` in the CT | vzdump of the CT includes it |
| PostgreSQL clusters | App dump: nightly `pg_dumpall | gzip` | `/var/backups/hdc/postgresql/` on each node | vzdump of the VM includes it |

Key properties:

- The vault copy is already AES-256-GCM encrypted; the backup destinations only
  need to be *available*, not confidential-grade.
- The bootstrap bundle is encrypted with the **local vault passphrase**. That
  passphrase is the single secret you must retain outside all automation
  (password manager you can reach without HDC, or printed in a safe). Everything
  else recovers from it.
- Vaultwarden is intentionally **not** the only home of secrets: the local
  vault + its file backups break the circular dependency (Vaultwarden's own
  recovery credentials live in the local vault backups, not in Vaultwarden).

## Scenario 1 — lost operator workstation

Goal: a new machine that can run `hdc` against the existing site.

1. Install Node.js 18+, git, and an SSH client.
2. Clone the three repos side by side: `hdc`, `hdc-private`, `hdc-clumps`
   (or run `hdc clumps init` after step 4 for the clumps cache).
3. Fetch the newest `hdc-vault-<ts>.enc` and `hdc-bootstrap-<ts>.enc` from a
   backup destination (NAS share or offsite copy).
4. Restore the vault: copy `hdc-vault-<ts>.enc` to `~/.hdc/vault.enc`.
5. Restore bootstrap files (prompts for the vault passphrase):

   ```bash
   hdc secrets restore-bootstrap hdc-bootstrap-<ts>.enc --out-dir ./restored
   ```

   Then move `restored/hdc/.env` to the hdc repo root, `restored/hdc-private/**`
   into hdc-private, and per-clump `.env` files into place. (Pointing
   `--out-dir` at the parent directory holding the `hdc` and `hdc-private`
   clones with `--force` writes them directly into the sibling layout.)
6. Sanity check: `hdc env` (redacted variables resolve), `hdc secrets list`
   (vault opens), `hdc run infrastructure proxmox query --` (API reachable).
7. Re-enable scheduled maintenance (Task Scheduler / cron entry for
   `hdc maintain daily`).

If no vault backup exists (worst case): the Vaultwarden CT still holds most
service secrets — restore Scenario 2 for `vaultwarden-a` first, log in with the
master password from your out-of-band store, and rebuild the local vault with
`hdc secrets set` per key.

## Scenario 2 — lost or corrupted guest (VM/LXC)

Goal: the guest back at its last vzdump snapshot.

1. Find the newest backup on the backup storage (Proxmox UI → storage →
   Backups, or `pvesm list <storage> --content backup` on a node).
2. Restore to the **same VMID** (replaces the guest) or a **scratch VMID**
   (side-by-side validation):

   ```bash
   # QEMU VM (on the Proxmox node)
   qmrestore <storage>:backup/<archive> <vmid> --storage <target-storage>

   # LXC container
   pct restore <vmid> <storage>:backup/<archive> --storage <target-storage>
   ```

3. Start the guest; verify with the service package:
   `hdc run service <id> query -- --live` and `hdc run service <id> health`.
4. If the app's database may have been corrupted *before* the snapshot, restore
   from the app dump inside the guest instead of trusting the disk image alone
   (next scenario).
5. Re-run `hdc run service <id> maintain --` to reconverge config, baseline,
   and dump timers.

## Scenario 3 — corrupted application data (disk snapshot not enough)

Guest-disk snapshots capture whatever was on disk — including corruption. Use
the nightly app dumps:

**PostgreSQL** (`/var/backups/hdc/postgresql/pg_dumpall-<ts>.sql.gz` on each node):

```bash
gunzip -c /var/backups/hdc/postgresql/pg_dumpall-<ts>.sql.gz | sudo -u postgres psql
```

For a single database, restore into a scratch DB first and `pg_dump` just that
database across.

**Vaultwarden** (`/var/backups/hdc/vaultwarden/` in the CT):

```bash
cd /opt/vaultwarden && docker compose down
DATA="$(docker volume inspect -f '{{ .Mountpoint }}' vaultwarden_vaultwarden-data)"
gunzip -c /var/backups/hdc/vaultwarden/db-<ts>.sqlite3.gz > "$DATA/db.sqlite3"
tar -C "$DATA" -xzf /var/backups/hdc/vaultwarden/data-<ts>.tar.gz
docker compose up -d
```

## Scenario 4 — lost hypervisor node

1. Guests with HA resources or storage replication fail over per
   `provision.ha` / `provision.replication` (see proxmox package).
2. For non-replicated guests, restore their vzdump archives onto a surviving
   node (Scenario 2) — backup storage is NAS-based, not node-local.
3. Rebuild the node, rejoin the cluster, then `hdc run infrastructure proxmox
   maintain --` to reconverge storage, backup jobs, firewall, and templates.

## Restore drill (monthly)

A backup that has never been restored is a hypothesis. Once a month, pick one:

**Drill A — bootstrap bundle (5 minutes, zero risk):**

```bash
hdc secrets backup --dry-run
hdc secrets restore-bootstrap <newest hdc-bootstrap-*.enc> --out-dir %TEMP%\hdc-drill
# confirm the .env files decrypt and look sane, then delete the folder
```

Also verify the vault copy: the backup is a byte-for-byte copy of
`~/.hdc/vault.enc`, so compare hashes (`Get-FileHash` / `sha256sum`) between the
newest `hdc-vault-<ts>.enc` and the live vault. A match proves the backup opens
with the same passphrase the live vault does.

**Drill B — guest restore to scratch VMID (30 minutes, safe):**

1. Pick a small CT (vaultwarden-a is the canonical choice).
2. On its node: `pct restore <scratch-vmid> <storage>:backup/<newest-archive> --storage <target>`
   using a VMID outside every allocated range (check
   `hdc-private/operations/ip-allocations.md` and the cluster UI first).
3. Start it **without network** (`pct set <scratch-vmid> -net0 name=eth0,link_down=1`)
   to avoid IP/hostname conflicts, `pct exec` in, and verify the app data is
   present (for Vaultwarden: `/var/backups/hdc/vaultwarden/` has recent dumps
   and the sqlite file opens).
4. Destroy the scratch guest: `pct destroy <scratch-vmid> --purge`.
5. Note the drill date and outcome in hdc-private `operations/` (the
   hdc-monitor skill's restore-drill task tracks this).

**Freshness checks are automated** — `proxmox maintain` fails when any
hdc-managed vzdump job has a failed or stale last run (`backup-verify` step),
and daily maintain fails when the vault backup cannot be written or hdc-private
is unpushed. Treat any of those failures as a page, not a log line.

## Order of recovery from total loss

1. Vault passphrase (from your out-of-band store) → vault + bootstrap restore
   (Scenario 1).
2. hdc / hdc-private / hdc-clumps clones.
3. Proxmox nodes reachable → restore core guests from vzdump in dependency
   order: bind (DNS) → nginx-waf (edge) → vaultwarden (secrets) → everything
   else.
4. `hdc maintain daily --dry-run` to survey drift; then per-service
   `maintain` to reconverge.
