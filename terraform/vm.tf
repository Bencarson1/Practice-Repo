resource "azurerm_network_interface" "example" {
  name                = "${var.prefix}-nic"
  location            = azurerm_resource_group.example.location
  resource_group_name = azurerm_resource_group.example.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.example.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_linux_virtual_machine" "example" {
  name                  = "${var.prefix}-vm"
  resource_group_name   = azurerm_resource_group.example.name
  location              = azurerm_resource_group.example.location
  size                  = var.vm_size
  admin_username        = var.admin_username
  network_interface_ids = [azurerm_network_interface.example.id]

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.admin_ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  # Ubuntu 24.04 LTS (18.04 no longer gets security updates)
  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }
}
