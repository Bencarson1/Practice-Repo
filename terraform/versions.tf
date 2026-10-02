terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}

  # azurerm v4 needs the subscription ID. Set it in terraform.tfvars,
  # or leave it empty and export ARM_SUBSCRIPTION_ID instead.
  subscription_id = var.subscription_id
}
