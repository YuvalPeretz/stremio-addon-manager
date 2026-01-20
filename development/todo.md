# Development Todo

## SSL Certificate Reuse - Prevent Let's Encrypt Rate Limiting

### Problem
When installing an addon, the installation process attempts to create a new SSL certificate via Let's Encrypt even if one already exists for the domain. This causes rate limiting errors:
```
too many certificates (5) already issued for this exact set of identifiers in the last 168h0m0s
```

### Solution
Before attempting to create a new SSL certificate, check if a valid certificate already exists for the domain. If it exists and is valid, reuse it instead of creating a new one.

### Implementation Plan

#### Phase 1: Add Certificate Check Function (Core Package)
**File**: `packages/core/src/installation/manager.ts`

1. **Create `checkExistingCertificate()` method**
   - Use `certbot certificates` command to list existing certificates
   - Parse output to find certificate for the domain
   - Check certificate validity (expiration date, domain match)
   - Return certificate info if valid, null if not found/invalid

2. **Certificate Check Logic**:
   ```bash
   certbot certificates
   ```
   - Parse output to extract:
     - Certificate name/path
     - Domains covered
     - Expiry date
     - Certificate path
   
3. **Validation Checks**:
   - Domain matches exactly
   - Certificate is not expired (or expires within renewal window)
   - Certificate files exist and are readable
   - Certificate is properly configured in Nginx

#### Phase 2: Update `setupSSL()` Method (Core Package)
**File**: `packages/core/src/installation/manager.ts`

1. **Before running certbot**:
   - Call `checkExistingCertificate(domain)`
   - If valid certificate exists:
     - Log that existing certificate will be reused
     - Verify Nginx is configured to use the certificate
     - Skip certificate creation
     - Return early with success
   
2. **If no certificate exists**:
   - Proceed with existing certbot flow
   - Create new certificate as before

3. **Error Handling**:
   - Handle cases where certbot is not installed
   - Handle cases where certificate check fails
   - Provide clear error messages

#### Phase 3: Certificate Verification
**File**: `packages/core/src/installation/manager.ts`

1. **Verify Nginx Configuration**:
   - Check if Nginx config references the certificate
   - Verify certificate paths in Nginx config match actual certificate files
   - If mismatch, update Nginx config or warn user

2. **Certificate Renewal Check**:
   - If certificate exists but expires soon (< 30 days), warn user
   - Optionally trigger renewal if within renewal window

#### Phase 4: Testing & Edge Cases

1. **Test Scenarios**:
   - [ ] No certificate exists → Create new one
   - [ ] Valid certificate exists → Reuse it
   - [ ] Expired certificate exists → Create new one
   - [ ] Certificate exists but Nginx not configured → Configure Nginx
   - [ ] Certificate exists for different domain → Create new one
   - [ ] Certbot not installed → Handle gracefully
   - [ ] Certificate files missing → Create new one

2. **Edge Cases**:
   - Multiple certificates for same domain (use most recent)
   - Certificate exists but Nginx config is broken
   - Certificate exists but files are corrupted
   - Rate limit already hit (provide helpful error message)

### Implementation Details

#### Certificate Check Command
```bash
certbot certificates
```

Expected output format:
```
Found the following certificates:
  Certificate Name: yuval707stremio.duckdns.org
    Domains: yuval707stremio.duckdns.org
    Expiry Date: 2026-04-20 09:27:05+00:00 (VALID: 89 days)
    Certificate Path: /etc/letsencrypt/live/yuval707stremio.duckdns.org/fullchain.pem
    Private Key Path: /etc/letsencrypt/live/yuval707stremio.duckdns.org/privkey.pem
```

#### Certificate Validation Logic
1. Parse `certbot certificates` output
2. Find certificate matching domain exactly
3. Check expiry date (must be > 30 days remaining)
4. Verify certificate files exist:
   - `/etc/letsencrypt/live/{domain}/fullchain.pem`
   - `/etc/letsencrypt/live/{domain}/privkey.pem`
5. Check Nginx config references these paths

#### Nginx Config Check
After finding existing certificate, verify Nginx is configured:
```bash
grep -r "ssl_certificate" /etc/nginx/sites-enabled/ | grep {domain}
```

If certificate exists but Nginx not configured:
- Option 1: Update Nginx config to use existing certificate
- Option 2: Warn user and continue (they may have custom config)

### Files to Modify

1. **`packages/core/src/installation/manager.ts`**
   - Add `checkExistingCertificate(domain: string): Promise<CertificateInfo | null>`
   - Update `setupSSL()` to check before creating
   - Add certificate validation logic
   - Add Nginx config verification

2. **`packages/core/src/installation/types.ts`** (if exists)
   - Add `CertificateInfo` interface:
     ```typescript
     interface CertificateInfo {
       domain: string;
       expiryDate: Date;
       certificatePath: string;
       privateKeyPath: string;
       isValid: boolean;
     }
     ```

### Error Messages

1. **Certificate exists and valid**:
   ```
   Found existing SSL certificate for {domain} (expires: {date}). Reusing existing certificate.
   ```

2. **Certificate exists but expired**:
   ```
   Found existing SSL certificate for {domain} but it has expired. Creating new certificate.
   ```

3. **Certificate exists but invalid**:
   ```
   Found existing SSL certificate for {domain} but certificate files are missing or invalid. Creating new certificate.
   ```

4. **Rate limit error (with helpful message)**:
   ```
   SSL certificate creation failed due to Let's Encrypt rate limits.
   You have requested too many certificates for this domain recently.
   
   If a certificate already exists, the installation will attempt to reuse it.
   Otherwise, please wait until {retry_after_date} before trying again.
   
   To check existing certificates: sudo certbot certificates
   ```

### Progress Tracking

- [ ] Phase 1: Add certificate check function
- [ ] Phase 2: Update setupSSL to use check
- [ ] Phase 3: Add certificate verification
- [ ] Phase 4: Testing and edge cases
- [ ] Documentation updates

### Notes

- This change only affects the `core` package (installation logic)
- CLI and Electron packages will automatically benefit from this change
- No changes needed in `addon-server` package (it doesn't handle SSL)
- Consider adding a `--force-renew` flag for cases where user wants to force renewal
