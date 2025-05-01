provider "proxmox" {
  pm_api_url = var.proxmox_api_url
  pm_user    = var.proxmox_user
  pm_password = var.proxmox_password
  pm_tls_insecure = true
}

#
module "bastion_nodes" {
  source = "../modules/vm"

  count = 3
  vm_name = "bastion-${count.index + 1}"
  vm_id   = 1000 + count.index
  cores   = 1
  memory  = 2048
  disk_size = 30
  network_bridge = var.network_bridge
  os_image = var.bastion_os_image
  ip_address = var.bastion_ip + "${101 + count.index}"
  target_node = var.proxmox_host_prefix + "${1 + count.index}"
  tags = ["bastion", "deployment:${var.deployment_tag}"]
}

module "waf_nodes" {
  source = "../modules/vm"

  count = 3
  vm_name = "waf-${count.index + 1}"
  vm_id   = 1100 + count.index
  cores   = 2
  memory  = 2048
  disk_size = 30
  network_bridge = var.network_bridge
  os_image = var.app_node_os_image
  ip_address = "10.0.0.${111 + count.index}"
  target_node = var.proxmox_host_prefix + "${1 + count.index}"
  tags = ["waf", "deployment:${var.deployment_tag}"]
}

module "app_nodes" {
  source = "../modules/vm"

  count = 3
  vm_name = "app-${count.index + 1}"
  vm_id   = 1200 + count.index
  cores   = var.vm_cores
  memory  = var.vm_memory
  disk_size = var.vm_disk_size
  network_bridge = var.network_bridge
  os_image = var.app_node_os_image
  ip_address = "10.0.0.${121 + count.index}"
  target_node = var.proxmox_host_prefix + "${1 + count.index}"
  tags = ["app", "deployment:${var.deployment_tag}"]
}

module "web_nodes" {
  source = "../modules/vm"

  count = 3
  vm_name = "web-${count.index + 1}"
  vm_id   = 1300 + count.index
  cores   = var.vm_cores
  memory  = var.vm_memory
  disk_size = var.vm_disk_size
  network_bridge = var.network_bridge
  os_image = var.app_node_os_image
  ip_address = "10.0.0.${131 + count.index}"
  target_node = var.proxmox_host_prefix + "${1 + count.index}"
  tags = ["web", "deployment:${var.deployment_tag}"]
}

module "minecraft_nodes" {
  source = "../modules/vm"

  count = 3
  vm_name = "minecraft-${count.index + 1}"
  vm_id   = 1300 + count.index
  cores   = var.vm_cores
  memory  = var.vm_memory
  disk_size = var.vm_disk_size
  network_bridge = var.network_bridge
  os_image = var.app_node_os_image
  ip_address = "10.0.0.${131 + count.index}"
  target_node = var.proxmox_host_prefix + "${1 + count.index}"
  tags = ["minecraft", "deployment:${var.deployment_tag}"]
}