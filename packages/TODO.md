# Party Viewing Feature - Comprehensive TODO

## Overview

A synchronized "Party Viewing" feature that allows an admin to create watch sessions where multiple users watch the same movie/episode in sync. The admin controls playback; guests watch passively but can independently choose subtitles.

### Architecture Summary

```
                 ┌─────────────────────────────┐
                 │     Raspberry Pi Server      │
                 │                              │
                 │  ┌────────────────────────┐  │
                 │  │   Existing Addon Server │  │
                 │  │   (Express on :7000)    │  │
                 │  │   - Stream resolution   │  │
                 │  │   - Subtitle fetch      │  │
                 │  │   - Cinemeta metadata   │  │
                 │  └────────────────────────┘  │
                 │                              │
                 │  ┌────────────────────────┐  │
                 │  │   NEW: Party Server     │  │
                 │  │   (Express+WS on :7001) │  │
                 │  │   - Session CRUD        │  │
                 │  │   - WebSocket sync      │  │
                 │  │   - Auth validation     │  │
                 │  │   - Search/resolve API  │  │
                 │  │   - Subtitle API        │  │
                 │  └────────────────────────┘  │
                 └─────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
         │ Admin   │    │ Guest 1 │    │ Guest 2 │
         │ Browser │    │ Browser │    │ Browser │
         │ (host)  │    │ (viewer)│    │ (viewer)│
         └─────────┘    └─────────┘    └─────────┘
              │               │               │
              └───────────────┼───────────────┘
                              │
                    Real-Debrid CDN
                   (direct video stream)
```

**Key principle:** The Pi handles only lightweight sync messages (JSON over WebSocket). All video streaming goes directly from Real-Debrid CDN to each user's browser.

---

## Phase 1: New Package Setup

### 1.1 Create `packages/party-server` package
- [ ] Initialize package with `package.json` (name: `@stremio-addon-manager/party-server`)
- [ ] Set up TypeScript config (`tsconfig.json`) extending root config
- [ ] Add dependencies:
  - `express` - HTTP server
  - `ws` - WebSocket server (lightweight, no socket.io overhead)
  - `uuid` - Session/user ID generation
  - `cors` - CORS headers
  - `axios` - HTTP client (for calling addon-server internally)
- [ ] Create `src/` directory structure:
  ```
  src/
  ├── index.ts              # Entry point
  ├── config.ts             # Party server configuration
  ├── server.ts             # Express + WebSocket server setup
  ├── types.ts              # All TypeScript interfaces
  ├── session-manager.ts    # Session CRUD operations
  ├── sync-engine.ts        # WebSocket sync logic
  ├── auth.ts               # Addon authentication validation
  ├── search.ts             # Content search (movies/series)
  └── subtitle-proxy.ts     # Subtitle fetching for party sessions
  ```
- [ ] Add build/dev scripts to `package.json`
- [ ] Register in root `package.json` workspaces

---

## Phase 2: Type Definitions (`types.ts`)

### 2.1 Session Types
- [ ] `Session` interface:
  ```
  - id: string (UUID)
  - name: string (display name chosen by admin)
  - addonUrl: string (the addon base URL)
  - addonPassword: string (for authenticating with addon)
  - adminId: string (the admin's connection ID)
  - createdAt: Date
  - state: SessionState
  - content: SessionContent | null
  - viewers: Map<string, Viewer>
  ```
- [ ] `SessionState` enum: `LOBBY`, `PLAYING`, `PAUSED`, `ENDED`
- [ ] `SessionContent` interface:
  ```
  - type: "movie" | "series"
  - imdbId: string
  - title: string
  - year: number
  - poster: string
  - streamUrl: string (Real-Debrid resolved URL)
  - subtitles: Subtitle[]
  - duration: number (in seconds, if available from metadata)
  - season?: number
  - episode?: number
  - episodeTitle?: string
  ```
- [ ] `Viewer` interface:
  ```
  - id: string
  - displayName: string
  - role: "admin" | "guest"
  - connectedAt: Date
  - isConnected: boolean
  - selectedSubtitleLang: string | null
  ```

### 2.2 WebSocket Message Types
- [ ] `WS_Message` base: `{ type: string, payload: unknown, timestamp: number }`
- [ ] **Client → Server messages:**
  - `JOIN_SESSION` - Guest joins (includes session ID + addon password)
  - `PLAY` - Admin starts/resumes playback
  - `PAUSE` - Admin pauses playback
  - `SEEK` - Admin seeks to timestamp
  - `SET_CONTENT` - Admin picks movie/episode
  - `END_SESSION` - Admin ends the session
  - `SYNC_REQUEST` - Guest requests current timestamp
  - `CHANGE_SUBTITLE` - Guest changes their subtitle language
  - `CHAT_MESSAGE` - (optional) Text chat
- [ ] **Server → Client messages:**
  - `SESSION_STATE` - Full session state snapshot
  - `PLAYBACK_UPDATE` - Play/pause/seek notification
  - `CONTENT_CHANGED` - New content selected
  - `VIEWER_JOINED` - Someone joined
  - `VIEWER_LEFT` - Someone disconnected
  - `SESSION_ENDED` - Session terminated by admin
  - `SYNC_RESPONSE` - Current timestamp reply
  - `ERROR` - Error message
  - `CHAT_BROADCAST` - (optional) Chat message to all

### 2.3 API Request/Response Types
- [ ] `CreateSessionRequest`: `{ addonUrl, addonPassword, sessionName }`
- [ ] `CreateSessionResponse`: `{ sessionId, adminToken, joinUrl }`
- [ ] `JoinSessionRequest`: `{ sessionId, addonPassword, displayName }`
- [ ] `JoinSessionResponse`: `{ viewerId, session: SessionPublicInfo }`
- [ ] `SearchRequest`: `{ query, type? }`
- [ ] `SearchResult`: `{ id, type, name, year, poster, description }`
- [ ] `ResolveStreamRequest`: `{ sessionId, type, imdbId, season?, episode? }`
- [ ] `ResolveStreamResponse`: `{ streamUrl, subtitles[], metadata }`
- [ ] `SessionPublicInfo` (sanitized, no password): `{ id, name, state, content, viewerCount, createdAt }`

---

## Phase 3: Configuration (`config.ts`)

- [ ] `PARTY_PORT`: Default `7001` (env: `PARTY_PORT`)
- [ ] `MAX_SESSIONS`: Default `10` (env: `MAX_SESSIONS`) - Pi resource limit
- [ ] `MAX_VIEWERS_PER_SESSION`: Default `20` (env: `MAX_VIEWERS_PER_SESSION`)
- [ ] `SESSION_TIMEOUT_MS`: Default `4 * 60 * 60 * 1000` (4 hours, auto-cleanup)
- [ ] `SYNC_INTERVAL_MS`: Default `5000` (5s periodic sync broadcast)
- [ ] `WS_HEARTBEAT_MS`: Default `30000` (30s ping/pong keepalive)
- [ ] `ADDON_INTERNAL_URL`: Default `http://localhost:7000` (internal addon server address)

---

## Phase 4: Authentication (`auth.ts`)

### 4.1 Addon Validation
- [ ] `validateAddonUrl(url: string)` - Verify addon URL is reachable
  - Fetch `{addonUrl}/manifest.json` or `{addonUrl}/{password}/manifest.json`
  - Parse manifest to confirm it's a valid Stremio addon
  - Return addon name, version, supported types
- [ ] `validateAddonPassword(addonUrl: string, password: string)` - Test auth
  - Try fetching `{addonUrl}/{password}/manifest.json`
  - Return true/false based on response status (200 = valid, 401 = invalid)

### 4.2 Session Authentication
- [ ] Admin gets a unique `adminToken` (UUID) on session creation
  - All admin-only actions require this token
  - Passed as header or in WebSocket auth message
- [ ] Guests authenticate by providing the addon password
  - Password is verified against the addon server
  - On success, guest receives a `viewerToken` for the WebSocket connection

---

## Phase 5: Session Manager (`session-manager.ts`)

### 5.1 Session Storage
- [ ] In-memory `Map<string, Session>` (sufficient for Pi, no DB needed)
- [ ] Session auto-expiry timer (clean up after `SESSION_TIMEOUT_MS`)
- [ ] Max session count enforcement

### 5.2 Session CRUD
- [ ] `createSession(addonUrl, addonPassword, sessionName)` → Session
  - Generate UUID for session ID
  - Generate UUID for admin token
  - Validate addon URL + password
  - Create session in LOBBY state
- [ ] `getSession(sessionId)` → Session | null
- [ ] `listSessions()` → SessionPublicInfo[] (sanitized, no passwords)
- [ ] `endSession(sessionId, adminToken)` → void
  - Notify all connected viewers via WebSocket
  - Clean up resources
- [ ] `removeSession(sessionId)` → void (internal cleanup)

### 5.3 Viewer Management
- [ ] `addViewer(sessionId, displayName, role)` → Viewer
- [ ] `removeViewer(sessionId, viewerId)` → void
- [ ] `getViewers(sessionId)` → Viewer[]

### 5.4 Content Management
- [ ] `setContent(sessionId, content: SessionContent)` → void
  - Updates session content
  - Sets state to PAUSED (ready to play)
  - Broadcasts `CONTENT_CHANGED` to all viewers
- [ ] `clearContent(sessionId)` → void
  - Removes current content
  - Sets state back to LOBBY

---

## Phase 6: Content Search & Resolution (`search.ts`)

### 6.1 Cinemeta Search
- [ ] `searchContent(query: string, type?: "movie" | "series")` → SearchResult[]
  - Use Cinemeta search API: `https://v3-cinemeta.strem.io/catalog/{type}/top/search={query}.json`
  - Search both movies and series if type not specified
  - Return top 20 results with: id, name, year, poster, description, type
  - Cache results for 1 hour

### 6.2 Series Episode Listing
- [ ] `getSeriesEpisodes(imdbId: string)` → Season[]
  - Fetch from Cinemeta: `https://v3-cinemeta.strem.io/meta/series/{imdbId}.json`
  - Parse seasons and episodes from metadata
  - Return structured season/episode data with titles
  - Cache for 24 hours

### 6.3 Stream Resolution
- [ ] `resolveStream(addonUrl, password, type, imdbId, season?, episode?)` → ResolveStreamResponse
  - Call the existing addon server: `{addonUrl}/{password}/stream/{type}/{id}.json`
  - Pick the best stream from the response (first available, highest quality)
  - Also fetch subtitles via addon's existing subtitle support
  - Return direct Real-Debrid URL + subtitle list + metadata

### 6.4 Subtitle Fetching
- [ ] `fetchSubtitlesForSession(type, imdbId, season?, episode?)` → Subtitle[]
  - Reuse the existing `subtitle-fetcher.ts` logic from addon-server
  - OR call the addon server and extract subtitles from stream response
  - Return all available subtitle languages with download URLs
  - Prioritize English and Hebrew at top of list

---

## Phase 7: WebSocket Sync Engine (`sync-engine.ts`)

### 7.1 WebSocket Server Setup
- [ ] Attach `ws` WebSocket server to the Express HTTP server
- [ ] Connection authentication:
  - On connect, require `sessionId` + `token` (admin or viewer token)
  - Reject unauthorized connections
- [ ] Heartbeat mechanism:
  - Server sends `ping` every `WS_HEARTBEAT_MS`
  - If client doesn't respond with `pong`, mark as disconnected
  - Broadcast `VIEWER_LEFT` to others

### 7.2 Playback Sync (Core Logic)
- [ ] **Server-side playback clock:**
  - Track `currentTimestamp` (seconds into the video)
  - Track `playbackStartedAt` (real wall-clock time when play was pressed)
  - Track `state` (playing/paused)
  - On `PLAY`: record `playbackStartedAt = Date.now()`, broadcast to all
  - On `PAUSE`: calculate `currentTimestamp += (Date.now() - playbackStartedAt) / 1000`, broadcast
  - On `SEEK`: set `currentTimestamp = seekTarget`, broadcast to all
- [ ] **Sync calculation:**
  - When guest sends `SYNC_REQUEST`, respond with:
    ```
    {
      state: "playing" | "paused",
      currentTimestamp: <computed>,
      serverTime: Date.now()
    }
    ```
  - Guest calculates: `videoElement.currentTime = currentTimestamp + (localNow - serverTime) / 1000`
- [ ] **Periodic sync broadcast:**
  - Every `SYNC_INTERVAL_MS` (5s), broadcast current timestamp to all viewers
  - Viewers auto-correct if drift > 2 seconds

### 7.3 Message Routing
- [ ] Route incoming WebSocket messages by `type` field
- [ ] Admin-only messages (`PLAY`, `PAUSE`, `SEEK`, `SET_CONTENT`, `END_SESSION`):
  - Verify sender is the session admin
  - Reject with `ERROR` message if not admin
- [ ] Guest messages (`SYNC_REQUEST`, `CHANGE_SUBTITLE`, `JOIN_SESSION`):
  - Any authenticated viewer can send these
- [ ] Broadcast helpers:
  - `broadcastToSession(sessionId, message)` - Send to ALL viewers in session
  - `broadcastToOthers(sessionId, senderId, message)` - Send to all except sender
  - `sendToViewer(viewerId, message)` - Send to specific viewer

---

## Phase 8: Express HTTP Server (`server.ts`)

### 8.1 REST API Endpoints

#### Public Endpoints (no auth)
- [ ] `GET /health` - Party server health check
- [ ] `GET /api/sessions` - List active sessions (public info only)

#### Addon Validation
- [ ] `POST /api/validate-addon` - Validate addon URL + password
  - Body: `{ addonUrl, password? }`
  - Returns: `{ valid, addonName, requiresPassword }`

#### Session Management (admin auth required for mutations)
- [ ] `POST /api/sessions` - Create a new session
  - Body: `{ addonUrl, addonPassword, sessionName }`
  - Returns: `{ sessionId, adminToken, joinUrl, wsUrl }`
- [ ] `GET /api/sessions/:id` - Get session details
  - Query: `?password=xxx` (addon password required)
  - Returns: `SessionPublicInfo` with content details
- [ ] `DELETE /api/sessions/:id` - End/destroy a session
  - Header: `X-Admin-Token: <adminToken>`

#### Content Search & Resolution (requires addon password)
- [ ] `GET /api/sessions/:id/search?q=<query>&type=<movie|series>`
  - Search movies/series via Cinemeta
  - Returns: `SearchResult[]`
- [ ] `GET /api/sessions/:id/episodes/:imdbId`
  - Get season/episode list for a series
  - Returns: `{ seasons: [{ number, episodes: [{ number, title, id }] }] }`
- [ ] `POST /api/sessions/:id/resolve`
  - Body: `{ type, imdbId, season?, episode? }`
  - Header: `X-Admin-Token: <adminToken>`
  - Resolves a Real-Debrid stream + fetches subtitles
  - Returns: `{ streamUrl, subtitles, metadata }`
  - Sets the session content and broadcasts to all viewers

#### Subtitle Endpoint
- [ ] `GET /api/sessions/:id/subtitles`
  - Returns all available subtitles for current session content
  - Returns: `Subtitle[]`

### 8.2 WebSocket Upgrade
- [ ] Handle WebSocket upgrade on `/ws/:sessionId`
- [ ] Query params: `?token=<adminToken|viewerToken>&name=<displayName>`
- [ ] On connection: send `SESSION_STATE` with full current state

### 8.3 CORS Configuration
- [ ] Allow all origins (same as addon server)
- [ ] Allow WebSocket upgrade from any origin

---

## Phase 9: Server Entry Point (`index.ts`)

- [ ] Load configuration
- [ ] Initialize SessionManager
- [ ] Initialize SyncEngine
- [ ] Create Express server with all routes
- [ ] Attach WebSocket server
- [ ] Start listening on `PARTY_PORT`
- [ ] Set up session cleanup interval (check for expired sessions every 5 minutes)
- [ ] Graceful shutdown handler (notify all viewers, close all WebSocket connections)
- [ ] Uncaught exception / unhandled rejection handlers (same pattern as addon server)

---

## Phase 10: Nginx Configuration

- [ ] Add Nginx reverse proxy rules for the party server:
  ```nginx
  # Party viewing HTTP API
  location /party/ {
      proxy_pass http://localhost:7001/;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Party viewing WebSocket
  location /party/ws/ {
      proxy_pass http://localhost:7001/ws/;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_read_timeout 86400;
  }
  ```
- [ ] Ensure SSL/HTTPS works for WebSocket (`wss://`)

---

## Phase 11: Systemd Service

- [ ] Create systemd service file for party-server:
  ```ini
  [Unit]
  Description=Stremio Party Viewing Server
  After=network.target stremio-addon.service
  Wants=stremio-addon.service

  [Service]
  Type=simple
  User=stremio
  WorkingDirectory=/opt/stremio-addon/packages/party-server
  ExecStart=/usr/bin/node dist/index.js
  Restart=always
  RestartSec=5
  Environment=NODE_ENV=production
  Environment=PARTY_PORT=7001

  [Install]
  WantedBy=multi-user.target
  ```
- [ ] Enable and start service
- [ ] Add to installation manager for deployment from Electron UI

---

## Phase 12: Edge Cases & Error Handling

### 12.1 Admin Disconnect
- [ ] If admin disconnects, pause playback immediately
- [ ] Keep session alive for 5 minutes waiting for admin reconnect
- [ ] If admin doesn't return within 5 minutes, end session and notify guests
- [ ] Admin can reconnect using the same `adminToken`

### 12.2 Stream URL Expiration
- [ ] Real-Debrid links expire after a few hours
- [ ] Track link generation time
- [ ] Before playback: if link is > 2 hours old, re-resolve automatically
- [ ] If re-resolve fails during playback, notify admin with error

### 12.3 Guest Sync Recovery
- [ ] On reconnect, guest immediately receives `SESSION_STATE` with current timestamp
- [ ] If guest's video buffers and falls behind, auto-seek to catch up on next sync
- [ ] If drift > 5 seconds, force-seek to current timestamp

### 12.4 Resource Limits
- [ ] Max sessions enforcement (reject new sessions with 503)
- [ ] Max viewers per session (reject new joins with 403)
- [ ] Auto-cleanup of stale sessions
- [ ] Memory monitoring (log warnings if heap > 100MB)

---

## Phase 13: Testing

- [ ] Unit tests for SessionManager (create, join, end, content management)
- [ ] Unit tests for SyncEngine (playback clock calculations, drift correction)
- [ ] Unit tests for auth validation
- [ ] Integration tests for REST API endpoints
- [ ] WebSocket integration tests (connect, sync, disconnect)
- [ ] Load test: 10 concurrent sessions with 5 viewers each on Raspberry Pi
- [ ] Manual test: end-to-end party viewing flow across multiple devices

---

## Summary of Changes to Existing Packages

### `packages/addon-server`
- **No changes required.** The party server calls the addon server's existing HTTP API (`/stream/`, `/manifest.json`) externally. The subtitle-fetcher module already exists and serves subtitles through the stream response.

### `packages/core` (if applicable)
- [ ] Add party-server to installation manager for remote deployment
- [ ] Add party-server systemd service template

### `packages/electron` (future, NOT in scope now)
- Party session management UI could be added later
- Not required for the web-based party viewing experience

---

## File Checklist (New Files to Create)

```
packages/party-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── server.ts
│   ├── types.ts
│   ├── session-manager.ts
│   ├── sync-engine.ts
│   ├── auth.ts
│   ├── search.ts
│   └── subtitle-proxy.ts
```

---

## Estimated Effort

| Phase | Effort | Priority |
|-------|--------|----------|
| Phase 1: Package setup | Small | High |
| Phase 2: Types | Small | High |
| Phase 3: Config | Small | High |
| Phase 4: Auth | Medium | High |
| Phase 5: Session Manager | Medium | High |
| Phase 6: Search & Resolve | Medium | High |
| Phase 7: WebSocket Sync | Large | High |
| Phase 8: HTTP Server | Medium | High |
| Phase 9: Entry Point | Small | High |
| Phase 10: Nginx | Small | Medium |
| Phase 11: Systemd | Small | Medium |
| Phase 12: Edge Cases | Medium | Medium |
| Phase 13: Testing | Large | Low (initially) |
