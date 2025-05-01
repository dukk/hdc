output "vm_ip" {
  value = proxmox_vm_qemu.vm.network[0].ip
}
