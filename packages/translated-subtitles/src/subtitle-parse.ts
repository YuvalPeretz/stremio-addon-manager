/**
 * SRT / VTT parse and 1:1 rebundle. Timestamps are never sent to the LLM.
 */

import type { ParsedSubtitle, SubtitleCue, SubtitleFormat } from "./types.js";

const TIMESTAMP_LINE =
  /^((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})(.*)$/;

export class SubtitleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubtitleParseError";
  }
}

export function detectFormat(content: string, hint?: SubtitleFormat): SubtitleFormat {
  const trimmed = content.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("WEBVTT")) {
    return "vtt";
  }
  if (hint) {
    return hint;
  }
  return "srt";
}

function splitBlocks(normalized: string): string[] {
  return normalized.split(/\n{2,}/);
}

function parseTimestampLine(line: string): { start: string; end: string; settings: string } | null {
  const match = TIMESTAMP_LINE.exec(line.trim());
  if (!match) {
    return null;
  }
  return {
    start: match[1],
    end: match[2],
    settings: (match[3] ?? "").trim(),
  };
}

function isNumericIndex(line: string): boolean {
  return /^\d+$/.test(line.trim());
}

export function parseSubtitle(content: string, hint?: SubtitleFormat): ParsedSubtitle {
  const withoutBom = content.replace(/^\uFEFF/, "");
  const normalized = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const format = detectFormat(normalized, hint);

  if (format === "vtt") {
    return parseVtt(normalized);
  }
  return parseSrt(normalized);
}

function parseSrt(normalized: string): ParsedSubtitle {
  const cues: SubtitleCue[] = [];
  const blocks = splitBlocks(normalized.trim());
  let fallbackIndex = 1;

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    if (lines.length === 0 || lines.every((l) => l.trim() === "")) {
      continue;
    }

    let offset = 0;
    let index = fallbackIndex;
    if (isNumericIndex(lines[0] ?? "")) {
      index = parseInt(lines[0] ?? "0", 10);
      offset = 1;
    }

    const ts = parseTimestampLine(lines[offset] ?? "");
    if (!ts) {
      continue;
    }

    const text = lines.slice(offset + 1).join("\n").replace(/\n+$/, "");
    cues.push({
      index,
      start: ts.start,
      end: ts.end,
      settings: "",
      text,
    });
    fallbackIndex = index + 1;
  }

  return { format: "srt", header: "", cues };
}

function parseVtt(normalized: string): ParsedSubtitle {
  const lines = normalized.split("\n");
  const headerLines: string[] = [];
  let i = 0;

  if ((lines[0] ?? "").startsWith("WEBVTT")) {
    headerLines.push(lines[0] ?? "");
    i = 1;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      if (TIMESTAMP_LINE.test(line.trim())) {
        break;
      }
      // A cue identifier sits immediately above a timestamp line.
      const next = lines[i + 1] ?? "";
      if (line.trim() !== "" && TIMESTAMP_LINE.test(next.trim())) {
        break;
      }
      headerLines.push(line);
      i += 1;
    }
  }

  const rest = lines.slice(i).join("\n").trim();
  const cues: SubtitleCue[] = [];
  let fallbackIndex = 1;

  for (const block of splitBlocks(rest)) {
    const blockLines = block.split("\n").map((l) => l.trimEnd());
    if (blockLines.length === 0 || blockLines.every((l) => l.trim() === "")) {
      continue;
    }
    const first = blockLines[0] ?? "";
    if (/^(NOTE|STYLE|REGION)\b/.test(first.trim())) {
      continue;
    }

    let offset = 0;
    let index = fallbackIndex;
    let ts = parseTimestampLine(first);
    if (!ts && blockLines.length > 1) {
      ts = parseTimestampLine(blockLines[1] ?? "");
      if (ts) {
        const ident = first.trim();
        if (isNumericIndex(ident)) {
          index = parseInt(ident, 10);
        }
        offset = 1;
      }
    }
    if (!ts) {
      continue;
    }

    const text = blockLines.slice(offset + 1).join("\n").replace(/\n+$/, "");
    cues.push({
      index,
      start: ts.start,
      end: ts.end,
      settings: ts.settings,
      text,
    });
    fallbackIndex = index + 1;
  }

  const header = headerLines.join("\n").replace(/\n+$/, "");
  return { format: "vtt", header, cues };
}

export function rebundleSubtitle(parsed: ParsedSubtitle, translatedTexts: string[]): string {
  if (translatedTexts.length !== parsed.cues.length) {
    throw new SubtitleParseError(
      `Cue count mismatch: parsed ${parsed.cues.length}, translated ${translatedTexts.length}`
    );
  }

  if (parsed.format === "vtt") {
    return rebundleVtt(parsed, translatedTexts);
  }
  return rebundleSrt(parsed, translatedTexts);
}

function rebundleSrt(parsed: ParsedSubtitle, translatedTexts: string[]): string {
  const blocks = parsed.cues.map((cue, i) => {
    const text = translatedTexts[i] ?? "";
    return `${cue.index}\n${cue.start} --> ${cue.end}\n${text}`;
  });
  return blocks.join("\n\n") + (blocks.length > 0 ? "\n" : "");
}

function rebundleVtt(parsed: ParsedSubtitle, translatedTexts: string[]): string {
  const header = parsed.header.trim() === "" ? "WEBVTT" : parsed.header;
  const blocks = parsed.cues.map((cue, i) => {
    const settings = cue.settings ? ` ${cue.settings}` : "";
    const text = translatedTexts[i] ?? "";
    return `${cue.start} --> ${cue.end}${settings}\n${text}`;
  });
  return `${header}\n\n${blocks.join("\n\n")}${blocks.length > 0 ? "\n" : ""}`;
}

export function cueTexts(parsed: ParsedSubtitle): string[] {
  return parsed.cues.map((c) => c.text);
}
