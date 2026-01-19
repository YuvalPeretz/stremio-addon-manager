# @stremio-addon-manager/electron

Electron desktop application providing a GUI for the Stremio Addon Manager.

## Overview

A modern, cross-platform desktop application built with Electron, React, TypeScript, and Ant Design. Provides an intuitive graphical interface for installing, configuring, and managing private Stremio addons with Real-Debrid integration.

## Architecture

### Main Process (`src/main/`)

- Electron main process handling system-level operations
- IPC handlers for communication with renderer
- Integration with `@stremio-addon-manager/core`

### Renderer Process (`src/renderer/`)

- React application with TypeScript
- Ant Design component library
- Jotai for state management
- React Router for navigation
- SCSS modules for styling

### Bundled Packages

The Electron package includes a bundled version of the CLI package (which transitively includes `core` and `addon-server`) in the `resources/` directory. This hierarchical bundling allows installations to proceed without requiring network access.

#### Resources Structure

```
packages/electron/
├── resources/
│   └── cli/                    # Bundled CLI package
│       ├── dist/
│       ├── package.json
│       ├── bin/
│       └── resources/          # CLI's bundled packages
│           ├── core/            # Bundled core package
│           │   ├── dist/
│           │   └── package.json
│           └── addon-server/   # Bundled addon-server package
│               ├── dist/
│               ├── package.json
│               └── bin/
│                   └── server.js
├── dist/                        # Compiled Electron code
└── package.json
```

#### Build Process

The Electron build process automatically bundles the CLI (which includes core and addon-server):

1. **Build CLI**: Builds the CLI package (which bundles core + addon-server)
2. **Copy CLI**: Copies CLI package to `resources/cli/` directory
3. **Build Electron**: Compiles Electron main and renderer processes

```bash
npm run build
```

This runs:
- `build:packages` - Builds CLI and copies to resources
- `vite build` - Builds Electron application

#### Build Scripts

- `npm run build` - Full build (packages + Electron)
- `npm run build:packages` - Build and copy CLI to resources
- `npm run build:cli` - Build CLI package
- `npm run build:main` - Build main process
- `npm run build:renderer` - Build renderer process
- `npm run dev` - Development mode
- `npm run clean` - Remove dist and resources directories

## Tech Stack

- **Electron**: Desktop application framework
- **React**: UI library
- **TypeScript**: Static typing
- **Ant Design**: Component library (dark theme)
- **Jotai**: State management
- **React Router**: Routing
- **Vite**: Build tool
- **SCSS Modules**: Component styling
- **react-icons**: Icon library

## Project Structure

```
src/
├── main/                       # Electron main process
│   ├── index.ts               # Main entry point
│   └── preload.ts             # Preload script
│
└── renderer/                   # React application
    ├── pages/                  # Page components
    │   ├── Dashboard/
    │   ├── Installation/
    │   ├── Configuration/
    │   ├── ServiceControl/
    │   └── Logs/
    ├── components/             # Reusable components
    │   └── Layout/
    ├── atoms/                  # Jotai state atoms
    │   ├── configAtoms.ts
    │   ├── installationAtoms.ts
    │   └── serviceAtoms.ts
    ├── hooks/                  # Custom React hooks
    ├── utils/                  # Utility functions
    ├── styles/                 # Global styles
    │   ├── variables.scss
    │   └── global.scss
    ├── types/                  # TypeScript types
    ├── App.tsx                # Main App component
    └── main.tsx               # React entry point
```

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Start built application
npm start
```

### Development Scripts

- `npm run dev` - Start development servers (main + renderer)
- `npm run dev:main` - Watch main process
- `npm run dev:renderer` - Start Vite dev server
- `npm run build` - Build both processes (includes bundled packages)
- `npm run build:packages` - Build and copy CLI to resources
- `npm run build:cli` - Build CLI package
- `npm run build:main` - Build main process
- `npm run build:renderer` - Build renderer process
- `npm start` - Start Electron app
- `npm run package` - Package for distribution

## Features

### Current Features

- ✅ Dashboard with service status
- ✅ Local and remote installation support
- ✅ Configuration management
- ✅ Service control (start, stop, restart)
- ✅ Log viewing
- ✅ Real-time updates via IPC

### Planned Features

- 📅 Installation wizard with progress tracking
- 📅 Advanced configuration editor
- 📅 Real-time log streaming
- 📅 System monitoring
- 📅 Backup management
- 📅 Multi-addon support
- 📅 Auto-updater

## Styling Guidelines

### IMPORTANT: NO TAILWINDCSS

This project uses **Ant Design** and **SCSS modules** for styling. TailwindCSS is **explicitly prohibited**.

### Styling Hierarchy

1. **Ant Design ConfigProvider** (First Priority)

   - Global theme configuration
   - Component default props

2. **Component SCSS Modules** (Second Priority)

   - Component-specific styles
   - Use `componentName.module.scss`

3. **Inline Styles** (Last Resort)
   - Only for dynamic values

### Layout Components

- Prefer Ant Design's `<Flex>` component over `<div>`
- Use Ant Design components whenever possible

## State Management

### Jotai Atoms

All global state is managed through Jotai atoms:

- `configAtoms.ts` - Configuration state
- `installationAtoms.ts` - Installation progress
- `serviceAtoms.ts` - Service status and logs

### Local State

Use React's `useState` for component-local state.

## IPC Communication

Communication between main and renderer processes is handled through the preload script:

```typescript
// In renderer
const result = await window.electron.config.load();

// In main (IPC handler)
ipcMain.handle("config:load", async () => {
  // Implementation
});
```

## Building & Distribution

### Package for Distribution

```bash
npm run package
```

This creates installers for:

- Windows: NSIS installer
- macOS: DMG
- Linux: AppImage, deb

### Output Directory

Built packages are located in `release/`

### Bundled Resources

The packaged Electron app includes all bundled resources (`resources/cli/` and its nested packages) automatically. The `electron-builder` configuration includes `resources/**/*` in the packaged application.

### Path Resolution

The Electron app uses bundled packages when available, falling back to GitHub clone if not found. Path resolution checks:

1. `process.resourcesPath + '/cli/resources/addon-server'` (packaged Electron)
2. `resources/cli/resources/addon-server` (development)
3. `resources/addon-server` (legacy fallback)
4. GitHub clone (fallback)

## Contributing

Please follow the guidelines in `development/guidelines.md` for:

- Component structure
- Code organization
- Styling conventions
- State management patterns

## License

MIT
