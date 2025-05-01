#!/usr/bin/sh
# This script runs the Ansible playbook to install Nginx on WAF nodes.

# Ensure Ansible is installed
if ! command -v ansible-playbook &> /dev/null; then
    echo "Ansible is not installed. Please install it first."
    exit 1
fi

# Run the Ansible playbook
ansible-playbook -i inventory.ini ../ansible/install-nginx.yml
