import path from "node:path";
import type { TranscriptResult } from "@jiko/protocol";
import { runProcess } from "./process.js";

type SttInput = {
  audioPath: string;
};

type SttProvider = {
  id: string;
  transcribe(input: SttInput): Promise<TranscriptResult>;
};

export async function transcribeLocalAudio(input: SttInput): Promise<TranscriptResult> {
  const provider = getConfiguredProvider();
  const startedAt = Date.now();

  try {
    const result = await provider.transcribe(input);

    return {
      ...result,
      latencyMs: result.latencyMs ?? Date.now() - startedAt
    };
  } catch (error) {
    return unavailableTranscript(provider.id, startedAt, error);
  }
}

function getConfiguredProvider(): SttProvider {
  const provider = process.env.STT_PROVIDER?.trim().toLowerCase();

  if (provider === "whisper.cpp" || provider === "whisper_cpp" || provider === "whisper-cpp") {
    return whisperCppProvider();
  }

  if (provider === "funasr" && process.env.FUNASR_ENDPOINT?.trim()) {
    return funasrHttpProvider(process.env.FUNASR_ENDPOINT.trim());
  }

  if (provider === "sherpa-onnx" || provider === "sherpa" || provider === "sensevoice") {
    return sherpaSenseVoiceProvider();
  }

  return unavailableProvider(provider ? `local:${provider}` : "local:stt-unconfigured");
}

function whisperCppProvider(): SttProvider {
  return {
    id: "local:whisper.cpp",
    async transcribe(input) {
      const bin = process.env.WHISPER_CPP_BIN?.trim();
      const model = process.env.WHISPER_MODEL?.trim();

      if (!bin || !model) {
        throw new Error("WHISPER_CPP_BIN and WHISPER_MODEL are required for whisper.cpp STT.");
      }

      // Default to language auto-detect; pin with WHISPER_LANGUAGE=zh for Chinese.
      const language = process.env.WHISPER_LANGUAGE?.trim() || "auto";
      const { stdout, stderr } = await runProcess(bin, [
        "-m",
        model,
        "-f",
        input.audioPath,
        "-l",
        language,
        "-nt",
        "-np"
      ]);
      const text = stripWhisperOutput(stdout || stderr);

      return {
        text,
        language: text ? guessLanguage(text) : undefined,
        provider: "local:whisper.cpp",
        confidence: text ? 0.72 : 0.2
      };
    }
  };
}

function funasrHttpProvider(endpoint: string): SttProvider {
  return {
    id: "local:funasr-http",
    async transcribe(input) {
      const body = new FormData();
      body.append("file", new Blob([await readFileAsArrayBuffer(input.audioPath)], { type: "audio/wav" }), path.basename(input.audioPath));

      const response = await fetch(endpoint, {
        method: "POST",
        body
      });

      if (!response.ok) {
        throw new Error(`FunASR endpoint returned ${response.status} ${response.statusText}: ${await response.text()}`);
      }

      const payload = await response.json();
      const text = extractText(payload);

      return {
        text,
        language: text ? guessLanguage(text) : undefined,
        provider: "local:funasr-http",
        confidence: confidenceValue(payload) ?? (text ? 0.74 : 0.2)
      };
    }
  };
}

function sherpaSenseVoiceProvider(): SttProvider {
  return {
    id: "local:sherpa-onnx-sensevoice",
    async transcribe(input) {
      const python = process.env.SHERPA_ONNX_PYTHON?.trim() || ".venv/bin/python";
      const script = process.env.SHERPA_ONNX_STT_SCRIPT?.trim() || "apps/server/scripts/sherpa-sensevoice-stt.py";
      const model = process.env.SHERPA_ONNX_SENSEVOICE_MODEL?.trim();
      const tokens = process.env.SHERPA_ONNX_SENSEVOICE_TOKENS?.trim();

      if (!model || !tokens) {
        throw new Error("SHERPA_ONNX_SENSEVOICE_MODEL and SHERPA_ONNX_SENSEVOICE_TOKENS are required.");
      }

      const { stdout } = await runProcess(python, [
        script,
        "--audio",
        input.audioPath,
        "--model",
        model,
        "--tokens",
        tokens,
        "--language",
        process.env.SHERPA_ONNX_LANGUAGE?.trim() || "auto",
        "--threads",
        process.env.SHERPA_ONNX_THREADS?.trim() || "4",
        "--provider",
        process.env.SHERPA_ONNX_PROVIDER?.trim() || "cpu",
        ...(truthyEnv(process.env.SHERPA_ONNX_USE_ITN) ? ["--use-itn"] : [])
      ]);
      const payload = JSON.parse(stdout) as Partial<TranscriptResult>;
      const text = typeof payload.text === "string" ? payload.text : "";

      return {
        text,
        language: payload.language || (text ? guessLanguage(text) : undefined),
        provider: "local:sherpa-onnx-sensevoice",
        confidence: typeof payload.confidence === "number" ? payload.confidence : text ? 0.76 : 0.2,
        latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : undefined
      };
    }
  };
}

function unavailableProvider(id: string): SttProvider {
  return {
    id,
    async transcribe() {
      throw new Error("No local STT provider is configured.");
    }
  };
}

function unavailableTranscript(providerId: string, startedAt: number, error: unknown): TranscriptResult {
  const reason = error instanceof Error ? error.message : "Local STT failed.";

  return {
    text: "",
    language: undefined,
    provider: `${providerId}:unavailable`,
    confidence: 0,
    latencyMs: Date.now() - startedAt,
    segments: [
      {
        text: reason.slice(0, 180),
        startMs: 0,
        endMs: 0,
        confidence: 0
      }
    ]
  };
}

async function readFileAsArrayBuffer(path: string): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(path);
  const bytes = buffer as unknown as { length: number; [index: number]: number };
  const output = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes[index];
  }

  return output;
}

function stripWhisperOutput(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function extractText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.trim();
  }

  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const direct = stringValue(record.text) ?? stringValue(record.result) ?? stringValue(record.transcript);
  if (direct) {
    return direct.trim();
  }

  if (Array.isArray(record.sentences)) {
    return record.sentences
      .map((item) => (item && typeof item === "object" ? stringValue((item as Record<string, unknown>).text) : undefined))
      .filter(Boolean)
      .join("")
      .trim();
  }

  return "";
}

function confidenceValue(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>).confidence;

  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function guessLanguage(transcript: string): string {
  return /[\u3400-\u9fff]/.test(transcript) ? "zh" : "en";
}

function truthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}
