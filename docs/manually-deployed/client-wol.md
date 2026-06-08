# Wake-on-LAN for home clients

HDC can send a magic packet before `hdc run client windows|client-ubuntu|raspberrypi maintain|query` when a host is offline.

## Host requirements

- WoL enabled in BIOS/UEFI (wake on PCI-E / magic packet).
- NIC stays powered in sleep/hibernate.
- Use the **wired** MAC address that receives the broadcast (Wi-Fi WoL is often unreliable).

## Network

- Prefer a **directed broadcast** for the client subnet in each client package `config.json` (`wol.broadcast`, e.g. `192.0.2.255` in `packages/clients/windows/config.json` or `packages/clients/ubuntu/config.json`).
- WoL is layer-2: the machine running hdc must reach that broadcast domain (same VLAN or a router that forwards directed broadcasts).

## Config

Set `access.nodes[].mac` or `hosts[].wol.mac` in `config.json`, or link `system_id` to a manual inventory sidecar with `mac` on the primary node.

Skip wake attempts: `hdc run client windows maintain -- --no-wol`
