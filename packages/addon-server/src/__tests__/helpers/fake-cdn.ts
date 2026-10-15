/**
 * Fake CDN server for proxy integration tests.
 *
 * Serves a virtual N-byte "video file" over HTTP with Range request support.
 * Content is generated on-the-fly (repeating 0x42 bytes) — size and speed matter,
 * not the actual data.
 *
 * Features:
 *  - Range requests: bytes=X-Y  and  bytes=X-  (open-ended)
 *  - One-shot stall injection: pause for `stallDurationMs` when a request
 *    overlaps `stallAtByte`, simulating a CDN hiccup that the proxy must handle
 *  - Per-request bandwidth throttle: max bytes/sec per connection (optional)
 */

import http from "node:http";

export interface FakeCdnOptions {
  /** Virtual file size in bytes. Default: 10 GB */
  virtualFileSize?: number;
  /** Stall the response for this long when a request covers stallAtByte. */
  stallAtByte?: number;
  /** Duration of the injected stall in ms. Default: 4000 */
  stallDurationMs?: number;
  /** Max bytes/sec to send per connection (0 = unlimited). Default: 0 */
  bandwidthBps?: number;
}

export interface FakeCdnServer {
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}

const CHUNK = 64 * 1024; // 64 KB per write

export async function startFakeCdn(opts: FakeCdnOptions = {}): Promise<FakeCdnServer> {
  const virtualFileSize = opts.virtualFileSize ?? 10 * 1024 * 1024 * 1024; // 10 GB
  const stallAtByte = opts.stallAtByte;
  const stallDurationMs = opts.stallDurationMs ?? 4000;
  const bandwidthBps = opts.bandwidthBps ?? 0;

  // Track whether the one-shot stall has fired
  let stallFired = false;

  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }

    // Parse Range header
    let start = 0;
    let end = virtualFileSize - 1;
    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (m) {
        start = parseInt(m[1], 10);
        if (m[2]) end = Math.min(parseInt(m[2], 10), virtualFileSize - 1);
      }
    }

    const contentLength = end - start + 1;

    res.writeHead(206, {
      "Content-Type": "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${virtualFileSize}`,
      "Content-Length": String(contentLength),
      "Accept-Ranges": "bytes",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    // Inject one-shot stall: if this request covers stallAtByte and the stall hasn't fired yet
    const shouldStall =
      stallAtByte !== undefined &&
      !stallFired &&
      start <= stallAtByte &&
      end >= stallAtByte;

    if (shouldStall) {
      stallFired = true;
      setTimeout(() => writeRange(res, contentLength, bandwidthBps), stallDurationMs);
    } else {
      writeRange(res, contentLength, bandwidthBps);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };

  return {
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

/**
 * Stream `totalBytes` worth of fake content to `res`, honoring an optional
 * bandwidth cap (bytes/sec). Content is all 0x42 bytes.
 */
function writeRange(res: http.ServerResponse, totalBytes: number, bandwidthBps: number): void {
  let remaining = totalBytes;

  function sendNext(): void {
    if (remaining <= 0) {
      res.end();
      return;
    }
    const size = Math.min(CHUNK, remaining);
    const buf = Buffer.allocUnsafe(size).fill(0x42);
    remaining -= size;

    const canContinue = res.write(buf);

    if (bandwidthBps > 0) {
      // Throttle: delay next chunk so we don't exceed bandwidthBps
      const delayMs = Math.max(1, Math.floor((size / bandwidthBps) * 1000));
      setTimeout(sendNext, delayMs);
    } else if (!canContinue) {
      // Back-pressure: wait for drain
      res.once("drain", sendNext);
    } else {
      // Yield to the event loop occasionally to avoid blocking
      if (remaining > 0 && (totalBytes - remaining) % (CHUNK * 16) === 0) {
        setImmediate(sendNext);
      } else {
        sendNext();
      }
    }
  }

  sendNext();
}
