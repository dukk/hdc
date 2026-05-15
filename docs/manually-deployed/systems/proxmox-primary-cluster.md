# Proxmox - Primary Cluster

Structured inventory lives in [`proxmox-primary-cluster.inventory.json`](proxmox-primary-cluster.inventory.json). Regenerate the block below with:

`node tools/hdc/cli.mjs docs sync`

<!-- hdc:inventory -->
## Hardware (synced)

| Name | Description | CPU | Cores | Memory | Memory capacity | Storage | Storage capacity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pve-a |  | 12th Gen Intel(R) Core(TM) i5-12450H (1 Socket) | 12 | DDR4 | 64g |  |  |
| pve-b |  | 12th Gen Intel(R) Core(TM) i5-12450H (1 Socket) | 12 | DDR4 | 64g |  |  |
| pve-c |  | 13th Gen Intel(R) Core(TM) i7-13700H (1 Socket) | 20 | DDR5 | 64g |  |  |

## Network (synced)

| Node | Hostname(s) | IP(s) |
| --- | --- | --- |
| pve-a | pve-a.hdc.dukk.org, pve-a.hdc.local, pve-a.dukk.cloud | 10.0.0.11 |
| pve-b | pve-b.hdc.dukk.org, pve-b.hdc.local, pve-b.dukk.cloud | 10.0.0.12 |
| pve-c | pve-c.hdc.dukk.org, pve-c.hdc.local, pve-c.dukk.cloud | 10.0.0.13 |

## Management (synced)

| Node | Interfaces |
| --- | --- |
| pve-a | [Web UI](https://10.0.0.11:8006), [SSH](ssh://root@10.0.0.11) |
| pve-b | [Web UI](https://10.0.0.12:8006), [SSH](ssh://root@10.0.0.12) |
| pve-c | [Web UI](https://10.0.0.13:8006), [SSH](ssh://root@10.0.0.13) |
<!-- /hdc:inventory -->

## Nagios (central + NRPE)

Central Nagios and NRPE on each hypervisor are driven by [`proxmox-primary-cluster.inventory.json`](proxmox-primary-cluster.inventory.json): fill `nagios.central.address` and `nagios.central.ssh` (same pattern as node `ssh` URIs). Open **TCP 5666** from the central Nagios host to each cluster node so `check_nrpe` works. Deploy: `node tools/hdc/cli.mjs run nagios deploy`.
