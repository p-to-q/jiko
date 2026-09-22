import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getConfiguredSherpaSenseVoiceWorker,
  sherpaSenseVoiceProviderId,
  type SttWorkerReadiness
} from "./persistentSttWorker.js";
import { runProcess } from "./process.js";
import {
  describeFunAsrEndpoint,
  getDeepgramConfigurationDiagnostic
} from "./stt.js";

export type DiagnosticStatus = "ready" | "configured" | "missing" | "disabled";

export type DiagnosticCheck = {
  status: DiagnosticStatus;
  id: string;
  detail?: string;
  readiness?: SttWorkerReadiness;
};

export type StrictDiagnosticBlocker = {
  component: "runtime.ffmpeg" | "providers.stt" | "providers.tts";
  status: DiagnosticStatus;
  id: string;
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
const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ffmpegProbeTimeoutMs = 1_000;
const ffmpegProbeMaxOutputBytes = 64 * 1024;
const ffmpegProbeCacheTtlMs = 1_000;

type FfmpegProbeCache = {
  bin: string;
  expiresAtMs: number;
  result?: DiagnosticCheck;
  pending?: Promise<DiagnosticCheck>;
};

let ffmpegProbeCache: FfmpegProbeCache | undefined;

export async function collectDiagnostics() {
  const [ffmpeg, stt, tts] = await Promise.all([
    checkFfmpeg(),
    checkSttProvider(),
    checkTtsProvider()
  ]);

  const strictBlocking = strictReadinessBlockers(ffmpeg, stt, tts);
  return {
    // `/health` is also a liveness endpoint. Consumers that require every
    // runtime/provider to be proved ready must gate on this separate field;
    // `configured`, `disabled`, and `missing` deliberately do not pass it.
    strictReady: strictBlocking.length === 0,
    strictBlocking,
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
  const now = performance.now();
  if (ffmpegProbeCache?.bin === bin) {
    if (ffmpegProbeCache.pending) {
      return ffmpegProbeCache.pending;
    }
    if (ffmpegProbeCache.result && now < ffmpegProbeCache.expiresAtMs) {
      return ffmpegProbeCache.result;
    }
  }

  const pending = probeFfmpeg(bin);
  ffmpegProbeCache = {
    bin,
    expiresAtMs: 0,
    pending
  };

  const result = await pending;
  if (ffmpegProbeCache?.bin === bin && ffmpegProbeCache.pending === pending) {
    ffmpegProbeCache = {
      bin,
      expiresAtMs: performance.now() + ffmpegProbeCacheTtlMs,
      result
    };
  }
  return result;
}

async function probeFfmpeg(bin: string): Promise<DiagnosticCheck> {
  try {
    await runProcess(bin, ["-version"], {
      timeoutMs: ffmpegProbeTimeoutMs,
      maxOutputBytes: ffmpegProbeMaxOutputBytes
    });
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

function strictReadinessBlockers(
  ffmpeg: DiagnosticCheck,
  stt: DiagnosticCheck,
  tts: DiagnosticCheck
): StrictDiagnosticBlocker[] {
  const checks: ReadonlyArray<readonly [StrictDiagnosticBlocker["component"], DiagnosticCheck]> = [
    ["runtime.ffmpeg", ffmpeg],
    ["providers.stt", stt],
    ["providers.tts", tts]
  ];
  return checks.flatMap(([component, check]) => check.status === "ready"
    ? []
    : [{ component, status: check.status, id: check.id }]);
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

  if (provider === "deepgram") {
    return getDeepgramConfigurationDiagnostic();
  }

  if (provider === "funasr") {
    const endpoint = process.env.FUNASR_ENDPOINT?.trim();
    if (!endpoint) {
      return {
        status: "missing",
        id: "self-hosted:funasr-http",
        detail: "FUNASR_ENDPOINT is required."
      };
    }

    const boundary = describeFunAsrEndpoint(endpoint);
    if (boundary?.scope === "network") {
      return {
        status: "missing",
        id: "self-hosted:funasr-http:network-blocked",
        detail: "FUNASR_ENDPOINT must use loopback or a literal private LAN address; public/DNS network endpoints are blocked."
      };
    }

    return boundary
      ? {
          status: "configured",
          id: `self-hosted:funasr-http:${boundary.scope}`,
          detail: `${boundary.scope}; ${boundary.origin}; operator-managed self-hosted endpoint`
        }
      : {
          status: "missing",
          id: "self-hosted:funasr-http:invalid",
          detail: "FUNASR_ENDPOINT must be a valid HTTP(S) endpoint without credentials or a fragment."
        };
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
        id: sherpaSenseVoiceProviderId,
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
        id: sherpaSenseVoiceProviderId,
        detail: `${pythonReady ? "" : "SHERPA_ONNX_PYTHON not found. "}${modelReady ? "" : "SHERPA_ONNX_SENSEVOICE_MODEL not found. "}${tokensReady ? "" : "SHERPA_ONNX_SENSEVOICE_TOKENS not found."}`.trim()
      };
    }

    try {
      const readiness = await getConfiguredSherpaSenseVoiceWorker().start();
      return {
        status: "ready",
        id: sherpaSenseVoiceProviderId,
        detail: [
          `${readiness.runtime.name}@${readiness.runtime.version}`,
          `${readiness.artifacts.model.name} sha256:${readiness.artifacts.model.sha256.slice(0, 12)}`,
          `${readiness.artifacts.tokens.name} sha256:${readiness.artifacts.tokens.sha256.slice(0, 12)}`,
          `load ${readiness.loadMs} ms`
        ].join("; "),
        readiness
      };
    } catch (error) {
      return {
        status: "missing",
        id: sherpaSenseVoiceProviderId,
        detail: `Persistent worker not ready: ${shortReason(error)}`
      };
    }
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

    const dirs = resolveLocalDirs(dir);
    const existingDir = await firstExistingDir(dirs);

    if (!existingDir) {
      return { status: "missing", id: "local:clip", detail: "TTS_CLIP_DIR not found." };
    }

    const missingKeys = await findMissingClipKeys(existingDir);

    return missingKeys.length === 0
      ? { status: "ready", id: "local:clip", detail: existingDir }
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

async function firstExistingDir(dirs: string[]): Promise<string | undefined> {
  for (const dir of dirs) {
    if (await fileExists(dir)) {
      return dir;
    }
  }

  return undefined;
}

function resolveLocalDirs(dir: string): string[] {
  if (path.isAbsolute(dir)) {
    return [dir];
  }

  return [path.resolve(dir), path.resolve(serverRoot, dir)];
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
