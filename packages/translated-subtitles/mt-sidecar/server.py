#!/usr/bin/env python3
"""CTranslate2 HTTP sidecar.

GET /health
POST /translate  {"source": "eng_Latn", "target": "heb_Hebr", "texts": ["..."]}
                 -> {"translations": ["..."]}  (1:1 with texts)

--tokenizer nllb    FLORES source token + target prefix, sentencepiece.bpe.model
--tokenizer quickmt src.spm.model / tgt.spm.model, no language tokens (bilingual)
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

BATCH_SIZE = 32
translator = None
sp_model = None
tgt_model = None
tokenizer_kind = "nllb"


def _load_spm(path: str) -> sentencepiece.SentencePieceProcessor:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"sentencepiece model missing: {path}")
    model = sentencepiece.SentencePieceProcessor()
    model.Load(path)
    return model


def load_model(model_dir: str, kind: str) -> None:
    global translator, sp_model, tgt_model, tokenizer_kind
    if not os.path.isdir(model_dir):
        raise FileNotFoundError(f"model dir missing: {model_dir}")
    tokenizer_kind = "quickmt" if kind == "quickmt" else "nllb"
    if tokenizer_kind == "quickmt":
        sp_model = _load_spm(os.path.join(model_dir, "src.spm.model"))
        tgt_model = _load_spm(os.path.join(model_dir, "tgt.spm.model"))
    else:
        sp_model = _load_spm(os.path.join(model_dir, "sentencepiece.bpe.model"))
        tgt_model = sp_model
    translator = ctranslate2.Translator(model_dir, device="cpu", compute_type="int8")


def _decode(tokens: List[str], drop_prefix: str | None) -> str:
    if tgt_model is None:
        raise RuntimeError("model not loaded")
    if drop_prefix and tokens and tokens[0] == drop_prefix:
        tokens = tokens[1:]
    if tokens and tokens[-1] == "</s>":
        tokens = tokens[:-1]
    return tgt_model.decode(tokens)


def _translate_chunk(
    token_batch: List[List[str]],
    prefixes: List[List[str]] | None,
    drop_prefix: str | None,
) -> List[str]:
    if translator is None:
        raise RuntimeError("model not loaded")
    kwargs: dict = {
        "beam_size": 2,
        "max_batch_size": BATCH_SIZE,
        "max_decoding_length": 256,
        "patience": 1,
    }
    if tokenizer_kind == "quickmt":
        kwargs["disable_unk"] = True
    if prefixes is not None:
        kwargs["target_prefix"] = prefixes
    results = translator.translate_batch(token_batch, **kwargs)
    out: List[str] = []
    for result in results:
        hyp = list(result.hypotheses[0]) if result.hypotheses else []
        out.append(_decode(hyp, drop_prefix))
    return out


def translate_texts(source: str, target: str, texts: List[str]) -> List[str]:
    if translator is None or sp_model is None:
        raise RuntimeError("model not loaded")
    token_batch: List[List[str]] = []
    prefixes: List[List[str]] | None = None
    if tokenizer_kind == "quickmt":
        for text in texts:
            pieces = sp_model.encode(text or "", out_type=str)
            token_batch.append(list(pieces) + ["</s>"])
    else:
        if not source or not target:
            raise ValueError("source and target FLORES codes are required")
        prefixes = []
        for text in texts:
            pieces = sp_model.encode(text or "", out_type=str)
            token_batch.append([source] + list(pieces) + ["</s>"])
            prefixes.append([target])
    out: List[str] = []
    for start in range(0, len(token_batch), BATCH_SIZE):
        chunk = token_batch[start : start + BATCH_SIZE]
        prefix_chunk = prefixes[start : start + BATCH_SIZE] if prefixes is not None else None
        drop_prefix = target if tokenizer_kind == "nllb" else None
        out.extend(_translate_chunk(chunk, prefix_chunk, drop_prefix))
    if len(out) != len(texts):
        raise RuntimeError(f"translated {len(out)} lines, expected {len(texts)}")
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[mt] " + (fmt % args) + "\n")

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
    parser = argparse.ArgumentParser(description="CTranslate2 HTTP sidecar")
    parser.add_argument("--model", required=True, help="CTranslate2 model directory")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8082)
    parser.add_argument("--tokenizer", choices=("nllb", "quickmt"), default="nllb")
    args = parser.parse_args()
    load_model(args.model, args.tokenizer)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stderr.write(
        f"[mt] listening on {args.host}:{args.port} tokenizer={args.tokenizer} model={args.model}\n"
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
