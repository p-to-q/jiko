#!/usr/bin/env python3
"""Persistent local sherpa-onnx SenseVoice worker.

The worker loads one recognizer, emits one readiness receipt, and then accepts
newline-delimited JSON requests on stdin. It never sends audio or transcripts
over the network.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = 1
PROVIDER_ID = "local:sherpa-onnx-sensevoice"
MAX_REQUEST_LINE_BYTES = 64 * 1024


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Persistent local sherpa-onnx SenseVoice STT worker."
    )
    parser.add_argument("--model", required=True, help="Path to SenseVoice model.onnx.")
    parser.add_argument("--tokens", required=True, help="Path to tokens.txt or tokens.json.")
    parser.add_argument("--language", default="auto", help="auto, zh, en, ja, ko, or yue.")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--provider", default="cpu")
    parser.add_argument("--use-itn", action="store_true")
    args = parser.parse_args()

    started_at = time.monotonic()

    try:
        import sherpa_onnx
        import soundfile as sf

        model_path = require_file(Path(args.model), "model")
        tokens_path = require_file(Path(args.tokens), "tokens")
        model_identity = artifact_identity(model_path)
        tokens_identity = artifact_identity(tokens_path)
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model_path),
            tokens=str(tokens_path),
            num_threads=max(1, args.threads),
            language=args.language,
            use_itn=args.use_itn,
            provider=args.provider,
        )
        emit(
            {
                "type": "ready",
                "protocolVersion": PROTOCOL_VERSION,
                "providerId": PROVIDER_ID,
                "runtime": {
                    "name": "sherpa-onnx",
                    "version": package_version(sherpa_onnx),
                },
                "artifacts": {
                    "model": model_identity,
                    "tokens": tokens_identity,
                },
                "configuration": {
                    "language": args.language,
                    "threads": max(1, args.threads),
                    "executionProvider": args.provider,
                    "useItn": args.use_itn,
                },
                "loadMs": elapsed_ms(started_at),
                "workerPid": os.getpid(),
            }
        )
    except Exception as error:  # startup failure must be machine-readable
        emit_error("startup_error", None, "model_load_failed", error)
        return 1

    for raw_line in sys.stdin.buffer:
        if len(raw_line) > MAX_REQUEST_LINE_BYTES:
            emit_error(
                "error",
                None,
                "request_too_large",
                ValueError("request exceeds 64 KiB"),
            )
            continue

        try:
            payload = json.loads(raw_line)
        except Exception as error:
            emit_error("error", None, "invalid_json", error)
            continue

        if not isinstance(payload, dict):
            emit_error("error", None, "invalid_request", ValueError("request must be an object"))
            continue

        if payload.get("type") == "shutdown":
            return 0

        request_id = payload.get("requestId")
        if not isinstance(request_id, str) or not request_id:
            emit_error(
                "error",
                None,
                "invalid_request",
                ValueError("requestId is required"),
            )
            continue

        if payload.get("type") != "transcribe":
            emit_error(
                "error",
                request_id,
                "invalid_request",
                ValueError("type must be transcribe"),
            )
            continue

        audio_path_value = payload.get("audioPath")
        if not isinstance(audio_path_value, str) or not audio_path_value:
            emit_error(
                "error",
                request_id,
                "invalid_request",
                ValueError("audioPath is required"),
            )
            continue

        request_started_at = time.monotonic()
        try:
            audio_path = require_file(Path(audio_path_value), "audio")
            audio, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
            if sample_rate != 16000 or audio.shape[1] != 1:
                raise ValueError(
                    f"expected mono 16000 Hz WAV, received {audio.shape[1]} channel(s) at {sample_rate} Hz"
                )

            stream = recognizer.create_stream()
            stream.accept_waveform(sample_rate, audio[:, 0])
            recognizer.decode_stream(stream)
            text = stream.result.text.strip()
            emit(
                {
                    "type": "transcript",
                    "requestId": request_id,
                    "text": text,
                    "language": guess_language(text),
                    "latencyMs": elapsed_ms(request_started_at),
                }
            )
        except FileNotFoundError as error:
            emit_error("error", request_id, "audio_not_found", error)
        except ValueError as error:
            emit_error("error", request_id, "invalid_audio", error)
        except Exception as error:
            emit_error("error", request_id, "transcription_failed", error)

    return 0


def require_file(path: Path, label: str) -> Path:
    if not path.is_file():
        raise FileNotFoundError(f"{label} not found: {path}")
    return path


def artifact_identity(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)

    return {
        "name": path.name,
        "sha256": digest.hexdigest(),
        "bytes": path.stat().st_size,
    }


def package_version(module: Any) -> str:
    value = getattr(module, "__version__", None)
    if isinstance(value, str) and value:
        return value

    try:
        return importlib.metadata.version("sherpa-onnx")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def emit_error(
    message_type: str,
    request_id: str | None,
    code: str,
    error: Exception,
) -> None:
    payload: dict[str, Any] = {
        "type": message_type,
        "error": {
            "code": code,
            "message": single_line(str(error))[:240] or error.__class__.__name__,
        },
    }
    if request_id is not None:
        payload["requestId"] = request_id
    emit(payload)


def elapsed_ms(started_at: float) -> float:
    return round((time.monotonic() - started_at) * 1000, 3)


def guess_language(text: str) -> str:
    if any("\u3400" <= char <= "\u9fff" for char in text):
        return "zh"
    return "en" if text else "unknown"


def single_line(value: str) -> str:
    return " ".join(value.split())


if __name__ == "__main__":
    raise SystemExit(main())
