# Storage account names must be 3-24 lowercase letters or numbers and unique
# across all of Azure, so a random number is added to the prefix.
resource "random_integer" "suffix" {
  min = 10000
  max = 99999
}

resource "azurerm_storage_account" "sa" {
  name                            = "${var.prefix}${random_integer.suffix.result}"
  resource_group_name             = azurerm_resource_group.example.name
  location                        = azurerm_resource_group.example.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
}
