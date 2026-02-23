/**
 * Party Viewing - Type Definitions
 */

// ─── Session Types ───────────────────────────────────────────────

export enum SessionState {
  LOBBY = "lobby",
  PLAYING = "playing",
  PAUSED = "paused",
  ENDED = "ended",
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
}

export interface SessionContent {
  type: "movie" | "series";
  imdbId: string;
  title: string;
  year: number;
  poster: string;
  streamUrl: string;
  subtitles: Subtitle[];
  duration: number;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  resolvedAt: number;
}

export interface Viewer {
  id: string;
  displayName: string;
  role: "admin" | "guest";
  connectedAt: number;
  isConnected: boolean;
  selectedSubtitleLang: string | null;
}

export interface PlaybackClock {
  currentTimestamp: number;
  playbackStartedAt: number | null;
}

export interface Session {
  id: string;
  name: string;
  addonUrl: string;
  addonPassword: string;
  adminToken: string;
  adminId: string | null;
  createdAt: number;
  state: SessionState;
  content: SessionContent | null;
  viewers: Map<string, Viewer>;
  playback: PlaybackClock;
  adminDisconnectedAt: number | null;
}

export interface SessionPublicInfo {
  id: string;
  name: string;
  state: SessionState;
  content: SessionContentPublic | null;
  viewerCount: number;
  createdAt: number;
}

export interface SessionContentPublic {
  type: "movie" | "series";
  imdbId: string;
  title: string;
  year: number;
  poster: string;
  subtitles: Subtitle[];
  duration: number;
  season?: number;
  episode?: number;
  episodeTitle?: string;
}

// ─── WebSocket Message Types ─────────────────────────────────────

export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

// Client → Server
export enum ClientMessageType {
  PLAY = "PLAY",
  PAUSE = "PAUSE",
  SEEK = "SEEK",
  END_SESSION = "END_SESSION",
  SYNC_REQUEST = "SYNC_REQUEST",
  CHANGE_SUBTITLE = "CHANGE_SUBTITLE",
  CHAT_MESSAGE = "CHAT_MESSAGE",
}

// Server → Client
export enum ServerMessageType {
  SESSION_STATE = "SESSION_STATE",
  PLAYBACK_UPDATE = "PLAYBACK_UPDATE",
  CONTENT_CHANGED = "CONTENT_CHANGED",
  VIEWER_JOINED = "VIEWER_JOINED",
  VIEWER_LEFT = "VIEWER_LEFT",
  SESSION_ENDED = "SESSION_ENDED",
  SYNC_RESPONSE = "SYNC_RESPONSE",
  ERROR = "ERROR",
  CHAT_BROADCAST = "CHAT_BROADCAST",
}

export interface PlaybackUpdatePayload {
  state: SessionState;
  currentTimestamp: number;
  serverTime: number;
}

export interface SyncResponsePayload {
  state: SessionState;
  currentTimestamp: number;
  serverTime: number;
}

export interface ContentChangedPayload {
  content: SessionContentPublic;
}

export interface ViewerEventPayload {
  viewer: { id: string; displayName: string; role: string };
}

export interface ChatPayload {
  senderId: string;
  senderName: string;
  message: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

// ─── API Types ───────────────────────────────────────────────────

export interface CreateSessionRequest {
  addonUrl: string;
  addonPassword: string;
  sessionName: string;
}

export interface CreateSessionResponse {
  sessionId: string;
  adminToken: string;
  joinUrl: string;
  wsUrl: string;
}

export interface JoinSessionResponse {
  viewerId: string;
  viewerToken: string;
  session: SessionPublicInfo;
}

export interface SearchResult {
  id: string;
  type: "movie" | "series";
  name: string;
  year: number;
  poster: string;
  description: string;
}

export interface EpisodeInfo {
  number: number;
  title: string;
  id: string;
}

export interface SeasonInfo {
  number: number;
  episodes: EpisodeInfo[];
}

export interface StreamOption {
  url: string;
  name?: string;
  title?: string;
}

export interface ResolveStreamRequest {
  type: "movie" | "series";
  imdbId: string;
  title: string;
  year: number;
  poster: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  /** If provided, skip auto-selection and use this specific stream URL */
  streamUrl?: string;
}

export interface ResolveStreamResponse {
  streamUrl: string;
  subtitles: Subtitle[];
  metadata: {
    title: string;
    year: number;
    poster: string;
  };
}

export interface AddonValidationResult {
  valid: boolean;
  addonName?: string;
  requiresPassword: boolean;
  error?: string;
}

// ─── Internal Types ──────────────────────────────────────────────

export interface WSClient {
  ws: import("ws").WebSocket;
  sessionId: string;
  viewerId: string;
  isAlive: boolean;
}
