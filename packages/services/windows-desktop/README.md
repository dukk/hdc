# windows-desktop

Deploy **Windows 11** as a Proxmox **QEMU** VM from ISO with generated `autounattend.xml`, using the hypervisor **OEM MSDM/SLIC** ACPI tables when present on the node (e.g. `pve-b`).

## Prerequisites

1. **Proxmox** — `packages/infrastructure/proxmox/config.json` with `pve-b` (or your target host) and API token in vault (`HDC_PROXMOX_API_TOKEN_PVE_B` or cluster token).
2. **ISO files on the node** (upload via Proxmox UI or `scp` to `/var/lib/vz/template/iso/`):
   - Windows 11 installation ISO (match `proxmox.iso.windows_volid` in config).
   - [VirtIO drivers ISO](https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/) (`virtio-win.iso`).
3. **OEM license** — The physical host running Proxmox must expose MSDM and/or SLIC in firmware (`/sys/firmware/acpi/tables/`). Only **one** Windows VM per hypervisor may use `-acpitable` passthrough.
4. **Vault** — `HDC_WINDOWS_DESKTOP_ADMIN_PASSWORD` for the local admin account created during setup.

## Config

Copy [`config.example.json`](config.example.json) to **hdc-private**:

`packages/services/windows-desktop/config.json`

Set real ISO volids, static IP (`proxmox.qemu.ip`), and `vmid` (or omit/`null` for auto-allocation).

## Inventory (hdc-private)

- `inventory/manual/systems/vm-win11-a.json` — `system_class: virtual`, `hosted_on_system_id: pve-b`
- `inventory/manual/services/windows-desktop.json` — service sidecar

## Commands

```bash
node tools/hdc/cli.mjs secrets set HDC_WINDOWS_DESKTOP_ADMIN_PASSWORD

node tools/hdc/cli.mjs run service windows-desktop deploy -- --instance a --wait-install

node tools/hdc/cli.mjs run service windows-desktop query -- --live

node tools/hdc/cli.mjs run service windows-desktop maintain -- --instance a

node tools/hdc/cli.mjs run infrastructure proxmox maintain --
```

Deploy flags: `--destroy-existing`, `--skip-oem`, `--skip-install`, `--wait-install`, `--install-timeout-minutes 90`.

## OEM activation notes

- hdc dumps ACPI tables to `/etc/pve/nodes/<pve_node>/qemu-server/MSDM_table` (and `SLIC_table` when present) and sets VM `args: -acpitable` plus `smbios1` from host `dmidecode`.
- Activation can take time after first boot; match CPU/RAM/disk roughly to the original OEM hardware if needed.
- Legal compliance for OEM licensing on virtualized hardware is the operator’s responsibility.

## Manual fallback

If unattended setup cannot find the VirtIO SCSI driver, use the Proxmox console during install: **Load driver** from the virtio ISO (`vioscsi` / Win11 amd64). The README paths in `autounattend.xml` assume virtio ISO as drive **E:**.

## Limits

- No GPU/USB passthrough in v1.
- Install completion detection is best-effort (`--wait-install` polls VM power state).
- Windows guests do not receive the Linux guest baseline (ClamAV / `HDC_ADMIN_USER`).
