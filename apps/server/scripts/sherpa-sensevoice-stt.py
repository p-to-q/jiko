#!/usr/bin/env python3
import argparse
import json
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Local sherpa-onnx SenseVoice STT adapter.")
    parser.add_argument("--audio", required=True, help="Path to a mono 16 kHz WAV file.")
    parser.add_argument("--model", required=True, help="Path to SenseVoice model.onnx.")
    parser.add_argument("--tokens", required=True, help="Path to tokens.txt or tokens.json.")
    parser.add_argument("--language", default="auto", help="auto, zh, en, ja, ko, or yue.")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--provider", default="cpu")
    parser.add_argument("--use-itn", action="store_true")
    args = parser.parse_args()

    started_at = time.time()

    try:
        import sherpa_onnx
        import soundfile as sf

        model = Path(args.model)
        tokens = Path(args.tokens)
        audio_path = Path(args.audio)

        if not model.exists():
            raise FileNotFoundError(f"model not found: {model}")

        if not tokens.exists():
            raise FileNotFoundError(f"tokens not found: {tokens}")

        if not audio_path.exists():
            raise FileNotFoundError(f"audio not found: {audio_path}")

        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(model),
            tokens=str(tokens),
            num_threads=max(1, args.threads),
            language=args.language,
            use_itn=args.use_itn,
            provider=args.provider,
        )
        audio, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, audio[:, 0])
        recognizer.decode_stream(stream)

        text = stream.result.text.strip()
        print(
            json.dumps(
                {
                    "text": text,
                    "language": guess_language(text),
                    "provider": "local:sherpa-onnx-sensevoice",
                    "confidence": 0.76 if text else 0.2,
                    "latencyMs": round((time.time() - started_at) * 1000),
                },
                ensure_ascii=False,
            )
        )
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


def guess_language(text: str) -> str:
    if any("\u3400" <= char <= "\u9fff" for char in text):
        return "zh"

    return "en" if text else "unknown"


if __name__ == "__main__":
    raise SystemExit(main())
