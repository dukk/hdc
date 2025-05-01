resource "proxmox_vm_qemu" "vm" {
  name       = var.vm_name
  vmid       = var.vm_id
  cores      = var.cores
  memory     = var.memory
  disk {
    size = "${var.disk_size}G"
  }
  network {
    bridge = var.network_bridge
    ip     = var.ip_address
  }
  iso         = var.os_image
  target_node = var.target_node
  tags        = var.tags
}

output "vm_ip" {
  value = proxmox_vm_qemu.vm.network[0].ip
}
