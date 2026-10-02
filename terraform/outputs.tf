output "resource_group_name" {
  value = azurerm_resource_group.example.name
}

output "resource_group_location" {
  value = azurerm_resource_group.example.location
}

output "storage_account_name" {
  value = azurerm_storage_account.sa.name
}

output "storage_primary_blob_endpoint" {
  value = azurerm_storage_account.sa.primary_blob_endpoint
}

output "vm_private_ip" {
  value = azurerm_linux_virtual_machine.example.private_ip_address
}
