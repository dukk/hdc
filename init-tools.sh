#!/usr/bin/sh
# This script is used to initialize the tools for the project.
# It will install the required tools and set up the environment.
# It will also check if the tools are already installed and if not, it will install them.

# Check if the tools are already installed
if [ -f "tools/installed" ]; then
    echo "Tools are already installed."
    exit 0
fi

# Create the tools directory if it does not exist
mkdir -p tools
# Install the required tools
echo "Installing tools..."
sudo apt update
sudo apt install -y terraform ansible

# Create the installed file
touch tools/installed


echo "Tools initialized successfully."
