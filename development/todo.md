# Fix Nginx Routing and Landing Page Issues

## Problem Summary

**Current Issues:**
1. `https://yuval707stremio.duckdns.org/` returns `ERR_INVALID_RESPONSE` (should show landing page HTML)
2. `https://yuval707stremio.duckdns.org/{password}/manifest.json` returns `502 Bad Gateway` (should return manifest JSON)

**Desired Behavior:**
1. `https://yuval707stremio.duckdns.org/` → Should proxy to `http://localhost:7000/` and show `landing.html`
2. `https://yuval707stremio.duckdns.org/{password}/manifest.json` → Should proxy to `http://localhost:7000/{password}/manifest.json` and return manifest JSON

## Root Cause Analysis

### Issue 1: Root Path Returns ERR_INVALID_RESPONSE
- **Current Nginx Config**: Returns 404 for root path `/` (from Phase 1 changes)
- **Expected**: Should proxy to `http://localhost:7000/` where the landing page is served
- **Server Behavior**: `server.ts` serves landing page at `/` route, looking for `landing.html` at `path.join(path.dirname(__dirname), "landing.html")` (addon-server package root)

### Issue 2: Manifest Returns 502 Bad Gateway
- **Possible Causes**:
  1. Backend service (port 7000) not running
  2. Nginx proxy_pass configuration incorrect
  3. Service binding issue (listening on wrong interface)
  4. Firewall blocking connection between Nginx and backend

### Issue 3: landing.html Not Included in Bundle
- **Current**: `copy-packages.js` only copies `['dist', 'package.json', 'README.md', 'bin']`
- **Missing**: `landing.html` is NOT copied to bundled addon-server
- **Impact**: Server falls back to default HTML instead of custom landing page

## Implementation Plan

### Phase 1: Fix Nginx Configuration

#### 1.1 Update `setupNginx()` in `core/src/installation/manager.ts`
- [x] Change root path (`location = /`) from returning 404 to proxying to `http://localhost:${port}/`
- [x] Keep stats endpoint (`location = /stats`) proxied to backend (or return 404 if desired)
- [x] Ensure manifest endpoint (`location ~ ^/([^/]+)/manifest\\.json$`) correctly proxies to backend
- [x] Ensure stream endpoint (`location ~ ^/([^/]+)/stream/(.+)$`) correctly proxies to backend
- [x] Add proper error handling for backend connection failures (502 errors)
- [x] Test Nginx config syntax before applying

**Files to modify:**
- `stremio-addon-manager/packages/core/src/installation/manager.ts` (lines ~1549-1635)

**Expected Nginx config structure:**
```nginx
server {
    listen 80;
    server_name ${domain};

    # Root path - proxy to backend landing page
    location = / {
        proxy_pass http://localhost:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

    # Stats endpoint - proxy to backend (or return 404 if desired)
    location = /stats {
        proxy_pass http://localhost:${port}/stats;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

    # Stremio addon manifest endpoint
    location ~ ^/([^/]+)/manifest\.json$ {
        proxy_pass http://localhost:${port}/$1/manifest.json;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # CORS headers
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        
        # Handle OPTIONS requests for CORS
        if ($request_method = OPTIONS) {
            return 204;
        }
    }

    # Stremio stream endpoint
    location ~ ^/([^/]+)/stream/(.+)$ {
        proxy_pass http://localhost:${port}/$1/stream/$2;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # Timeout settings for long-running stream requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
        
        # CORS headers
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        
        # Handle OPTIONS requests for CORS
        if ($request_method = OPTIONS) {
            return 204;
        }
    }

    # Block all other paths (optional - can proxy to backend for 404 handling)
    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

**Note**: When SSL is enabled, certbot will:
- Replace HTTP server block (port 80) with redirect to HTTPS
- Create/modify HTTPS server block (port 443) and preserve location blocks

---

### Phase 2: Include landing.html in Bundled Addon-Server

#### 2.1 Update Copy Scripts to Include landing.html

**CLI Copy Script:**
- [x] Update `packages/cli/scripts/copy-packages.js` to include `landing.html` in addon-server files
- [x] Ensure landing.html is copied from addon-server package root (if it exists there)
- [x] Or copy from repo root if landing.html is at repo level

**Electron Copy Script:**
- [x] Update `packages/electron/scripts/copy-packages.js` to include `landing.html` in addon-server files (not needed - CLI resources already include it)
- [x] Ensure landing.html is copied to bundled resources

**Files to modify:**
- `stremio-addon-manager/packages/cli/scripts/copy-packages.js` (line ~27)
- `stremio-addon-manager/packages/electron/scripts/copy-packages.js` (if exists)

**Current code:**
```javascript
{
  name: 'addon-server',
  files: ['dist', 'package.json', 'README.md', 'bin'],
}
```

**Should be:**
```javascript
{
  name: 'addon-server',
  files: ['dist', 'package.json', 'README.md', 'bin', 'landing.html'],
}
```

#### 2.2 Ensure landing.html Exists in Addon-Server Package

**Option A: Copy landing.html to addon-server package**
- [x] Copy `landing.html` from repo root to `packages/addon-server/landing.html`
- [x] Update `.gitignore` if needed (landing.html should be tracked)
- [x] Ensure it's included in package build (copy scripts now include it)

**Option B: Update server.ts to Look in Different Location**
- [ ] Modify `server.ts` to look for landing.html in a different location
- [ ] Or embed landing.html content directly in server.ts
- [ ] Or use a different path resolution strategy

**Files to check/modify:**
- `stremio-addon-manager/packages/addon-server/src/server.ts` (line ~110)
- `landing.html` (repo root) - may need to be moved/copied

**Current server.ts code:**
```typescript
const landingPath = path.join(path.dirname(__dirname), "landing.html");
```

**Options:**
1. Keep current path but ensure landing.html is copied to addon-server root
2. Change to look in `dist/` directory: `path.join(__dirname, "landing.html")`
3. Change to look in installation root: `path.join(process.cwd(), "landing.html")`

---

### Phase 3: Fix 502 Bad Gateway Issue

#### 3.1 Verify Service is Running
- [ ] Check if systemd service is running: `sudo systemctl status stremio-addon`
- [ ] Check service logs: `sudo journalctl -u stremio-addon -f`
- [ ] Verify service is listening on correct port (7000)
- [ ] Verify service is binding to correct interface (should listen on `0.0.0.0` or `localhost`)

#### 3.2 Check Service Configuration
- [ ] Review systemd service file: `/etc/systemd/system/stremio-addon.service`
- [ ] Verify `ExecStart` points to correct server.js path
- [ ] Verify environment variables are set correctly (PORT, ADDON_PASSWORD, RD_API_TOKEN, etc.)
- [ ] Verify working directory is correct
- [ ] Check if service has proper permissions

#### 3.3 Test Backend Connectivity
- [ ] Test direct connection: `curl http://localhost:7000/` (from server)
- [ ] Test manifest endpoint: `curl http://localhost:7000/{password}/manifest.json` (from server)
- [ ] Verify Nginx can connect: `curl http://localhost:7000/` (from server, as nginx user if possible)
- [ ] Check firewall rules: `sudo ufw status`
- [ ] Verify port 7000 is not blocked

#### 3.4 Fix Nginx Proxy Configuration
- [ ] Ensure `proxy_pass` URLs are correct (no trailing slash issues)
- [ ] Add `proxy_connect_timeout` and `proxy_read_timeout` settings
- [ ] Add error handling for backend connection failures
- [ ] Check Nginx error logs: `sudo tail -f /var/log/nginx/error.log`
- [ ] Verify Nginx can resolve `localhost` (should be 127.0.0.1)

**Common 502 Causes:**
1. Backend service not running
2. Backend service listening on wrong interface (127.0.0.1 vs 0.0.0.0)
3. Backend service crashed/not started properly
4. Port mismatch (service on different port than expected)
5. Firewall blocking localhost connections
6. Nginx proxy_pass URL incorrect (trailing slash, wrong port, etc.)

---

### Phase 4: Update Installation Process

#### 4.1 Ensure landing.html is Copied During Installation
- [ ] Verify `copyBundledAddonServer()` copies landing.html if it exists in source
- [ ] Add explicit check/logging for landing.html copy
- [ ] Ensure landing.html permissions are correct after copy

**Files to modify:**
- `stremio-addon-manager/packages/core/src/installation/manager.ts` (method `copyBundledAddonServer`)

#### 4.2 Update Verification Step
- [ ] Update `verifyInstallation()` to check if landing page is accessible
- [ ] Test root path returns 200 (not 404)
- [ ] Test manifest endpoint returns 200 (not 502)
- [ ] Add better error messages for common failures

**Files to modify:**
- `stremio-addon-manager/packages/core/src/installation/manager.ts` (method `verifyInstallation`)

---

### Phase 5: Testing & Verification

#### 5.1 Test Root Path
- [ ] `https://domain/` should return 200 with HTML content
- [ ] HTML should be the custom landing page (not fallback)
- [ ] Test from browser and verify styling/functionality

#### 5.2 Test Manifest Endpoint
- [ ] `https://domain/{password}/manifest.json` should return 200 with JSON
- [ ] JSON should be valid Stremio manifest
- [ ] Test from browser and Stremio client
- [ ] Verify CORS headers are present

#### 5.3 Test Stream Endpoint
- [ ] `https://domain/{password}/stream/movie/tt123456.json` should return 200
- [ ] May return empty streams array (that's OK for testing)
- [ ] Verify no 502 errors

#### 5.4 Test Direct Access (Port 7000)
- [ ] `http://domain:7000/` should work (if firewall allows)
- [ ] `http://domain:7000/{password}/manifest.json` should work
- [ ] Verify backend is accessible directly

#### 5.5 Test SSL Configuration
- [ ] HTTP redirects to HTTPS
- [ ] HTTPS endpoints work correctly
- [ ] Certificate is valid

---

## Implementation Order

1. **Phase 1** - Fix Nginx config (highest priority - fixes routing) ✅ **COMPLETE**
2. **Phase 2** - Include landing.html in bundle (needed for landing page) ✅ **COMPLETE**
3. **Phase 3** - Fix 502 issue (debugging - may be service-related) ⏳ **IN PROGRESS**
4. **Phase 4** - Update installation process (ensure everything works) ⏳ **PENDING**
5. **Phase 5** - Testing (verify everything works) ⏳ **PENDING**

## ✅ Completed Work

### Phase 1: Fix Nginx Configuration ✅
- [x] Updated root path to proxy to backend
- [x] Updated stats endpoint to proxy to backend
- [x] Verified manifest and stream endpoints
- [x] Added error handling with timeouts
- [x] Tested Nginx config syntax

### Phase 2: Include landing.html in Bundle ✅
- [x] Copied landing.html to addon-server package
- [x] Updated CLI copy script to include landing.html
- [x] Verified path resolution works correctly
- [x] Created test script to verify paths

### Debugging Tools Created ✅
- [x] Created `debug-502.sh` script for comprehensive debugging
- [x] Created `test-landing-path.js` to verify path resolution
- [x] Verified landing.html will be found at correct location

---

## Questions to Resolve

1. **Where should landing.html be located?**
   - Option A: In `packages/addon-server/landing.html` (package root)
   - Option B: In `packages/addon-server/dist/landing.html` (dist directory)
   - Option C: Copied from repo root during build/installation

2. **Should stats endpoint be public or private?**
   - Current: Proxied to backend (public)
   - Alternative: Return 404 (private, management only)

3. **What's causing the 502 error?**
   - Need to check service status and logs
   - May need to verify service is running and accessible

---

## Priority

**High** - This blocks core functionality:
- Users can't see landing page
- Users can't install addon (manifest returns 502)
- Addon is not functional

---

## Estimated Effort

- Phase 1: 1 hour (Nginx config update)
- Phase 2: 1-2 hours (Copy scripts + landing.html location)
- Phase 3: 2-3 hours (Debugging 502 issue)
- Phase 4: 1 hour (Installation updates)
- Phase 5: 1-2 hours (Testing)

**Total: ~6-9 hours**
