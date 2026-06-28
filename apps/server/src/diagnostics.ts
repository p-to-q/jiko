import { access } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "./process.js";

export type DiagnosticStatus = "ready" | "configured" | "missing" | "disabled";

export type DiagnosticCheck = {
  status: DiagnosticStatus;
  id: string;
  detail?: string;
};

const requiredClipKeys = [
  "mixed.no-majority",
  "minority.maintain",
  "minority.deviate",
  "minority.static",
  "consensus.maintain",
  "consensus.deviate",
  "consensus.static"
];

const clipExtensions = ["wav", "mp3", "m4a", "aiff"];

export async function collectDiagnostics() {
  const [ffmpeg, stt, tts] = await Promise.all([
    checkFfmpeg(),
    checkSttProvider(),
    checkTtsProvider()
  ]);

  return {
    runtime: {
      ffmpeg
    },
    providers: {
      stt,
      tts
    }
  };
}

async function checkFfmpeg(): Promise<DiagnosticCheck> {
  const bin = process.env.FFMPEG_BIN?.trim() || "ffmpeg";

  try {
    await runProcess(bin, ["-version"]);
    return {
      status: "ready",
      id: bin
    };
  } catch (error) {
    return {
      status: "missing",
      id: bin,
      detail: shortReason(error)
    };
  }
}

async function checkSttProvider(): Promise<DiagnosticCheck> {
  const provider = process.env.STT_PROVIDER?.trim().toLowerCase();

  if (!provider) {
    return {
      status: "disabled",
      id: "local:stt-unconfigured",
      detail: "No local STT provider configured; audio receipts will mark STT unavailable."
    };
  }

  if (provider === "funasr") {
    const endpoint = process.env.FUNASR_ENDPOINT?.trim();
    return endpoint
      ? { status: "configured", id: "local:funasr-http", detail: endpoint }
      : { status: "missing", id: "local:funasr-http", detail: "FUNASR_ENDPOINT is required." };
  }

  if (provider === "whisper.cpp" || provider === "whisper_cpp" || provider === "whisper-cpp") {
    const bin = process.env.WHISPER_CPP_BIN?.trim();
    const model = process.env.WHISPER_MODEL?.trim();

    if (!bin || !model) {
      return {
        status: "missing",
        id: "local:whisper.cpp",
        detail: "WHISPER_CPP_BIN and WHISPER_MODEL are required."
      };
    }

    const [binReady, modelReady] = await Promise.all([fileExists(bin), fileExists(model)]);

    if (!binReady || !modelReady) {
      return {
        status: "missing",
        id: "local:whisper.cpp",
        detail: `${binReady ? "" : "WHISPER_CPP_BIN not found. "}${modelReady ? "" : "WHISPER_MODEL not found."}`.trim()
      };
    }

    return {
      status: "ready",
      id: "local:whisper.cpp",
      detail: path.basename(model)
    };
  }

  if (provider === "sherpa-onnx" || provider === "sherpa" || provider === "sensevoice") {
    const python = process.env.SHERPA_ONNX_PYTHON?.trim() || ".venv/bin/python";
    const model = process.env.SHERPA_ONNX_SENSEVOICE_MODEL?.trim();
    const tokens = process.env.SHERPA_ONNX_SENSEVOICE_TOKENS?.trim();

    if (!model || !tokens) {
      return {
        status: "missing",
        id: "local:sherpa-onnx-sensevoice",
        detail: "SHERPA_ONNX_SENSEVOICE_MODEL and SHERPA_ONNX_SENSEVOICE_TOKENS are required."
      };
    }

    const [pythonReady, modelReady, tokensReady] = await Promise.all([
      fileExists(python),
      fileExists(model),
      fileExists(tokens)
    ]);

    if (!pythonReady || !modelReady || !tokensReady) {
      return {
        status: "missing",
        id: "local:sherpa-onnx-sensevoice",
        detail: `${pythonReady ? "" : "SHERPA_ONNX_PYTHON not found. "}${modelReady ? "" : "SHERPA_ONNX_SENSEVOICE_MODEL not found. "}${tokensReady ? "" : "SHERPA_ONNX_SENSEVOICE_TOKENS not found."}`.trim()
      };
    }

    return {
      status: "ready",
      id: "local:sherpa-onnx-sensevoice",
      detail: path.basename(path.dirname(model))
    };
  }

  return {
    status: "missing",
    id: `local:${provider}`,
    detail: "Unknown local STT provider."
  };
}

async function checkTtsProvider(): Promise<DiagnosticCheck> {
  const provider = process.env.TTS_PROVIDER?.trim().toLowerCase();

  if (!provider) {
    return {
      status: "disabled",
      id: "local:tts-unconfigured",
      detail: "No local TTS provider configured; result flow will continue without playback."
    };
  }

  if (provider === "clip" || provider === "clips" || provider === "local-clip") {
    const dir = process.env.TTS_CLIP_DIR?.trim();

    if (!dir) {
      return {
        status: "missing",
        id: "local:clip",
        detail: "TTS_CLIP_DIR is required."
      };
    }

    if (!(await fileExists(dir))) {
      return { status: "missing", id: "local:clip", detail: "TTS_CLIP_DIR not found." };
    }

    const missingKeys = await findMissingClipKeys(dir);

    return missingKeys.length === 0
      ? { status: "ready", id: "local:clip", detail: dir }
      : {
          status: "missing",
          id: "local:clip",
          detail: `Missing clips: ${missingKeys.join(", ")}`
        };
  }

  if (provider === "piper") {
    const voice = process.env.PIPER_VOICE?.trim();

    if (!voice) {
      return {
        status: "missing",
        id: "local:piper",
        detail: "PIPER_VOICE is required."
      };
    }

    return (await fileExists(voice))
      ? { status: "configured", id: "local:piper", detail: path.basename(voice) }
      : { status: "missing", id: "local:piper", detail: "PIPER_VOICE not found." };
  }

  return {
    status: "missing",
    id: `local:${provider}`,
    detail: "Unknown local TTS provider."
  };
}

async function findMissingClipKeys(dir: string): Promise<string[]> {
  const missingKeys: string[] = [];

  for (const key of requiredClipKeys) {
    const candidates = await Promise.all(
      clipExtensions.map((extension) => fileExists(path.join(dir, `${key}.${extension}`)))
    );
    const exists = candidates.some(Boolean);

    if (!exists) {
      missingKeys.push(key);
    }
  }

  return missingKeys;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shortReason(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 180) : "failed";
}
