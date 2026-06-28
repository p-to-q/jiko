import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderReceipt, TtsRequest } from "@jiko/protocol";
import { runProcess } from "./process.js";

type TtsOutput = {
  provider: ProviderReceipt;
};

export async function speakLocalResult(tts: TtsRequest | undefined): Promise<TtsOutput | undefined> {
  if (!tts?.text.trim()) {
    return undefined;
  }

  const provider = process.env.TTS_PROVIDER?.trim().toLowerCase();
  const startedAt = Date.now();

  if (provider === "clip" || provider === "clips" || provider === "local-clip") {
    const receipt = await runLocalClip(tts, startedAt);
    return { provider: receipt };
  }

  if (provider === "piper") {
    const receipt = await runPiper(tts.text, startedAt);
    return { provider: receipt };
  }

  return {
    provider: {
      id: provider ? `local:${provider}:unavailable` : "local:tts-unconfigured",
      latencyMs: Date.now() - startedAt,
      remote: false
    }
  };
}

async function runLocalClip(tts: TtsRequest, startedAt: number): Promise<ProviderReceipt> {
  if (!tts.clipKey) {
    return {
      id: "local:clip:key-missing",
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  }

  const clipPath = await findClipPath(tts.clipKey);
  if (!clipPath) {
    return {
      id: `local:clip:missing:${safeReceiptPart(tts.clipKey)}`,
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  }

  if (!playbackEnabled()) {
    return {
      id: `local:clip:ready:${safeReceiptPart(tts.clipKey)}`,
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  }

  try {
    await playAudioFile(clipPath);

    return {
      id: `local:clip:played:${safeReceiptPart(tts.clipKey)}`,
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  } catch (error) {
    return {
      id: `local:clip:playback-failed:${shortReason(error)}`,
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  }
}

async function runPiper(text: string, startedAt: number): Promise<ProviderReceipt> {
  const bin = process.env.PIPER_BIN?.trim() || "piper";
  const voice = process.env.PIPER_VOICE?.trim();

  if (!voice) {
    return {
      id: "local:piper:voice-unconfigured",
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  }

  const outputDir = await mkdtemp(path.join(tmpdir(), "jiko-tts-"));
  const outputPath = path.join(outputDir, "speech.wav");

  try {
    await runProcess(bin, ["--model", voice, "--output_file", outputPath], { stdin: text });

    return {
      id: "local:piper",
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  } catch (error) {
    return {
      id: `local:piper:unavailable:${shortReason(error)}`,
      latencyMs: Date.now() - startedAt,
      remote: false
    };
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
}

async function findClipPath(clipKey: string): Promise<string | undefined> {
  const dir = process.env.TTS_CLIP_DIR?.trim();
  if (!dir) {
    return undefined;
  }

  for (const extension of ["wav", "mp3", "m4a", "aiff"]) {
    const candidate = path.join(dir, `${safeFilePart(clipKey)}.${extension}`);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function playAudioFile(filePath: string): Promise<void> {
  const command = process.env.TTS_PLAY_COMMAND?.trim() || defaultPlayCommand();
  if (!command) {
    throw new Error("No local audio playback command is configured.");
  }

  await runProcess(command, [filePath]);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function playbackEnabled(): boolean {
  const explicit = process.env.TTS_PLAY_AUDIO?.trim().toLowerCase();

  return explicit === "1" || explicit === "true";
}

function defaultPlayCommand(): string | undefined {
  if (process.env.AUDIO_OUTPUT_DEVICE?.trim()) {
    return "aplay";
  }

  return process.env.APP_RUNTIME === "pi" ? "aplay" : "afplay";
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function safeReceiptPart(value: string): string {
  return safeFilePart(value).slice(0, 64);
}

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "failed";

  return message.replace(/\s+/g, "-").slice(0, 48);
}
