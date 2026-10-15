#!/usr/bin/env python3
"""CTranslate2 HTTP sidecar for NLLB-200 distilled.

GET /health
POST /translate  {"source": "eng_Latn", "target": "heb_Hebr", "texts": ["..."]}
                 -> {"translations": ["..."]}  (1:1 with texts)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, List

try:
    import ctranslate2
    import sentencepiece
except ImportError as exc:
    sys.stderr.write(
        "ctranslate2 and sentencepiece are required. "
        "Install them in the public image or attach a sibling at MT_SERVER_URL.\n"
        f"{exc}\n"
    )
    raise SystemExit(1) from exc

translator = None
sp_model = None


def load_model(model_dir: str) -> None:
    global translator, sp_model
    spm_path = os.path.join(model_dir, "sentencepiece.bpe.model")
    if not os.path.isdir(model_dir):
        raise FileNotFoundError(f"model dir missing: {model_dir}")
    if not os.path.isfile(spm_path):
        raise FileNotFoundError(f"sentencepiece model missing: {spm_path}")
    sp_model = sentencepiece.SentencePieceProcessor()
    sp_model.Load(spm_path)
    translator = ctranslate2.Translator(model_dir, device="cpu", compute_type="int8")


def translate_texts(source: str, target: str, texts: List[str]) -> List[str]:
    if translator is None or sp_model is None:
        raise RuntimeError("model not loaded")
    if not source or not target:
        raise ValueError("source and target FLORES codes are required")
    token_batch: List[List[str]] = []
    for text in texts:
        pieces = sp_model.encode(text or "", out_type=str)
        token_batch.append([source] + pieces + ["</s>"])
    prefixes = [[target] for _ in texts]
    results = translator.translate_batch(token_batch, target_prefix=prefixes)
    out: List[str] = []
    for result in results:
        hyp = list(result.hypotheses[0]) if result.hypotheses else []
        if hyp and hyp[0] == target:
            hyp = hyp[1:]
        out.append(sp_model.decode(hyp))
    if len(out) != len(texts):
        raise RuntimeError(f"translated {len(out)} lines, expected {len(texts)}")
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[nllb] " + (fmt % args) + "\n")

    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/health":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        self._send_json(200, {"ok": True, "status": "ok"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/translate":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"ok": False, "error": "invalid json"})
            return
        source = str(payload.get("source") or "").strip()
        target = str(payload.get("target") or "").strip()
        texts = payload.get("texts")
        if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
            self._send_json(400, {"ok": False, "error": "texts must be a string array"})
            return
        try:
            translations = translate_texts(source, target, texts)
        except Exception as exc:  # pylint: disable=broad-except
            self._send_json(500, {"ok": False, "error": str(exc)})
            return
        self._send_json(200, {"translations": translations})


def main() -> None:
    parser = argparse.ArgumentParser(description="NLLB CTranslate2 HTTP sidecar")
    parser.add_argument("--model", required=True, help="CTranslate2 model directory")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8082)
    args = parser.parse_args()
    load_model(args.model)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stderr.write(f"[nllb] listening on {args.host}:{args.port} model={args.model}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
