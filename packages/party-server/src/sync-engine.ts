/**
 * WebSocket Sync Engine
 * Handles real-time playback synchronization between session viewers.
 */

import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HTTPServer } from "node:http";
import type { PartyConfig } from "./config.js";
import type { SessionManager } from "./session-manager.js";
import {
  ClientMessageType,
  ServerMessageType,
  SessionState,
  type WSMessage,
  type WSClient,
  type PlaybackUpdatePayload,
  type SyncResponsePayload,
  type ContentChangedPayload,
  type ViewerEventPayload,
  type ChatPayload,
  type ErrorPayload,
  type SessionPublicInfo,
} from "./types.js";

export class SyncEngine {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WSClient>(); // viewerId → WSClient
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private config: PartyConfig;
  private sessionManager: SessionManager;

  constructor(config: PartyConfig, sessionManager: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager;
  }

  /**
   * Attach WebSocket server to an existing HTTP server
   */
  attach(server: HTTPServer): void {
    this.wss = new WebSocketServer({ noServer: true });

    // Handle upgrade requests
    server.on("upgrade", (request: IncomingMessage, socket, head) => {
      const url = new URL(request.url ?? "", `http://${request.headers.host}`);
      const pathMatch = url.pathname.match(/^\/ws\/(.+)$/);

      if (!pathMatch) {
        socket.destroy();
        return;
      }

      const sessionId = pathMatch[1];
      const token = url.searchParams.get("token");
      const displayName = url.searchParams.get("name") || "Anonymous";

      if (!token) {
        socket.destroy();
        return;
      }

      // Authenticate: either admin token or viewer token
      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        socket.destroy();
        return;
      }

      let viewerId: string | null = null;
      let role: "admin" | "guest" = "guest";

      // Check if this is an admin reconnecting
      if (session.adminToken === token) {
        // Check if admin already has a viewer entry, if so reconnect
        const existingAdmin = Array.from(session.viewers.values()).find((v) => v.role === "admin");
        if (existingAdmin) {
          viewerId = existingAdmin.id;
          existingAdmin.isConnected = true;
          session.adminDisconnectedAt = null;
          role = "admin";
        } else {
          const result = this.sessionManager.addViewer(sessionId, displayName, "admin");
          viewerId = result.viewer.id;
          role = "admin";
        }
      } else {
        // Check if this is a viewer token
        const tokenData = this.sessionManager.resolveViewerToken(token);
        if (tokenData && tokenData.sessionId === sessionId) {
          viewerId = tokenData.viewerId;
          role = "guest";
        } else {
          socket.destroy();
          return;
        }
      }

      if (!viewerId) {
        socket.destroy();
        return;
      }

      const finalViewerId = viewerId;
      const finalRole = role;

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.handleConnection(ws, sessionId, finalViewerId, finalRole);
      });
    });

    this.startHeartbeat();
    this.startPeriodicSync();

    console.log("✓ WebSocket sync engine attached");
  }

  /**
   * Handle a new WebSocket connection
   */
  private handleConnection(
    ws: WebSocket,
    sessionId: string,
    viewerId: string,
    _role: "admin" | "guest"
  ): void {
    const client: WSClient = { ws, sessionId, viewerId, isAlive: true };

    // Remove any existing connection for this viewer (reconnect scenario)
    const existing = this.clients.get(viewerId);
    if (existing) {
      try {
        existing.ws.close();
      } catch {
        // Ignore close errors on old connection
      }
    }

    this.clients.set(viewerId, client);

    // Send initial state
    const session = this.sessionManager.getSession(sessionId);
    if (session) {
      const snapshot = this.sessionManager.getPlaybackSnapshot(sessionId);
      this.sendTo(viewerId, {
        type: ServerMessageType.SESSION_STATE,
        payload: {
          session: this.sessionManager.toPublicInfo(session),
          playback: snapshot,
          viewers: Array.from(session.viewers.values()).map((v) => ({
            id: v.id,
            displayName: v.displayName,
            role: v.role,
          })),
          yourViewerId: viewerId,
        },
        timestamp: Date.now(),
      });

      // Notify others
      const viewer = session.viewers.get(viewerId);
      if (viewer) {
        this.broadcastToOthers(sessionId, viewerId, {
          type: ServerMessageType.VIEWER_JOINED,
          payload: {
            viewer: { id: viewer.id, displayName: viewer.displayName, role: viewer.role },
          } satisfies ViewerEventPayload,
          timestamp: Date.now(),
        });
      }
    }

    // Handle messages
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSMessage;
        this.handleMessage(client, message);
      } catch {
        this.sendTo(viewerId, {
          type: ServerMessageType.ERROR,
          payload: { code: "INVALID_MESSAGE", message: "Invalid message format" } satisfies ErrorPayload,
          timestamp: Date.now(),
        });
      }
    });

    ws.on("pong", () => {
      client.isAlive = true;
    });

    ws.on("close", () => {
      this.handleDisconnect(client);
    });

    ws.on("error", (error) => {
      console.error(`WebSocket error for viewer ${viewerId}:`, error.message);
      this.handleDisconnect(client);
    });

    console.log(`✓ WS connected: viewer ${viewerId} in session ${sessionId}`);
  }

  /**
   * Route and handle an incoming WebSocket message
   */
  private handleMessage(client: WSClient, message: WSMessage): void {
    const { sessionId, viewerId } = client;
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      this.sendTo(viewerId, {
        type: ServerMessageType.ERROR,
        payload: { code: "SESSION_NOT_FOUND", message: "Session no longer exists" } satisfies ErrorPayload,
        timestamp: Date.now(),
      });
      return;
    }

    const viewer = session.viewers.get(viewerId);
    if (!viewer) return;

    const isAdmin = viewer.role === "admin";

    switch (message.type) {
      case ClientMessageType.PLAY: {
        if (!isAdmin) {
          this.sendError(viewerId, "FORBIDDEN", "Only the host can control playback");
          return;
        }
        const snapshot = this.sessionManager.play(sessionId);
        if (snapshot) {
          this.broadcastToSession(sessionId, {
            type: ServerMessageType.PLAYBACK_UPDATE,
            payload: {
              state: snapshot.state,
              currentTimestamp: snapshot.currentTimestamp,
              serverTime: snapshot.serverTime,
            } satisfies PlaybackUpdatePayload,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case ClientMessageType.PAUSE: {
        if (!isAdmin) {
          this.sendError(viewerId, "FORBIDDEN", "Only the host can control playback");
          return;
        }
        const snapshot = this.sessionManager.pausePlayback(sessionId);
        if (snapshot) {
          this.broadcastToSession(sessionId, {
            type: ServerMessageType.PLAYBACK_UPDATE,
            payload: {
              state: snapshot.state,
              currentTimestamp: snapshot.currentTimestamp,
              serverTime: snapshot.serverTime,
            } satisfies PlaybackUpdatePayload,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case ClientMessageType.SEEK: {
        if (!isAdmin) {
          this.sendError(viewerId, "FORBIDDEN", "Only the host can control playback");
          return;
        }
        const seekPayload = message.payload as { timestamp: number };
        const snapshot = this.sessionManager.seek(sessionId, seekPayload.timestamp);
        if (snapshot) {
          this.broadcastToSession(sessionId, {
            type: ServerMessageType.PLAYBACK_UPDATE,
            payload: {
              state: snapshot.state,
              currentTimestamp: snapshot.currentTimestamp,
              serverTime: snapshot.serverTime,
            } satisfies PlaybackUpdatePayload,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case ClientMessageType.END_SESSION: {
        if (!isAdmin) {
          this.sendError(viewerId, "FORBIDDEN", "Only the host can end the session");
          return;
        }
        this.sessionManager.endSession(sessionId);
        this.broadcastToSession(sessionId, {
          type: ServerMessageType.SESSION_ENDED,
          payload: { reason: "Host ended the session" },
          timestamp: Date.now(),
        });
        this.disconnectSession(sessionId);
        break;
      }

      case ClientMessageType.SYNC_REQUEST: {
        const snapshot = this.sessionManager.getPlaybackSnapshot(sessionId);
        if (snapshot) {
          this.sendTo(viewerId, {
            type: ServerMessageType.SYNC_RESPONSE,
            payload: {
              state: snapshot.state,
              currentTimestamp: snapshot.currentTimestamp,
              serverTime: snapshot.serverTime,
            } satisfies SyncResponsePayload,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case ClientMessageType.CHANGE_SUBTITLE: {
        const subPayload = message.payload as { lang: string | null };
        if (viewer) {
          viewer.selectedSubtitleLang = subPayload.lang;
        }
        break;
      }

      case ClientMessageType.CHAT_MESSAGE: {
        const chatPayload = message.payload as { message: string };
        if (!chatPayload.message || chatPayload.message.length > 500) return;

        this.broadcastToSession(sessionId, {
          type: ServerMessageType.CHAT_BROADCAST,
          payload: {
            senderId: viewerId,
            senderName: viewer.displayName,
            message: chatPayload.message,
          } satisfies ChatPayload,
          timestamp: Date.now(),
        });
        break;
      }

      default:
        this.sendError(viewerId, "UNKNOWN_MESSAGE", `Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle viewer disconnection
   */
  private handleDisconnect(client: WSClient): void {
    const { sessionId, viewerId } = client;
    this.clients.delete(viewerId);

    const removedViewer = this.sessionManager.removeViewer(sessionId, viewerId);
    if (removedViewer) {
      this.broadcastToSession(sessionId, {
        type: ServerMessageType.VIEWER_LEFT,
        payload: {
          viewer: {
            id: removedViewer.id,
            displayName: removedViewer.displayName,
            role: removedViewer.role,
          },
        } satisfies ViewerEventPayload,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Broadcasting ──────────────────────────────────────────

  broadcastToSession(sessionId: string, message: WSMessage): void {
    for (const [_viewerId, client] of this.clients) {
      if (client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }

  private broadcastToOthers(sessionId: string, excludeViewerId: string, message: WSMessage): void {
    for (const [viewerId, client] of this.clients) {
      if (
        client.sessionId === sessionId &&
        viewerId !== excludeViewerId &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }

  private sendTo(viewerId: string, message: WSMessage): void {
    const client = this.clients.get(viewerId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  private sendError(viewerId: string, code: string, msg: string): void {
    this.sendTo(viewerId, {
      type: ServerMessageType.ERROR,
      payload: { code, message: msg } satisfies ErrorPayload,
      timestamp: Date.now(),
    });
  }

  /**
   * Notify content changed to all viewers in a session
   */
  notifyContentChanged(sessionId: string, info: SessionPublicInfo): void {
    if (!info.content) return;
    this.broadcastToSession(sessionId, {
      type: ServerMessageType.CONTENT_CHANGED,
      payload: { content: info.content } satisfies ContentChangedPayload,
      timestamp: Date.now(),
    });
  }

  // ─── Session Cleanup ───────────────────────────────────────

  private disconnectSession(sessionId: string): void {
    for (const [viewerId, client] of this.clients) {
      if (client.sessionId === sessionId) {
        try {
          client.ws.close(1000, "Session ended");
        } catch {
          // Ignore
        }
        this.clients.delete(viewerId);
      }
    }
  }

  // ─── Heartbeat & Periodic Sync ─────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [viewerId, client] of this.clients) {
        if (!client.isAlive) {
          console.log(`💔 Heartbeat timeout: viewer ${viewerId}`);
          client.ws.terminate();
          this.handleDisconnect(client);
          continue;
        }
        client.isAlive = false;
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.ping();
        }
      }
    }, this.config.wsHeartbeatMs);
  }

  private startPeriodicSync(): void {
    this.syncInterval = setInterval(() => {
      // Group clients by session, then broadcast sync for playing sessions
      const sessionIds = new Set<string>();
      for (const client of this.clients.values()) {
        sessionIds.add(client.sessionId);
      }

      for (const sessionId of sessionIds) {
        const session = this.sessionManager.getSession(sessionId);
        if (!session || session.state !== SessionState.PLAYING) continue;

        const snapshot = this.sessionManager.getPlaybackSnapshot(sessionId);
        if (!snapshot) continue;

        this.broadcastToSession(sessionId, {
          type: ServerMessageType.SYNC_RESPONSE,
          payload: {
            state: snapshot.state,
            currentTimestamp: snapshot.currentTimestamp,
            serverTime: snapshot.serverTime,
          } satisfies SyncResponsePayload,
          timestamp: Date.now(),
        });
      }
    }, this.config.syncIntervalMs);
  }

  // ─── Shutdown ──────────────────────────────────────────────

  shutdown(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.syncInterval) clearInterval(this.syncInterval);

    for (const client of this.clients.values()) {
      try {
        client.ws.close(1001, "Server shutting down");
      } catch {
        // Ignore
      }
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }

    console.log("✓ Sync engine shut down");
  }
}
