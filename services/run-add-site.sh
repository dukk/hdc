#!/usr/bin/sh
# This script runs the Ansible playbook to add a site to Nginx with Let's Encrypt SSL.

# Ensure Ansible is installed
if ! command -v ansible-playbook &> /dev/null; then
    echo "Ansible is not installed. Please install it first."
    exit 1
fi

# Define variables
DOMAIN="drippylit.com"
EMAIL="admin@drippylit.com"
PROXY_PASS_URL="http://10.0.0.131"

# Run the Ansible playbook
ansible-playbook ../services/ansible/playbooks/nginx/install-site.yml \
  --extra-vars "domain_name=${DOMAIN} email=${EMAIL} proxy_pass_url=${PROXY_PASS_URL}"
