/**
 * Session Manager - CRUD operations for party viewing sessions
 */

import { v4 as uuidv4 } from "uuid";
import type { PartyConfig } from "./config.js";
import {
  SessionState,
  type Session,
  type SessionPublicInfo,
  type SessionContentPublic,
  type SessionContent,
  type Viewer,
} from "./types.js";

export class SessionManager {
  private sessions = new Map<string, Session>();
  private viewerTokens = new Map<string, { sessionId: string; viewerId: string }>();
  private config: PartyConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: PartyConfig) {
    this.config = config;
  }

  startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // ─── Session CRUD ────────────────────────────────────────────

  createSession(
    addonUrl: string,
    addonPassword: string,
    sessionName: string
  ): { session: Session; adminToken: string } {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(`Maximum number of sessions (${this.config.maxSessions}) reached`);
    }

    const sessionId = uuidv4();
    const adminToken = uuidv4();

    const session: Session = {
      id: sessionId,
      name: sessionName,
      addonUrl,
      addonPassword,
      adminToken,
      adminId: null,
      createdAt: Date.now(),
      state: SessionState.LOBBY,
      content: null,
      viewers: new Map(),
      playback: {
        currentTimestamp: 0,
        playbackStartedAt: null,
      },
      adminDisconnectedAt: null,
    };

    this.sessions.set(sessionId, session);
    console.log(`✓ Session created: ${sessionId} ("${sessionName}")`);
    return { session, adminToken };
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  listSessions(): SessionPublicInfo[] {
    const result: SessionPublicInfo[] = [];
    for (const session of this.sessions.values()) {
      if (session.state === SessionState.ENDED) continue;
      result.push(this.toPublicInfo(session));
    }
    return result;
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.state = SessionState.ENDED;
    session.playback.playbackStartedAt = null;

    // Clean up viewer tokens for this session
    for (const [token, data] of this.viewerTokens.entries()) {
      if (data.sessionId === sessionId) {
        this.viewerTokens.delete(token);
      }
    }

    console.log(`✓ Session ended: ${sessionId}`);
  }

  removeSession(sessionId: string): void {
    this.endSession(sessionId);
    this.sessions.delete(sessionId);
    console.log(`✓ Session removed: ${sessionId}`);
  }

  validateAdminToken(sessionId: string, token: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.adminToken === token;
  }

  // ─── Viewer Management ──────────────────────────────────────

  addViewer(
    sessionId: string,
    displayName: string,
    role: "admin" | "guest"
  ): { viewer: Viewer; viewerToken: string } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    if (session.viewers.size >= this.config.maxViewersPerSession) {
      throw new Error(`Session is full (max ${this.config.maxViewersPerSession} viewers)`);
    }

    const viewerId = uuidv4();
    const viewerToken = uuidv4();

    const viewer: Viewer = {
      id: viewerId,
      displayName,
      role,
      connectedAt: Date.now(),
      isConnected: true,
      selectedSubtitleLang: null,
    };

    session.viewers.set(viewerId, viewer);
    this.viewerTokens.set(viewerToken, { sessionId, viewerId });

    if (role === "admin") {
      session.adminId = viewerId;
      session.adminDisconnectedAt = null;
    }

    console.log(`✓ Viewer joined: ${displayName} (${role}) in session ${sessionId}`);
    return { viewer, viewerToken };
  }

  removeViewer(sessionId: string, viewerId: string): Viewer | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const viewer = session.viewers.get(viewerId);
    if (!viewer) return null;

    viewer.isConnected = false;
    session.viewers.delete(viewerId);

    if (viewer.role === "admin") {
      session.adminDisconnectedAt = Date.now();
      // Auto-pause on admin disconnect
      if (session.state === SessionState.PLAYING) {
        this.pausePlayback(sessionId);
      }
    }

    // Clean up viewer token
    for (const [token, data] of this.viewerTokens.entries()) {
      if (data.viewerId === viewerId) {
        this.viewerTokens.delete(token);
        break;
      }
    }

    console.log(`✓ Viewer left: ${viewer.displayName} (${viewer.role}) from session ${sessionId}`);
    return viewer;
  }

  resolveViewerToken(token: string): { sessionId: string; viewerId: string } | null {
    return this.viewerTokens.get(token) ?? null;
  }

  // ─── Content Management ─────────────────────────────────────

  setContent(sessionId: string, content: SessionContent): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    session.content = content;
    session.state = SessionState.PAUSED;
    session.playback = { currentTimestamp: 0, playbackStartedAt: null };

    console.log(`✓ Content set for session ${sessionId}: ${content.title}`);
  }

  clearContent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.content = null;
    session.state = SessionState.LOBBY;
    session.playback = { currentTimestamp: 0, playbackStartedAt: null };
  }

  // ─── Playback Control ───────────────────────────────────────

  play(sessionId: string): PlaybackSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.content) return null;

    session.state = SessionState.PLAYING;
    session.playback.playbackStartedAt = Date.now();

    return this.getPlaybackSnapshot(sessionId);
  }

  pausePlayback(sessionId: string): PlaybackSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (session.state === SessionState.PLAYING && session.playback.playbackStartedAt) {
      const elapsed = (Date.now() - session.playback.playbackStartedAt) / 1000;
      session.playback.currentTimestamp += elapsed;
    }

    session.state = SessionState.PAUSED;
    session.playback.playbackStartedAt = null;

    return this.getPlaybackSnapshot(sessionId);
  }

  seek(sessionId: string, timestamp: number): PlaybackSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.playback.currentTimestamp = timestamp;
    if (session.state === SessionState.PLAYING) {
      session.playback.playbackStartedAt = Date.now();
    }

    return this.getPlaybackSnapshot(sessionId);
  }

  getPlaybackSnapshot(sessionId: string): PlaybackSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    let currentTimestamp = session.playback.currentTimestamp;
    if (session.state === SessionState.PLAYING && session.playback.playbackStartedAt) {
      currentTimestamp += (Date.now() - session.playback.playbackStartedAt) / 1000;
    }

    return {
      state: session.state,
      currentTimestamp,
      serverTime: Date.now(),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────

  toPublicInfo(session: Session): SessionPublicInfo {
    return {
      id: session.id,
      name: session.name,
      state: session.state,
      content: session.content ? this.contentToPublic(session.content) : null,
      viewerCount: session.viewers.size,
      createdAt: session.createdAt,
    };
  }

  private contentToPublic(content: SessionContent): SessionContentPublic {
    return {
      type: content.type,
      imdbId: content.imdbId,
      title: content.title,
      year: content.year,
      poster: content.poster,
      streamUrl: content.streamUrl,
      subtitles: content.subtitles,
      duration: content.duration,
      season: content.season,
      episode: content.episode,
      episodeTitle: content.episodeTitle,
    };
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions.entries()) {
      const age = now - session.createdAt;
      const isExpired = age > this.config.sessionTimeoutMs;
      const isEnded = session.state === SessionState.ENDED;

      // Clean up sessions where admin disconnected and didn't return
      const adminGone =
        session.adminDisconnectedAt !== null &&
        now - session.adminDisconnectedAt > this.config.adminReconnectTimeoutMs;

      if (isExpired || isEnded || adminGone) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired sessions (${this.sessions.size} remaining)`);
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}

export interface PlaybackSnapshot {
  state: SessionState;
  currentTimestamp: number;
  serverTime: number;
}
