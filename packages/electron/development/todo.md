# Stremio Addon Manager - Electron App Todo List

## Phase 1: Foundation ✅ (COMPLETE)

- [x] Setup Electron + React + TypeScript
- [x] Configure Vite for renderer process
- [x] Integrate Ant Design with dark theme
- [x] Setup Jotai for state management
- [x] Create main process with IPC handlers
- [x] Create preload script for secure communication
- [x] Setup routing with react-router-dom
- [x] Create main Layout component
- [x] Create Dashboard page
- [x] Setup SCSS modules for styling
- [x] Create global state atoms

## Phase 2: Installation Wizard ✅ (COMPLETE)

- [x] Create multi-step installation wizard component
  - [x] Step 1: Installation type selection (local/remote)
  - [x] Step 2: SSH configuration (if remote)
  - [x] Step 3: Addon configuration
  - [x] Step 4: Access method selection
  - [x] Step 5: Features selection
  - [x] Step 6: Review and confirm
- [x] Implement real-time progress display
- [x] Add installation status indicators
- [x] Handle installation errors gracefully
- [x] Add installation success screen with addon URL
- [x] Create installation history/log

## Phase 3: Configuration Management ✅ (COMPLETE)

- [x] Create configuration editor interface
- [x] Implement form validation
- [x] Add configuration import/export
- [ ] Create provider management interface
- [ ] Add feature toggles UI
- [ ] Implement configuration backup/restore
- [ ] Add configuration diff viewer
- [ ] Create configuration templates

## Phase 4: Service Control ✅ (COMPLETE)

- [x] Create service control dashboard
- [x] Implement start/stop/restart controls
- [x] Add service status monitoring
- [x] Create auto-start toggle
- [ ] Add service health checks
- [ ] Implement service dependency checks
- [ ] Create service troubleshooting guide
- [ ] Add service restart scheduling

## Phase 5: Log Viewer ✅ (COMPLETE)

- [x] Create log viewer component
- [x] Implement real-time log streaming
- [x] Add log filtering and search
- [x] Create log level filters
- [x] Add log export functionality
- [ ] Implement log pagination
- [x] Add log highlighting
- [ ] Create log stats dashboard

## Phase 6: Connect to Existing Server 🔄 (IN PROGRESS)

### UI Components

- [ ] Create "Connect to Server" dialog/page
- [ ] Add server connection form with validation
  - [ ] Server URL/IP input
  - [ ] Port input
  - [ ] Authentication method selection (password/SSH key)
  - [ ] Test connection button
- [ ] Implement connection status indicator
- [ ] Create server detection wizard
- [ ] Add "Recently Connected" servers list
- [ ] Implement server connection profiles (save multiple servers)

### Core Functionality (requires core package updates)

- [ ] Detect if server is running (local or remote)
- [ ] Verify server is a Stremio addon
- [ ] Get addon manifest from server
- [ ] Check server health and status
- [ ] Retrieve server configuration
- [ ] Test connectivity and authentication
- [ ] Import server logs remotely
- [ ] Detect addon version and features

### Connection Management

- [ ] Save connection profiles to local config
- [ ] Auto-reconnect on app restart
- [ ] Handle connection timeouts
- [ ] Implement connection retry logic
- [ ] Add disconnect functionality
- [ ] Show connection history
- [ ] Implement "Switch Server" functionality

### Server Discovery

- [ ] Auto-detect addon on localhost (check common ports)
- [ ] Scan local network for addon servers
- [ ] Import server from URL/QR code
- [ ] Verify SSL/HTTPS configuration
- [ ] Detect if server is accessible externally

## Phase 7: Advanced Features 📅 (PLANNED)

- [ ] Implement SSH key management
- [ ] Create backup manager
- [ ] Add system monitoring
- [ ] Create notification system
- [ ] Implement update checker
- [ ] Add multi-addon support
- [ ] Create addon templates
- [ ] Add custom themes

## Phase 8: Error Handling & UX 📅 (PLANNED)

- [ ] Implement global error boundary
- [ ] Add user-friendly error messages
- [ ] Create error reporting system
- [ ] Add loading states for all async operations
- [ ] Implement optimistic UI updates
- [ ] Add confirmation dialogs
- [ ] Create toast notifications
- [ ] Add keyboard shortcuts

## Phase 9: Testing & Quality 📅 (PLANNED)

- [ ] Add unit tests for components
- [ ] Add integration tests for IPC
- [ ] Test on Windows
- [ ] Test on macOS
- [ ] Test on Linux
- [ ] Add E2E tests with Playwright
- [ ] Performance testing
- [ ] Accessibility testing

## Phase 10: Documentation 📅 (PLANNED)

- [ ] Create user guide
- [ ] Add inline help/tooltips
- [ ] Create troubleshooting guide
- [ ] Add FAQ section
- [ ] Create video tutorials
- [ ] Document keyboard shortcuts
- [ ] Add API documentation

## Phase 11: Build & Distribution 📅 (PLANNED)

- [ ] Configure electron-builder
- [ ] Create Windows installer (NSIS)
- [ ] Create macOS installer (DMG)
- [ ] Create Linux packages (AppImage, deb)
- [ ] Setup auto-updater
- [ ] Create release pipeline
- [ ] Add code signing
- [ ] Create landing page

## Current Sprint

**Focus:** Phase 6 - Connect to Existing Server

**Completed:**

- ✅ Installation Wizard (Phase 2) - Complete with all steps and progress tracking
- ✅ Configuration Editor (Phase 3) - Complete with form validation and import/export
- ✅ Service Control (Phase 4) - Complete with start/stop/restart and auto-start
- ✅ Log Viewer (Phase 5) - Complete with real-time streaming and filtering

**Active Tasks:**

- Create "Connect to Server" UI components
- Implement server detection in core package
- Add server health check functionality
- Create connection profile management

**Blockers:**

- Need to add server detection methods to core package
- Need to add manifest verification to core package

**Notes:**

- Server connection should support both HTTP and HTTPS
- Must verify the server is actually a Stremio addon (check manifest)
- Should auto-detect local servers on common ports (3000, 7000, 8080)
- Connection profiles should be encrypted/secure for stored credentials
