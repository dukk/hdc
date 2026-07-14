# Inventory naming (summary)

Applies to `kind: "system"` ids:

| Workload | Prefix | Example |
| --- | --- | --- |
| Physical host / hypervisor | *(none)* | `hypervisor-a` |
| VM (QEMU/KVM) | `vm-` | `vm-nginx-waf-a` |
| LXC | *(none)* | `pi-hole-a` |
| Other virtual | `virt-` | `virt-vpn-endpoint-a` |

Multi-instance: `-a`, `-b` (not `-1`, `-2`). Id must match filename stem. Proxmox is authoritative for `system_class`.
