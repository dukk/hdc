# Proxmox - Primary Cluster

Structured inventory lives in [`example-proxmox-cluster.json`](example-proxmox-cluster.json). Regenerate the block below with:

`node apps/hdc-cli/cli.mjs docs sync`

<!-- hdc:inventory -->
## Hardware (synced)

| Name | Description | CPU | Cores | Memory | Memory capacity | Storage | Storage capacity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hypervisor-a |  | 12th Gen Intel(R) Core(TM) i5-12450H (1 Socket) | 12 | DDR4 | 64g |  |  |
| hypervisor-b |  | 12th Gen Intel(R) Core(TM) i5-12450H (1 Socket) | 12 | DDR4 | 64g |  |  |
| hypervisor-c |  | 13th Gen Intel(R) Core(TM) i7-13700H (1 Socket) | 20 | DDR5 | 64g |  |  |

## Network (synced)

| Node | Hostname(s) | IP(s) |
| --- | --- | --- |
| hypervisor-a | hypervisor-a.hdc.example.invalid, hypervisor-a.hdc.example.invalid, hypervisor-a.example.invalid | 192.0.2.11 |
| hypervisor-b | hypervisor-b.hdc.example.invalid, hypervisor-b.hdc.example.invalid, hypervisor-b.example.invalid | 192.0.2.12 |
| hypervisor-c | hypervisor-c.hdc.example.invalid, hypervisor-c.hdc.example.invalid, hypervisor-c.example.invalid | 192.0.2.13 |

## Management (synced)

| Node | Interfaces |
| --- | --- |
| hypervisor-a | [Web UI](https://192.0.2.11:8006), [SSH](ssh://root@192.0.2.11) |
| hypervisor-b | [Web UI](https://192.0.2.12:8006), [SSH](ssh://root@192.0.2.12) |
| hypervisor-c | [Web UI](https://192.0.2.13:8006), [SSH](ssh://root@192.0.2.13) |
<!-- /hdc:inventory -->

## Nagios (central + NRPE)

Central Nagios and NRPE on each hypervisor are driven by [`example-proxmox-cluster.json`](example-proxmox-cluster.json): fill `nagios.central.address` and `nagios.central.ssh` (same pattern as node `ssh` URIs). Open **TCP 5666** from the central Nagios host to each cluster node so `check_nrpe` works. Deploy: `node apps/hdc-cli/cli.mjs run service nagios deploy`.
