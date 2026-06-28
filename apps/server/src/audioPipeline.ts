import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AudioFeatures, NormalizedAudio, RuntimeSource, TranscriptResult, UploadedAudio } from "@jiko/protocol";
import { extractWavFeatures } from "./audioFeatures.js";
import { buildReadings, buildResult } from "./mockPipeline.js";
import { runProcess } from "./process.js";
import { transcribeLocalAudio } from "./stt.js";
import type { Reading, SessionResult } from "./types.js";

export type AudioPipelineInput = {
  sessionId: string;
  source: RuntimeSource;
  mediaType: string;
  body: Uint8Array;
  durationMs?: number;
};

export type AudioPipelineResult = {
  uploadedAudio: UploadedAudio;
  normalizedAudio: NormalizedAudio;
  transcript: TranscriptResult;
  features: AudioFeatures;
  readings: Reading[];
  result: SessionResult;
};

export async function runAudioPipeline(input: AudioPipelineInput): Promise<AudioPipelineResult> {
  const uploadedAudio: UploadedAudio = {
    source: input.source,
    mediaType: input.mediaType,
    byteSize: input.body.byteLength,
    durationMs: input.durationMs
  };
  const tempDir = await mkdtemp(path.join(tmpdir(), "jiko-audio-"));
  const rawPath = path.join(tempDir, `input.${extensionForMediaType(input.mediaType)}`);
  const wavPath = path.join(tempDir, "normalized.wav");

  try {
    await writeFile(rawPath, input.body);
    const normalizedAudio = await normalizeAudio(rawPath, wavPath, input.durationMs);
    const [features, transcript] = await Promise.all([
      extractWavFeatures(wavPath),
      transcribeLocalAudio({ audioPath: wavPath })
    ]);
    const resolvedFeatures = withTranscriptFeatures(features, transcript);
    const language = transcript.language ?? guessLanguage(transcript.text);
    const readings = buildReadingsWithConfidence(transcript, language, resolvedFeatures);
    const result = buildResult(input.sessionId, readings);

    return {
      uploadedAudio,
      normalizedAudio: {
        ...normalizedAudio,
        durationMs: normalizedAudio.durationMs ?? resolvedFeatures.durationMs
      },
      transcript: {
        ...transcript,
        language
      },
      features: resolvedFeatures,
      readings,
      result
    };
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

async function normalizeAudio(inputPath: string, outputPath: string, durationMs?: number): Promise<NormalizedAudio> {
  const startedAt = Date.now();
  const ffmpegBin = process.env.FFMPEG_BIN?.trim() || "ffmpeg";

  await runProcess(ffmpegBin, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    "-sample_fmt",
    "s16",
    outputPath
  ]);

  return {
    mediaType: "audio/wav",
    sampleRateHz: 16000,
    channelCount: 1,
    durationMs,
    latencyMs: Date.now() - startedAt
  };
}

function buildReadingsWithConfidence(
  transcript: TranscriptResult,
  language: string,
  features: AudioFeatures
): Reading[] {
  return buildReadings(transcript.text, language, features, transcript.confidence ?? 0);
}

function withTranscriptFeatures(features: AudioFeatures, transcript: TranscriptResult): AudioFeatures {
  const compactTextLength = transcript.text.replace(/\s/g, "").length;

  if (compactTextLength === 0) {
    return features;
  }

  const speechSeconds = Math.max(0.001, (features.speechMs ?? features.durationMs) / 1000);

  return {
    ...features,
    speechRateCharsPerSecond: round(compactTextLength / speechSeconds)
  };
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType.includes("ogg")) {
    return "ogg";
  }

  if (mediaType.includes("wav")) {
    return "wav";
  }

  if (mediaType.includes("mp4") || mediaType.includes("m4a")) {
    return "m4a";
  }

  return "webm";
}

function guessLanguage(transcript: string): string {
  if (!transcript.trim()) {
    return "unknown";
  }

  return /[\u3400-\u9fff]/.test(transcript) ? "zh" : "en";
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
