# Azure practice (Terraform)

DevOps practice: a resource group, a virtual network and subnet, a storage account and a small Ubuntu VM in Azure. This has nothing to do with the NebedaHub website.

```bash
cd terraform
az login
cp terraform.tfvars.example terraform.tfvars   # then fill in your subscription ID and SSH public key
terraform init
terraform plan
terraform apply
terraform destroy   # when you're done, so you aren't charged
```

The "Terraform check" GitHub Action runs `terraform fmt -check` and `terraform validate` on every change to this folder.
