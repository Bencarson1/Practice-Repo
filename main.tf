provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "example" {
  name     = "practice-rg"
  location = "East US"
}
