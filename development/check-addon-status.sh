#!/bin/bash

# Script to check addon status on remote Pi
# Usage: ./check-addon-status.sh [addon-id]

set -e

SSH_HOST="${SSH_HOST:-192.168.0.50}"
SSH_USER="${SSH_USER:-yuvalpi}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"

echo "========================================="
echo "🔍 Checking Addon Status on Pi"
echo "========================================="
echo ""

# Check 1: List all systemd services
echo -e "\033[0;34m1. Checking systemd services...\033[0m"
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "systemctl list-units --type=service --all | grep stremio || echo 'No stremio services found'"
echo ""

# Check 2: Check addon directories
echo -e "\033[0;34m2. Checking addon directories in /opt...\033[0m"
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "ls -la /opt/ | grep stremio || echo 'No stremio directories in /opt'"
echo ""

# Check 3: Check Nginx configs
echo -e "\033[0;34m3. Checking Nginx configurations...\033[0m"
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "sudo ls -la /etc/nginx/sites-available/ | grep stremio || echo 'No stremio nginx configs found'"
echo ""

# Check 4: Check service files
echo -e "\033[0;34m4. Checking systemd service files...\033[0m"
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "sudo ls -la /etc/systemd/system/ | grep stremio || echo 'No stremio service files found'"
echo ""

# Check 5: Check if services are running
echo -e "\033[0;34m5. Checking service status...\033[0m"
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "for service in \$(systemctl list-units --type=service --all | grep stremio | awk '{print \$1}'); do echo \"=== \$service ===\"; sudo systemctl status \$service --no-pager -l | head -15; echo \"\"; done || echo 'No stremio services to check'"
echo ""

# Check 6: Check ports
echo -e "\033[0;34m6. Checking listening ports...\033[0m"
ssh -i "$SSH_KEY" "$SSH_USER@$SSH_HOST" "netstat -tuln 2>/dev/null | grep -E ':(7000|7001|7002|7003|7004|7005)' || ss -tuln 2>/dev/null | grep -E ':(7000|7001|7002|7003|7004|7005)' || echo 'No addon ports found'"
echo ""

echo "========================================="
echo "✅ Status check complete"
echo "========================================="
