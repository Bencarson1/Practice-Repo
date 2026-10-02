variable "subscription_id" {
  description = "Azure subscription ID (run `az account show --query id -o tsv`). Leave null to use ARM_SUBSCRIPTION_ID."
  type        = string
  default     = null
}

variable "location" {
  description = "Azure region for every resource."
  type        = string
  default     = "East US"
}

variable "prefix" {
  description = "Short name used at the start of every resource name."
  type        = string
  default     = "practice"

  validation {
    # Also used in the storage account name, which only allows lowercase letters and numbers.
    condition     = can(regex("^[a-z0-9]{3,15}$", var.prefix))
    error_message = "prefix must be 3-15 lowercase letters or numbers."
  }
}

variable "vm_size" {
  description = "Size of the Linux VM."
  type        = string
  default     = "Standard_B1s"
}

variable "admin_username" {
  description = "Admin user name on the VM."
  type        = string
  default     = "azureuser"
}

variable "admin_ssh_public_key" {
  description = "Your SSH PUBLIC key (the contents of ~/.ssh/id_rsa.pub or ~/.ssh/id_ed25519.pub)."
  type        = string
}
