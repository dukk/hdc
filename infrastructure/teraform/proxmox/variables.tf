variable "deployment_tag" {
  description = "Tag for the deployment"
  type        = string
}

variable "proxmox_api_url" {
  description = "Proxmox API URL"
  type        = string
}

variable "proxmox_user" {
  description = "Proxmox username"
  type        = string
}

variable "proxmox_password" {
  description = "Proxmox password"
  type        = string
  sensitive   = true
}

variable "proxmox_cluster_host_count" {
  description = "Number of Proxmox hosts in the cluster"
  type        = number
  default = 1
}

variable "proxmox_cluster_host_prefix" {
  description = "Prefix for Proxmox cluster hostnames"
  type        = string
  default = "pve-"
}

variable "proxmox_cluster_host_ip_starting_ip" {
  description = "Starting IP address for Proxmox cluster hosts"
  type        = string
}

variable "bastion_vm_ip_starting_ip" {
  description = "Starting IP address for Bastion VMs"
  type        = string
}

variable "bastion_vm_os_image" {
  description = "Path to the OS image for Bastion VMs"
  type        = string
  default = "/var/lib/vz/template/iso/ubuntu-20.04-server.iso"
}

variable "waf_vm_ip_starting_ip" {
  description = "Starting IP address for WAF VMs"
  type        = string
}

variable "waf_vm_os_image" {
  description = "Path to the OS image for WAF VMs"
  type        = string
  default = "/var/lib/vz/template/iso/ubuntu-20.04-server.iso"
}

variable "app_vm_ip_starting_ip" {
  description = "Starting IP address for App VMs"
  type        = string
}

variable "app_vm_os_image" {
  description = "Path to the OS image for App VMs"
  type        = string
  default = "/var/lib/vz/template/iso/ubuntu-20.04-server.iso"
}

variable "web_vm_ip_starting_ip" {
  description = "Starting IP address for Web VMs"
  type        = string
}

variable "web_vm_os_image" {
  description = "Path to the OS image for Web VMs"
  type        = string
  default = "/var/lib/vz/template/iso/ubuntu-20.04-server.iso"
}

variable "minecraft_vm_ip_starting_ip" {
  description = "Starting IP address for Minecraft VMs"
  type        = string
}

variable "minecraft_vm_os_image" {
  description = "Path to the OS image for Minecraft VMs"
  type        = string
  default = "/var/lib/vz/template/iso/ubuntu-20.04-server.iso"
}