# @stremio-addon-manager/cli

Command-line interface for the Stremio Addon Manager.

## Overview

A powerful CLI tool for installing, configuring, and managing private Stremio addons with Real-Debrid integration. Supports both local and remote (SSH) installations on Linux systems.

## Features

- ✅ Local and remote (SSH) addon installation
- ✅ Environment variable management
- ✅ Service control (start, stop, restart, status)
- ✅ Configuration management
- ✅ Log viewing
- ✅ Bundled packages for offline installation

## Bundled Packages

The CLI package includes bundled versions of `core` and `addon-server` packages in the `resources/` directory. This allows installations to proceed without requiring network access to clone repositories.

### Resources Structure

```
packages/cli/
├── resources/
│   ├── core/              # Bundled core package
│   │   ├── dist/
│   │   ├── package.json
│   │   └── README.md
│   └── addon-server/      # Bundled addon-server package
│       ├── dist/
│       ├── package.json
│       ├── README.md
│       └── bin/
│           └── server.js
├── dist/                  # Compiled CLI code
├── bin/                   # CLI executable
└── package.json
```

### Build Process

The CLI build process automatically bundles `core` and `addon-server`:

1. **Build dependencies**: Builds `core` and `addon-server` packages
2. **Copy packages**: Copies built packages to `resources/` directory
3. **Build CLI**: Compiles TypeScript to JavaScript

```bash
npm run build
```

This runs:
- `build:packages` - Builds and copies core + addon-server
- `tsc --build` - Compiles CLI TypeScript

### Build Scripts

- `npm run build` - Full build (packages + CLI)
- `npm run build:packages` - Build and copy bundled packages
- `npm run build:core` - Build core package
- `npm run build:addon-server` - Build addon-server package
- `npm run dev` - Watch mode for development
- `npm run clean` - Remove dist and resources directories

## Installation

```bash
npm install
npm run build
```

## Usage

### Install an Addon

```bash
# Local installation
npm run install

# Remote installation (SSH)
npm run install -- --remote --host <host> --port <port> --username <user>
```

### Manage Environment Variables

```bash
# List all environment variables
npm run env:list

# Get a specific variable
npm run env:get -- <variable-name>

# Set a variable
npm run env:set -- <variable-name> <value>

# Reset to default
npm run env:reset -- <variable-name>
```

### Service Control

```bash
# Start service
npm run service:start -- <addon-name>

# Stop service
npm run service:stop -- <addon-name>

# Restart service
npm run service:restart -- <addon-name>

# Check status
npm run service:status -- <addon-name>
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- TypeScript

### Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run in development mode
npm run dev
```

### Project Structure

```
src/
├── commands/              # CLI commands
│   ├── install.ts        # Installation command
│   ├── env.ts            # Environment variable management
│   ├── config.ts         # Configuration management
│   ├── list.ts           # List addons
│   └── logs.ts           # View logs
├── utils/                 # Utility functions
└── index.ts              # Main entry point
```

## Path Resolution

The CLI uses bundled packages when available, falling back to GitHub clone if not found. Path resolution checks:

1. `resources/addon-server` (CLI bundled)
2. `../cli/resources/addon-server` (monorepo structure)
3. `packages/addon-server` (development)
4. GitHub clone (fallback)

## Contributing

Please follow the guidelines in `development/guidelines.md` for:
- Code organization
- Command structure
- Error handling
- Logging conventions

## License

MIT
