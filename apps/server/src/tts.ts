import { mkdtemp, rm } from "node:fs/promises";
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

function shortReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "failed";

  return message.replace(/\s+/g, "-").slice(0, 48);
}
