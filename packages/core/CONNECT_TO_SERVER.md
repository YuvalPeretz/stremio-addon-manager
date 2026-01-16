# Connect to Existing Server - Core Package Requirements

## Overview

This document outlines the new functionality needed in the `@stremio-addon-manager/core` package to support connecting to and managing existing Stremio addon servers.

## New Modules Required

### 1. Server Detection Module (`src/server/detector.ts`)

**Purpose:** Detect and verify Stremio addon servers

**Methods:**

```typescript
class ServerDetector {
  // Detect server on specific URL
  static async detectServer(url: string): Promise<ServerInfo | null>;

  // Scan localhost for addon servers on common ports
  static async detectLocalServers(): Promise<ServerInfo[]>;

  // Scan local network for addon servers
  static async scanNetwork(ipRange?: string): Promise<ServerInfo[]>;

  // Verify if a server is a valid Stremio addon
  static async verifyStremioAddon(url: string): Promise<boolean>;

  // Get addon manifest from server
  static async getManifest(url: string): Promise<AddonManifest | null>;
}
```

**ServerInfo Interface:**

```typescript
interface ServerInfo {
  url: string;
  port: number;
  protocol: "http" | "https";
  name?: string;
  version?: string;
  description?: string;
  manifest?: AddonManifest;
  status: "online" | "offline" | "unreachable";
  responseTime?: number;
}
```

**AddonManifest Interface:**

```typescript
interface AddonManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  logo?: string;
  background?: string;
  types: string[];
  catalogs: Catalog[];
  resources: string[];
  idPrefixes?: string[];
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
  };
}
```

### 2. Server Connection Module (`src/server/connection.ts`)

**Purpose:** Manage connections to addon servers

**Methods:**

```typescript
class ServerConnection {
  constructor(config: ServerConnectionConfig);

  // Test connection to server
  async testConnection(): Promise<Result<boolean>>;

  // Connect to server
  async connect(): Promise<Result<void>>;

  // Disconnect from server
  async disconnect(): Promise<void>;

  // Get server health status
  async getHealth(): Promise<ServerHealth>;

  // Get server configuration (if accessible)
  async getConfiguration(): Promise<Result<AddonConfig>>;

  // Get server logs (if accessible)
  async getLogs(lines?: number): Promise<Result<string>>;

  // Check if server requires authentication
  async requiresAuth(): Promise<boolean>;

  // Authenticate with server
  async authenticate(credentials: AuthCredentials): Promise<Result<void>>;
}
```

**ServerConnectionConfig Interface:**

```typescript
interface ServerConnectionConfig {
  url: string;
  auth?: {
    type: "basic" | "token" | "ssh";
    username?: string;
    password?: string;
    token?: string;
    sshKey?: string;
  };
  timeout?: number;
  retries?: number;
}
```

**ServerHealth Interface:**

```typescript
interface ServerHealth {
  status: "healthy" | "degraded" | "unhealthy";
  uptime?: number;
  memoryUsage?: {
    used: number;
    total: number;
  };
  cpuUsage?: number;
  activeConnections?: number;
  errors?: string[];
}
```

### 3. Connection Profile Module (`src/server/profile.ts`)

**Purpose:** Manage saved server connection profiles

**Methods:**

```typescript
class ConnectionProfileManager {
  constructor(configPath?: string);

  // Save a connection profile
  async saveProfile(profile: ConnectionProfile): Promise<Result<void>>;

  // Load all profiles
  async loadProfiles(): Promise<ConnectionProfile[]>;

  // Get a specific profile by ID
  async getProfile(id: string): Promise<ConnectionProfile | null>;

  // Delete a profile
  async deleteProfile(id: string): Promise<Result<void>>;

  // Update a profile
  async updateProfile(id: string, updates: Partial<ConnectionProfile>): Promise<Result<void>>;

  // Get recently used profiles
  async getRecentProfiles(limit?: number): Promise<ConnectionProfile[]>;

  // Test a profile connection
  async testProfile(id: string): Promise<Result<boolean>>;
}
```

**ConnectionProfile Interface:**

```typescript
interface ConnectionProfile {
  id: string;
  name: string;
  url: string;
  type: "local" | "remote";
  auth?: {
    type: "basic" | "token" | "ssh";
    username?: string;
    // Password and keys should be encrypted
    encryptedPassword?: string;
    encryptedToken?: string;
    sshKeyPath?: string;
  };
  lastConnected?: Date;
  createdAt: Date;
  favorite?: boolean;
  tags?: string[];
  metadata?: {
    version?: string;
    addonName?: string;
    description?: string;
  };
}
```

### 4. Server Management Module (`src/server/manager.ts`)

**Purpose:** High-level management of connected server

**Methods:**

```typescript
class ServerManager {
  constructor(connection: ServerConnection);

  // Control service (if server is on same machine or SSH accessible)
  async startService(): Promise<Result<void>>;
  async stopService(): Promise<Result<void>>;
  async restartService(): Promise<Result<void>>;
  async getServiceStatus(): Promise<Result<ServiceInfo>>;

  // Get statistics
  async getStats(): Promise<ServerStats>;

  // Update server configuration (if writable)
  async updateConfig(config: Partial<AddonConfig>): Promise<Result<void>>;

  // Backup server data
  async createBackup(): Promise<Result<string>>;

  // Restore from backup
  async restoreBackup(backupPath: string): Promise<Result<void>>;
}
```

**ServerStats Interface:**

```typescript
interface ServerStats {
  totalRequests: number;
  requestsPerMinute: number;
  averageResponseTime: number;
  activeStreams: number;
  cacheHitRate?: number;
  errors: {
    total: number;
    recent: Array<{
      timestamp: Date;
      message: string;
      level: "warn" | "error";
    }>;
  };
}
```

## Integration Points

### Configuration Manager Updates

Add support for storing connection profiles:

```typescript
interface AddonManagerConfig {
  // ... existing config ...

  connections?: {
    activeProfileId?: string;
    profiles: ConnectionProfile[];
    autoConnect?: boolean;
    autoDetectLocal?: boolean;
  };
}
```

### Logger Updates

Add logging for server connection events:

- Connection attempts
- Connection successes/failures
- Server health checks
- Profile management

## Security Considerations

1. **Credential Storage:** Use system keychain/credential manager for storing passwords
2. **Encryption:** Encrypt sensitive data in connection profiles
3. **SSL/TLS:** Verify SSL certificates when connecting to HTTPS servers
4. **Timeout:** Implement connection timeouts to prevent hanging
5. **Rate Limiting:** Respect server rate limits when polling

## Common Ports to Scan

When auto-detecting local servers:

- 3000 (development default)
- 7000 (common Node.js port)
- 8080 (common HTTP alternate)
- 8000 (common HTTP alternate)
- 3001-3005 (dev server range)

## Manifest Verification

To verify a server is a Stremio addon:

1. Check if `/manifest.json` endpoint exists
2. Validate manifest structure
3. Verify required fields: `id`, `name`, `version`, `resources`, `types`
4. Check if `resources` contains at least one of: `catalog`, `stream`, `meta`

## Error Handling

Common errors to handle:

- Network timeout
- Connection refused
- Invalid manifest
- Authentication failure
- Server unreachable
- SSL certificate invalid
- CORS issues

## Testing Strategy

1. Unit tests for each module
2. Integration tests with mock servers
3. E2E tests with actual addon server
4. Network scanning tests (with permission)
5. Security tests for credential storage
