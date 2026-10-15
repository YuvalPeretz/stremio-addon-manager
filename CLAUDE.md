# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Building

```bash
# Build all packages (respects dependency order via Turbo)
npm run build

# Build only the core package (other packages depend on this)
npm run build:core

# Build a specific package
npx lerna run build --scope=@stremio-addon-manager/cli

# Development watch mode (all packages in parallel)
npm run dev

# Development for a specific package
npm run dev:cli
npm run dev:electron
```

### Linting & Type Checking

```bash
npm run lint          # ESLint across all packages
npm run type-check    # TypeScript type checking across all packages
```

### Testing

```bash
npm run test          # Run tests across all packages (Jest)
```

### Electron App

```bash
# Development (starts main + renderer concurrently)
cd packages/electron && npm run dev

# Package for current platform
cd packages/electron && npm run package

# Package for Windows specifically
cd packages/electron && npm run package:win
```

### Addon Server

```bash
cd packages/addon-server && npm run start   # Run the built server
cd packages/addon-server && npm run dev     # Watch mode
```

## Architecture Overview

This is a **Lerna + npm workspaces monorepo** using **Turbo** for build orchestration. The project is a system for installing, managing, and running private Stremio addons with Real-Debrid integration.

### Package Dependency Graph

```
electron ──────────────────────────────────┐
  └─ bundles CLI (which bundles core + addon-server) │
                                            │
cli ────────────────────────────────────────┤
  ├─ depends on: core                       │
  └─ bundles core + addon-server in resources/│
                                            │
core ◄───────────────────────────────────── All packages depend on this
  └─ shared utilities, no monorepo deps     │
                                            │
addon-server ──────────────────────────────┘
  └─ standalone Express server deployed to target machine
```

### Package Roles

**`packages/core`** — Shared library with no monorepo dependencies. Contains:
- `os/` — Local and remote OS/architecture detection
- `ssh/` — SSHManager for executing remote commands and file transfers
- `service/` — Cross-platform service management (systemd / launchd / NSSM)
- `config/` — YAML-based configuration, AddonRegistry (multi-addon support), EnvVarManager
- `installation/` — InstallationManager (17-step automated deployment), UpdateManager with rollback
- `server/` — ServerDetector, ServerConnection, ConnectionProfileManager

**`packages/cli`** — Commander.js CLI with ~16 commands (`install`, `status`, `start`, `stop`, `logs`, `env`, `update`, `rollback`, `local-library`, etc.). Bundles core + addon-server into `resources/` for offline deployment to target machines.

**`packages/addon-server`** — Express.js server deployed to the target machine (Raspberry Pi / Linux). Implements the Stremio addon protocol via `stremio-addon-sdk`, integrates with Real-Debrid API, has a three-tier caching system, WebSocket support, and a management UI.

**`packages/electron`** — Desktop GUI (Electron + React + Jotai + Ant Design). The main process exposes 50+ IPC handlers; the preload script (`src/preload/`) bridges renderer ↔ main safely. The renderer uses Jotai atoms for global state and SCSS modules for component styling. Bundles the CLI package (which itself bundles core + addon-server).

**`packages/party-server`** — In-development Express + WebSocket server for synchronized viewing sessions.

### Key Architectural Patterns

**Multi-Addon Support**: `AddonRegistry` tracks multiple installed addons. Each has a unique service name (`stremio-addon-{id}.service`), its own port, domain, and config file. A "default" addon can be selected.

**Bundled Resources**: The CLI's `build:packages` script copies built core + addon-server into `resources/`. Electron's build does the same for the CLI. This allows the electron/CLI app to deploy the server to remote machines without requiring internet access on the target.

**IPC Architecture (Electron)**: All system operations happen in the main process. The renderer communicates via typed IPC handlers defined in `src/main/index.ts`. SSH connection resolution is done before dispatching remote commands, using the connection profile from config. Long operations use progress callbacks streamed back to the renderer.

**Configuration**: YAML files at `~/.stremio-addon-manager/config.yaml`. Supports migration from legacy single-addon format to the multi-addon registry format. `EnvVarManager` provides metadata (type, description, secret flag, defaults) for addon environment variables.

**Service Management**: `ServiceManager` generates and deploys systemd (Linux) / launchd (macOS) / NSSM (Windows) service files with environment variables baked in. Supports enable/disable auto-start and syncing env changes back to the service file.

**Real-Debrid Integration**: Handled entirely in addon-server. Three-tier caching: metadata cache, torrent search cache, stream cache. Rate limiting applied to RD API calls.

### Real-Debrid Single-IP Invariant (critical)

Real-Debrid monitors the public IPs that use an account's API token. If it sees requests coming from more than one IP, it treats it as token sharing and suspends the account. **This system is specifically architected to prevent that.**

The rule: **the RD API token must only ever be used from the addon server's single IP.** No other process, machine, or third-party service may make RD API calls on the user's behalf.

How this is enforced in the code:

- **`searchTorrents()` deliberately has no RD token parameter.** Torrentio and all other torrent-discovery sources are queried without any authentication. See [torrent-search.ts](packages/addon-server/src/torrent-search.ts) — the function signature intentionally excludes a token argument and the file-level comment explains why.
- **Torrentio is called without the RD token.** Even though Torrentio supports a `RealDebrid={token}` config prefix that would return pre-unrestricted URLs, it is never used here. Torrentio's servers are a different IP than the Pi, so passing the token there would trigger an IP violation.
- **All RD API calls happen in one place only:** `processRealDebridStream()` in [stream-handler.ts](packages/addon-server/src/stream-handler.ts) — `addMagnet`, `selectFiles`, `getTorrentInfo`, `unrestrictLink`, and `getCachedAvailability` all go through the `RealDebridClient` instance running on the addon server.
- **The Stremio client never contacts RD directly.** The server returns fully unrestricted `download` URLs from `rdClient.unrestrictLink()`. The client just plays the URL; it never needs or receives the RD token.

**When adding any new feature that touches torrent discovery or stream resolution:**
- Never add the RD token as a parameter to any torrent-search or metadata-lookup function.
- Never call any RD API endpoint from outside the addon-server process.
- Never pass the RD token to a third-party service URL, even as a query param or header.

## TypeScript & ESLint Rules

- **Strict TypeScript** — explicit return types required on all functions, no implicit `any`
- **No `any`** — `@typescript-eslint/no-explicit-any` is enforced
- **No floating promises** — all async calls must be awaited or explicitly handled
- Target: **ES2022**, JSX: `react-jsx`
- Each package has its own `tsconfig.json` extending the root; composite builds with incremental compilation

## Configuration Reference

The addon server is configured via environment variables. The canonical list with types, defaults, and descriptions is in `packages/core/src/config/env-manager.ts` (`ENV_VAR_DEFINITIONS`). Key variables include `PORT`, `REAL_DEBRID_API_KEY`, `CACHE_TTL_*` settings, and domain/SSL configuration.
