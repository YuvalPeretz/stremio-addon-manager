#!/bin/bash

# Debug script for 502 Bad Gateway issues
# Run this on the server where the addon is installed

set -e

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo "========================================="
echo "🔍 Debugging 502 Bad Gateway Issue"
echo "========================================="
echo ""

# Check 1: Service Status
echo -e "${BLUE}1. Checking systemd service status...${NC}"
SERVICE_NAME="stremio-addon"
if systemctl is-active --quiet $SERVICE_NAME; then
    echo -e "${GREEN}✅ Service is running${NC}"
else
    echo -e "${RED}❌ Service is NOT running${NC}"
    echo -e "${YELLOW}   Status:${NC}"
    sudo systemctl status $SERVICE_NAME --no-pager -l | head -20
fi
echo ""

# Check 2: Service Logs
echo -e "${BLUE}2. Checking recent service logs...${NC}"
echo -e "${CYAN}Last 20 lines of service logs:${NC}"
sudo journalctl -u $SERVICE_NAME -n 20 --no-pager
echo ""

# Check 3: Port Listening
echo -e "${BLUE}3. Checking if port 7000 is listening...${NC}"
PORT=7000
if netstat -tuln 2>/dev/null | grep -q ":$PORT " || ss -tuln 2>/dev/null | grep -q ":$PORT "; then
    echo -e "${GREEN}✅ Port $PORT is listening${NC}"
    echo -e "${CYAN}Details:${NC}"
    (netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null) | grep ":$PORT "
else
    echo -e "${RED}❌ Port $PORT is NOT listening${NC}"
fi
echo ""

# Check 4: Direct Connection Test
echo -e "${BLUE}4. Testing direct connection to backend...${NC}"
if curl -s -o /dev/null -w "%{http_code}" http://localhost:7000/ | grep -q "200\|404\|500"; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:7000/)
    echo -e "${GREEN}✅ Backend responds with HTTP $HTTP_CODE${NC}"
    echo -e "${CYAN}Response preview:${NC}"
    curl -s http://localhost:7000/ | head -5
else
    echo -e "${RED}❌ Backend does not respond${NC}"
    echo -e "${YELLOW}   This is likely the cause of the 502 error${NC}"
fi
echo ""

# Check 5: Nginx Configuration
echo -e "${BLUE}5. Checking Nginx configuration...${NC}"
if sudo nginx -t 2>&1 | grep -q "successful"; then
    echo -e "${GREEN}✅ Nginx configuration is valid${NC}"
else
    echo -e "${RED}❌ Nginx configuration has errors:${NC}"
    sudo nginx -t
fi
echo ""

# Check 6: Nginx Error Logs
echo -e "${BLUE}6. Checking Nginx error logs...${NC}"
echo -e "${CYAN}Last 10 lines of Nginx error log:${NC}"
sudo tail -10 /var/log/nginx/error.log 2>/dev/null || echo "   No error log found or permission denied"
echo ""

# Check 7: Nginx Access Logs
echo -e "${BLUE}7. Checking recent Nginx access logs...${NC}"
echo -e "${CYAN}Last 5 requests:${NC}"
sudo tail -5 /var/log/nginx/access.log 2>/dev/null || echo "   No access log found or permission denied"
echo ""

# Check 8: Service File Configuration
echo -e "${BLUE}8. Checking systemd service file...${NC}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
if [ -f "$SERVICE_FILE" ]; then
    echo -e "${GREEN}✅ Service file exists${NC}"
    echo -e "${CYAN}Service file contents:${NC}"
    sudo cat "$SERVICE_FILE"
else
    echo -e "${RED}❌ Service file not found at $SERVICE_FILE${NC}"
fi
echo ""

# Check 9: Environment Variables
echo -e "${BLUE}9. Checking environment variables in service...${NC}"
if [ -f "$SERVICE_FILE" ]; then
    echo -e "${CYAN}Environment variables:${NC}"
    sudo grep -E "Environment|EnvironmentFile" "$SERVICE_FILE" || echo "   No environment variables found"
fi
echo ""

# Check 10: Process Check
echo -e "${BLUE}10. Checking if addon process is running...${NC}"
if pgrep -f "stremio-addon\|server.js\|node.*addon" > /dev/null; then
    echo -e "${GREEN}✅ Addon process is running${NC}"
    echo -e "${CYAN}Process details:${NC}"
    ps aux | grep -E "stremio-addon|server.js|node.*addon" | grep -v grep
else
    echo -e "${RED}❌ No addon process found${NC}"
fi
echo ""

# Check 11: File Permissions
echo -e "${BLUE}11. Checking addon directory permissions...${NC}"
ADDON_DIR="/opt/stremio-addon"
if [ -d "$ADDON_DIR" ]; then
    echo -e "${GREEN}✅ Addon directory exists${NC}"
    echo -e "${CYAN}Directory permissions:${NC}"
    ls -ld "$ADDON_DIR"
    echo -e "${CYAN}Server.js exists:${NC}"
    if [ -f "$ADDON_DIR/server.js" ] || [ -f "$ADDON_DIR/bin/server.js" ]; then
        echo -e "${GREEN}✅ server.js found${NC}"
        ls -l "$ADDON_DIR"/server.js "$ADDON_DIR"/bin/server.js 2>/dev/null | head -1
    else
        echo -e "${RED}❌ server.js not found${NC}"
    fi
    echo -e "${CYAN}landing.html exists:${NC}"
    if [ -f "$ADDON_DIR/landing.html" ]; then
        echo -e "${GREEN}✅ landing.html found${NC}"
    else
        echo -e "${YELLOW}⚠️  landing.html not found (will use fallback HTML)${NC}"
    fi
else
    echo -e "${RED}❌ Addon directory not found at $ADDON_DIR${NC}"
fi
echo ""

# Summary
echo "========================================="
echo "📊 Summary"
echo "========================================="
echo ""
echo "Common causes of 502 Bad Gateway:"
echo "  1. Backend service not running"
echo "  2. Backend service not listening on localhost:7000"
echo "  3. Backend service crashed (check logs)"
echo "  4. Wrong port in Nginx proxy_pass"
echo "  5. Firewall blocking localhost connections"
echo "  6. Service file misconfiguration"
echo ""
echo "Next steps:"
echo "  - If service is not running: sudo systemctl start $SERVICE_NAME"
echo "  - If service failed: Check logs with: sudo journalctl -u $SERVICE_NAME -f"
echo "  - If port not listening: Check service configuration and logs"
echo "  - If Nginx config wrong: Check /etc/nginx/sites-available/stremio-addon"
echo ""
