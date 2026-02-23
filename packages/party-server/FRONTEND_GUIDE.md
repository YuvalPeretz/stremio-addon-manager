# Party Viewing - Frontend Implementation Guide

This guide describes how to build a frontend that consumes the party-server REST API and WebSocket for synchronized party viewing.

---

## Architecture Overview

```
Frontend (Browser)                    Party Server (:7001)
┌──────────────────┐                 ┌──────────────────┐
│  React / Vue /   │  REST API       │  Express HTTP    │
│  Vanilla JS      │ ◄────────────►  │  API endpoints   │
│                  │                 │                  │
│  HTML5 <video>   │  WebSocket      │  WS Sync Engine  │
│  player          │ ◄────────────►  │                  │
│                  │                 └──────────────────┘
│  Video source:   │                          │
│  Real-Debrid CDN │ ◄───── direct stream ───┘
└──────────────────┘
```

The frontend talks to the party server via REST for setup/search and via WebSocket for real-time sync. Video streams come directly from Real-Debrid CDN.

---

## User Flow

### Flow A: Admin (Host)

```
1. Landing Page
   └─► Enter addon URL → POST /api/validate-addon
       └─► Enter password (if required) → POST /api/validate-addon { password }
           └─► See session list + "Create Session" button

2. Create Session
   └─► POST /api/sessions { addonUrl, addonPassword, sessionName }
       └─► Receive: { sessionId, adminToken, wsUrl }
           └─► Connect WebSocket: ws://.../ws/{sessionId}?token={adminToken}&name=HostName

3. Search & Pick Content
   └─► GET /api/sessions/{id}/search?q=Matrix
       └─► Display results
           └─► If series: GET /api/sessions/{id}/episodes/{imdbId}
               └─► Pick season/episode
           └─► POST /api/sessions/{id}/resolve { type, imdbId, ... }
               └─► Receive: { streamUrl, subtitles }

4. Watch & Control
   └─► Load streamUrl into <video> player
   └─► Play/Pause/Seek → Send WS messages
   └─► Share session link with friends
```

### Flow B: Guest (Viewer)

```
1. Join via Link or Session List
   └─► Enter addon password
       └─► POST /api/sessions/{id}/join { addonPassword, displayName }
           └─► Receive: { viewerId, viewerToken, session, wsUrl }

2. Connect WebSocket
   └─► ws://.../ws/{sessionId}?token={viewerToken}&name=GuestName
       └─► Receive SESSION_STATE (includes streamUrl, playback state)

3. Watch (Passive)
   └─► Load streamUrl into <video> player
   └─► Sync playback from WS messages
   └─► Can change subtitles independently
```

---

## REST API Reference

### Base URL

```
http://localhost:7001        (development)
https://yourdomain.com/party (production, behind Nginx)
```

### 1. Validate Addon

```http
POST /api/validate-addon
Content-Type: application/json

{
  "addonUrl": "https://yuval-stremio-addon.duckdns.org",
  "password": "YuvAddon1313"                              // optional
}
```

**Response:**

```json
{
    "valid": true,
    "addonName": "Real-Debrid Passthrough",
    "requiresPassword": true
}
```

### 2. List Sessions

```http
GET /api/sessions
```

**Response:**

```json
{
    "sessions": [
        {
            "id": "uuid-here",
            "name": "Movie Night",
            "state": "lobby",
            "content": null,
            "viewerCount": 2,
            "createdAt": 1708000000000
        }
    ]
}
```

### 3. Create Session (Admin)

```http
POST /api/sessions
Content-Type: application/json

{
  "addonUrl": "https://yuval-stremio-addon.duckdns.org",
  "addonPassword": "YuvAddon1313",
  "sessionName": "Movie Night"
}
```

**Response (201):**

```json
{
    "sessionId": "abc-123-def",
    "adminToken": "secret-admin-token-uuid",
    "joinUrl": "https://yourdomain.com/party/api/sessions/abc-123-def",
    "wsUrl": "wss://yourdomain.com/party/ws/abc-123-def"
}
```

> **IMPORTANT:** Store `adminToken` securely (e.g., in-memory/sessionStorage). It's used for all admin actions.

### 4. Get Session Details

```http
GET /api/sessions/:id?password=YuvAddon1313
```

Or with admin token:

```http
GET /api/sessions/:id
X-Admin-Token: secret-admin-token-uuid
```

**Response:**

```json
{
  "id": "abc-123-def",
  "name": "Movie Night",
  "state": "paused",
  "content": {
    "type": "movie",
    "imdbId": "tt0133093",
    "title": "The Matrix",
    "year": 1999,
    "poster": "https://...",
    "subtitles": [...],
    "duration": 0
  },
  "viewerCount": 3,
  "createdAt": 1708000000000,
  "playback": {
    "state": "paused",
    "currentTimestamp": 1234.5,
    "serverTime": 1708000060000
  },
  "viewers": [
    { "id": "v1", "displayName": "Yuval", "role": "admin", "isConnected": true },
    { "id": "v2", "displayName": "Guest1", "role": "guest", "isConnected": true }
  ]
}
```

### 5. Join Session (Guest)

```http
POST /api/sessions/:id/join
Content-Type: application/json

{
  "addonPassword": "YuvAddon1313",
  "displayName": "My Name"
}
```

**Response:**

```json
{
  "viewerId": "viewer-uuid",
  "viewerToken": "viewer-token-uuid",
  "session": { ... },
  "wsUrl": "wss://yourdomain.com/party/ws/abc-123-def"
}
```

### 6. Search Content

```http
GET /api/sessions/:id/search?q=Matrix&type=movie
```

**Response:**

```json
{
    "results": [
        {
            "id": "tt0133093",
            "type": "movie",
            "name": "The Matrix",
            "year": 1999,
            "poster": "https://...",
            "description": "A computer hacker learns..."
        }
    ]
}
```

### 7. Get Series Episodes

```http
GET /api/sessions/:id/episodes/tt0409591
```

**Response:**

```json
{
    "seasons": [
        {
            "number": 1,
            "episodes": [
                {
                    "number": 1,
                    "title": "Enter: Naruto Uzumaki!",
                    "id": "tt0409591:1:1"
                },
                {
                    "number": 2,
                    "title": "My Name Is Konohamaru!",
                    "id": "tt0409591:1:2"
                }
            ]
        }
    ]
}
```

### 8. Resolve Stream (Admin Only)

```http
POST /api/sessions/:id/resolve
Content-Type: application/json
X-Admin-Token: secret-admin-token-uuid

{
  "type": "movie",
  "imdbId": "tt0133093",
  "title": "The Matrix",
  "year": 1999,
  "poster": "https://..."
}
```

For series:

```json
{
    "type": "series",
    "imdbId": "tt0409591",
    "title": "Naruto",
    "year": 2002,
    "poster": "https://...",
    "season": 2,
    "episode": 37,
    "episodeTitle": "A Mistake from the Past"
}
```

**Response:**

```json
{
    "streamUrl": "https://tlv2-4.download.real-debrid.com/d/XXXXX/movie.mkv",
    "subtitles": [
        { "id": "en", "url": "https://sub.wyzie.ru/...", "lang": "eng" },
        { "id": "he", "url": "https://sub.wyzie.ru/...", "lang": "heb" }
    ],
    "metadata": {
        "title": "The Matrix",
        "year": 1999,
        "poster": "https://..."
    }
}
```

> This also sets the session content and broadcasts `CONTENT_CHANGED` to all connected viewers via WebSocket.

### 9. Get Subtitles

```http
GET /api/sessions/:id/subtitles
```

**Response:**

```json
{
    "subtitles": [
        { "id": "en", "url": "https://...", "lang": "eng" },
        { "id": "he", "url": "https://...", "lang": "heb" }
    ]
}
```

### 10. End Session (Admin Only)

```http
DELETE /api/sessions/:id
X-Admin-Token: secret-admin-token-uuid
```

---

## WebSocket Protocol

### Connecting

```javascript
const ws = new WebSocket(
    `wss://yourdomain.com/party/ws/${sessionId}?token=${token}&name=${displayName}`
);
```

-   **Admin** uses `adminToken` as `token`
-   **Guest** uses `viewerToken` from the join response

### On Connect: `SESSION_STATE`

Upon connection, the server immediately sends the full session state:

```json
{
  "type": "SESSION_STATE",
  "payload": {
    "session": {
      "id": "abc-123",
      "name": "Movie Night",
      "state": "paused",
      "content": { "type": "movie", "title": "The Matrix", "streamUrl": "...", ... },
      "viewerCount": 3
    },
    "playback": {
      "state": "paused",
      "currentTimestamp": 1234.5,
      "serverTime": 1708000000000
    },
    "viewers": [
      { "id": "v1", "displayName": "Yuval", "role": "admin" }
    ],
    "yourViewerId": "v2"
  },
  "timestamp": 1708000000000
}
```

### Client → Server Messages (Admin Only)

#### PLAY

```json
{ "type": "PLAY", "payload": {}, "timestamp": 1708000000000 }
```

#### PAUSE

```json
{ "type": "PAUSE", "payload": {}, "timestamp": 1708000000000 }
```

#### SEEK

```json
{
    "type": "SEEK",
    "payload": { "timestamp": 3600.5 },
    "timestamp": 1708000000000
}
```

#### END_SESSION

```json
{ "type": "END_SESSION", "payload": {}, "timestamp": 1708000000000 }
```

### Client → Server Messages (Any Viewer)

#### SYNC_REQUEST

```json
{ "type": "SYNC_REQUEST", "payload": {}, "timestamp": 1708000000000 }
```

#### CHANGE_SUBTITLE

```json
{
    "type": "CHANGE_SUBTITLE",
    "payload": { "lang": "heb" },
    "timestamp": 1708000000000
}
```

#### CHAT_MESSAGE

```json
{
    "type": "CHAT_MESSAGE",
    "payload": { "message": "Great scene!" },
    "timestamp": 1708000000000
}
```

### Server → Client Messages

#### PLAYBACK_UPDATE

Received when admin plays/pauses/seeks:

```json
{
    "type": "PLAYBACK_UPDATE",
    "payload": {
        "state": "playing",
        "currentTimestamp": 1234.5,
        "serverTime": 1708000060000
    },
    "timestamp": 1708000060000
}
```

#### SYNC_RESPONSE

Periodic (every 5s during playback) and on-demand:

```json
{
    "type": "SYNC_RESPONSE",
    "payload": {
        "state": "playing",
        "currentTimestamp": 1239.5,
        "serverTime": 1708000065000
    },
    "timestamp": 1708000065000
}
```

#### CONTENT_CHANGED

When admin picks new content:

```json
{
  "type": "CONTENT_CHANGED",
  "payload": {
    "content": {
      "type": "movie",
      "title": "The Matrix",
      "imdbId": "tt0133093",
      "year": 1999,
      "poster": "https://...",
      "subtitles": [...],
      "duration": 0
    }
  },
  "timestamp": 1708000000000
}
```

#### VIEWER_JOINED / VIEWER_LEFT

```json
{
    "type": "VIEWER_JOINED",
    "payload": {
        "viewer": { "id": "v3", "displayName": "Bob", "role": "guest" }
    },
    "timestamp": 1708000000000
}
```

#### SESSION_ENDED

```json
{
    "type": "SESSION_ENDED",
    "payload": { "reason": "Host ended the session" },
    "timestamp": 1708000000000
}
```

#### ERROR

```json
{
    "type": "ERROR",
    "payload": {
        "code": "FORBIDDEN",
        "message": "Only the host can control playback"
    },
    "timestamp": 1708000000000
}
```

#### CHAT_BROADCAST

```json
{
    "type": "CHAT_BROADCAST",
    "payload": {
        "senderId": "v1",
        "senderName": "Yuval",
        "message": "Great scene!"
    },
    "timestamp": 1708000000000
}
```

---

## Frontend Sync Logic

### Calculating the Correct Video Time

When you receive a `PLAYBACK_UPDATE` or `SYNC_RESPONSE`:

```javascript
function syncVideoToServer(payload, videoElement) {
    const { state, currentTimestamp, serverTime } = payload;
    const now = Date.now();

    if (state === "playing") {
        // Account for network latency
        const elapsed = (now - serverTime) / 1000;
        const targetTime = currentTimestamp + elapsed;

        // Only seek if drift is significant (> 2 seconds)
        const drift = Math.abs(videoElement.currentTime - targetTime);
        if (drift > 2) {
            videoElement.currentTime = targetTime;
        }

        if (videoElement.paused) {
            videoElement.play();
        }
    } else if (state === "paused") {
        videoElement.currentTime = currentTimestamp;
        if (!videoElement.paused) {
            videoElement.pause();
        }
    }
}
```

### Admin: Sending Playback Commands

```javascript
// Play
ws.send(JSON.stringify({ type: "PLAY", payload: {}, timestamp: Date.now() }));

// Pause
ws.send(JSON.stringify({ type: "PAUSE", payload: {}, timestamp: Date.now() }));

// Seek (e.g., when admin scrubs the timeline)
ws.send(
    JSON.stringify({
        type: "SEEK",
        payload: { timestamp: videoElement.currentTime },
        timestamp: Date.now(),
    })
);
```

### Guest: Disable Playback Controls

```javascript
// For guests: intercept and prevent manual play/pause/seek
if (role === "guest") {
    videoElement.addEventListener("play", (e) => {
        // Only allow if triggered by sync, not by user
        if (!syncTriggered) {
            e.preventDefault();
            videoElement.pause();
        }
    });

    videoElement.addEventListener("seeked", () => {
        // Snap back to server time
        ws.send(
            JSON.stringify({
                type: "SYNC_REQUEST",
                payload: {},
                timestamp: Date.now(),
            })
        );
    });
}
```

### Subtitle Selection (Guest-Independent)

```javascript
// Guests can independently select subtitles
function setSubtitle(subtitleUrl, lang) {
    // Remove existing track
    const existing = videoElement.querySelector("track");
    if (existing) existing.remove();

    // Add new subtitle track
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.src = subtitleUrl;
    track.srclang = lang;
    track.default = true;
    videoElement.appendChild(track);

    // Notify server (for viewer list display, not sync)
    ws.send(
        JSON.stringify({
            type: "CHANGE_SUBTITLE",
            payload: { lang },
            timestamp: Date.now(),
        })
    );
}
```

---

## Recommended Video Player Libraries

-   **video.js** - Full-featured, plugin ecosystem, subtitle support
-   **Plyr** - Beautiful, lightweight, modern
-   **hls.js** - If streams use HLS (most Real-Debrid links are direct MP4/MKV)

For direct Real-Debrid links (MP4/MKV), a plain HTML5 `<video>` element works:

```html
<video id="player" controls>
    <source
        src="https://real-debrid-url.com/movie.mkv"
        type="video/x-matroska"
    />
    <track
        kind="subtitles"
        src="https://subtitle-url.srt"
        srclang="en"
        label="English"
        default
    />
    <track
        kind="subtitles"
        src="https://subtitle-url-he.srt"
        srclang="he"
        label="Hebrew"
    />
</video>
```

---

## Page Structure Suggestion

```
/                          → Landing: Enter addon URL
/sessions                  → Session list + Create button
/session/:id               → Session view (admin or guest)
/session/:id/search        → Content search (admin only)
/session/:id/join          → Join form (enter password + name)
```

---

## Nginx Configuration (Production)

Add these rules to your existing Nginx config on the Raspberry Pi:

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

---

## Quick Start (Development)

```bash
# Start the party server
cd packages/party-server
npm run build
npm start

# Server runs on http://localhost:7001

# Test health
curl http://localhost:7001/health

# Test addon validation
curl -X POST http://localhost:7001/api/validate-addon \
  -H "Content-Type: application/json" \
  -d '{"addonUrl":"https://yuval-stremio-addon.duckdns.org","password":"YuvAddon1313"}'

# Create a session
curl -X POST http://localhost:7001/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"addonUrl":"https://yuval-stremio-addon.duckdns.org","addonPassword":"YuvAddon1313","sessionName":"Test"}'
```

---

## Environment Variables

| Variable                     | Default         | Description                          |
| ---------------------------- | --------------- | ------------------------------------ |
| `PARTY_PORT`                 | `7001`          | Server port                          |
| `MAX_SESSIONS`               | `10`            | Maximum concurrent sessions          |
| `MAX_VIEWERS_PER_SESSION`    | `20`            | Max viewers per session              |
| `SESSION_TIMEOUT_MS`         | `14400000` (4h) | Auto-cleanup timeout                 |
| `SYNC_INTERVAL_MS`           | `5000` (5s)     | Periodic sync broadcast interval     |
| `WS_HEARTBEAT_MS`            | `30000` (30s)   | WebSocket keepalive interval         |
| `ADMIN_RECONNECT_TIMEOUT_MS` | `300000` (5min) | How long to wait for admin reconnect |
| `STREAM_URL_MAX_AGE_MS`      | `7200000` (2h)  | Re-resolve stream after this age     |
