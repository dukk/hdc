variable "vm_name" {
  description = "Name of the VM"
  type        = string
}

variable "vm_id" {
  description = "ID of the VM"
  type        = number
}

variable "cores" {
  description = "Number of CPU cores"
  type        = number
}

variable "memory" {
  description = "Memory size in MB"
  type        = number
}

variable "disk_size" {
  description = "Disk size in GB"
  type        = number
}

variable "network_bridge" {
  description = "Network bridge"
  type        = string
}

variable "os_image" {
  description = "Path to the OS image"
  type        = string
}

variable "ip_address" {
  description = "Static IP address for the VM"
  type        = string
}

variable "target_node" {
  description = "Proxmox cluster node to deploy the VM on"
  type        = string
}

variable "tags" {
  description = "Tags to assign to the VM"
  type        = list(string)
  default     = []
}
