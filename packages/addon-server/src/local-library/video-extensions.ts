/**
 * Video extensions the local library indexes and can stream (keep in sync with scanner + stream MIME map).
 */

import path from "node:path";

const VIDEO_EXT = new Set([".mkv", ".mp4", ".webm", ".avi", ".m4v", ".mov", ".wmv"]);

export const LOCAL_LIBRARY_VIDEO_EXTENSIONS_READABLE = ".mkv, .mp4, .webm, .avi, .m4v, .mov, .wmv";

export function isLocalLibraryVideoFile(filePath: string): boolean {
  return VIDEO_EXT.has(path.extname(filePath).toLowerCase());
}
