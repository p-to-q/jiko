import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AudioFeatures,
  NormalizedAudio,
  PipelineReceipt,
  PipelineStageName,
  PipelineStageReceipt,
  PipelineStageStatus,
  RuntimeSource,
  SttProviderReceipt,
  TranscriptResult,
  UploadedAudio
} from "@jiko/protocol";
import { extractWavFeatures } from "./audioFeatures.js";
import { buildReadings, buildResult } from "./mockPipeline.js";
import { ProcessTimeoutError, runProcess } from "./process.js";
import { transcribeAudio, type RemoteAudioConsent } from "./stt.js";
import type { StreamingSttFinal } from "./streamingStt.js";
import { enhanceTranscript } from "./transcriptEnhancement.js";
import type { Reading, SessionResult } from "./types.js";

const defaultMaxAudioDurationMs = 120_000;
const normalizedPcmBytesPerSecond = 16_000 * 2;
const normalizedContainerAllowanceBytes = 4 * 1024;

export type AudioPipelineInput = {
  sessionId: string;
  source: RuntimeSource;
  mediaType: string;
  body: Uint8Array;
  durationMs?: number;
  signal?: AbortSignal;
  remoteAudioConsent?: RemoteAudioConsent;
  /** Absolute server-monotonic cutoff reserved for the STT branch. */
  sttDeadlineMs?: number;
  /**
   * A coverage-checked final returned by the streaming scheduler. Replaceable
   * partial hypotheses can never inhabit this field.
   */
  acceptedStreamingFinal?: StreamingSttFinal;
};

export type AudioPipelineResult = {
  uploadedAudio: UploadedAudio;
  normalizedAudio: NormalizedAudio;
  pipeline: PipelineReceipt;
  sttProviderReceipt: SttProviderReceipt;
  transcript: TranscriptResult;
  features: AudioFeatures;
  readings: Reading[];
  result: SessionResult;
  /** Provider and temp-file cleanup completion; admission must follow this. */
  resourceSettlement: Promise<void>;
};

export class AudioPipelineError extends Error {
  readonly pipeline: PipelineReceipt;

  constructor(message: string, pipeline: PipelineReceipt) {
    super(message);
    this.name = "AudioPipelineError";
    this.pipeline = pipeline;
  }
}

export async function runAudioPipeline(input: AudioPipelineInput): Promise<AudioPipelineResult> {
  throwIfAborted(input.signal);
  const uploadedAudio: UploadedAudio = {
    source: input.source,
    mediaType: input.mediaType,
    byteSize: input.body.byteLength,
    durationMs: input.durationMs
  };
  const tempDir = await mkdtemp(path.join(tmpdir(), "jiko-audio-"));
  const rawPath = path.join(tempDir, `input.${extensionForMediaType(input.mediaType)}`);
  const wavPath = path.join(tempDir, "normalized.wav");
  const pipelineStartedAt = new Date().toISOString();
  const pipelineStarted = performance.now();
  const stageReceipts: PipelineStageReceipt[] = [];
  let providerSettlement: Promise<void> = Promise.resolve();
  let cleanupTransferred = false;

  try {
    throwIfAborted(input.signal);
    const normalization = await captureStage(
      "normalize",
      process.env.FFMPEG_BIN?.trim() || "ffmpeg",
      async () => {
        throwIfAborted(input.signal);
        await writeFile(rawPath, input.body);
        throwIfAborted(input.signal);
        return normalizeAudio(rawPath, wavPath, input.durationMs, input.signal);
      },
      input.signal
    );
    stageReceipts.push(normalization.receipt);
    if (!normalization.ok) {
      throw normalization.error;
    }

    const [featureRun, transcriptRun] = await Promise.all([
      captureStage(
        "features",
        "jiko:dsp-v1",
        () => extractWavFeatures(wavPath, maxNormalizedAudioBytes()),
        input.signal
      ),
      captureStage(
        "stt",
        input.acceptedStreamingFinal?.transcript.provider ??
          process.env.STT_PROVIDER?.trim() ??
          "local:stt-unconfigured",
        () => input.acceptedStreamingFinal
          ? Promise.resolve({
              transcript: input.acceptedStreamingFinal.transcript,
              providerReceipt: input.acceptedStreamingFinal.providerReceipt,
              resourceSettlement: Promise.resolve()
            })
          : transcribeAudio({
              audioPath: wavPath,
              signal: input.signal,
              timeoutMs: remainingStageMs(input.sttDeadlineMs),
              remoteAudioConsent: input.remoteAudioConsent
            }),
        input.signal
      )
    ]);
    stageReceipts.push(featureRun.receipt, transcriptRun.receipt);
    if (!featureRun.ok) {
      throw featureRun.error;
    }
    if (!transcriptRun.ok) {
      throw transcriptRun.error;
    }

    const features = featureRun.value;
    const {
      transcript: rawTranscript,
      providerReceipt: sttProviderReceipt,
      resourceSettlement
    } = transcriptRun.value;
    providerSettlement = resourceSettlement;
    transcriptRun.receipt.provider = rawTranscript.provider;
    transcriptRun.receipt.status = transcriptStageStatus(rawTranscript);
    const enhancementRun = await captureStage(
      "enhance",
      "jiko-semantic-view-v1",
      async () => enhanceTranscript(rawTranscript),
      input.signal
    );
    stageReceipts.push(enhancementRun.receipt);
    if (!enhancementRun.ok) {
      throw enhancementRun.error;
    }

    const transcript = enhancementRun.value;
    const resolvedFeatures = withTranscriptFeatures(features, transcript);
    const language = transcript.language ?? guessLanguage(transcript.semanticText ?? transcript.text);
    const readingRun = await captureStage(
      "readings",
      "jiko:heuristic-v1",
      async () => {
        const readings = buildReadingsWithConfidence(transcript, language, resolvedFeatures);
        const result = buildResult(input.sessionId, readings);
        return { readings, result };
      },
      input.signal
    );
    stageReceipts.push(readingRun.receipt);
    if (!readingRun.ok) {
      throw readingRun.error;
    }

    const { readings, result } = readingRun.value;
    const pipeline = finishPipelineReceipt(
      pipelineStartedAt,
      pipelineStarted,
      stageReceipts,
      overallPipelineStatus(stageReceipts)
    );

    const settledAndCleaned = providerSettlement.finally(() =>
      rm(tempDir, { force: true, recursive: true })
    );
    cleanupTransferred = true;
    return {
      uploadedAudio,
      normalizedAudio: {
        ...normalization.value,
        durationMs: resolvedFeatures.durationMs
      },
      pipeline,
      sttProviderReceipt,
      transcript: {
        ...transcript,
        language
      },
      features: resolvedFeatures,
      readings,
      result,
      resourceSettlement: settledAndCleaned
    };
  } catch (error) {
    if (input.signal?.aborted) {
      throw abortReason(input.signal);
    }

    const pipeline = finishPipelineReceipt(
      pipelineStartedAt,
      pipelineStarted,
      stageReceipts,
      stageReceipts.some((stage) => stage.status === "timed_out") ? "timed_out" : "failed"
    );
    const message = error instanceof Error ? error.message : "Audio pipeline failed";
    throw new AudioPipelineError(message, pipeline);
  } finally {
    if (!cleanupTransferred) {
      await providerSettlement;
      await rm(tempDir, { force: true, recursive: true });
    }
  }
}

type CapturedStage<T> =
  | { ok: true; value: T; receipt: PipelineStageReceipt }
  | { ok: false; error: unknown; receipt: PipelineStageReceipt };

async function captureStage<T>(
  stage: Exclude<PipelineStageName, "total">,
  provider: string,
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<CapturedStage<T>> {
  const started = performance.now();

  try {
    throwIfAborted(signal);
    const value = await work();
    throwIfAborted(signal);
    return {
      ok: true,
      value,
      receipt: {
        stage,
        status: "ready",
        latencyMs: elapsedMs(started),
        provider
      }
    };
  } catch (error) {
    if (signal?.aborted) {
      throw abortReason(signal);
    }

    return {
      ok: false,
      error,
      receipt: {
        stage,
        status: error instanceof ProcessTimeoutError ? "timed_out" : "failed",
        latencyMs: elapsedMs(started),
        provider
      }
    };
  }
}

function finishPipelineReceipt(
  startedAt: string,
  started: number,
  stages: PipelineStageReceipt[],
  status: PipelineStageStatus
): PipelineReceipt {
  const totalLatencyMs = elapsedMs(started);

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalLatencyMs,
    stages: [
      ...stages,
      {
        stage: "total",
        status,
        latencyMs: totalLatencyMs,
        provider: "jiko:audio-pipeline-v1"
      }
    ]
  };
}

function overallPipelineStatus(stages: PipelineStageReceipt[]): PipelineStageStatus {
  if (stages.some((stage) => stage.status !== "ready")) {
    return "degraded";
  }

  return "ready";
}

function elapsedMs(started: number): number {
  return Number((performance.now() - started).toFixed(3));
}

function remainingStageMs(deadlineMs: number | undefined): number | undefined {
  return deadlineMs === undefined
    ? undefined
    : Math.max(0, deadlineMs - performance.now());
}

async function normalizeAudio(
  inputPath: string,
  outputPath: string,
  durationMs?: number,
  signal?: AbortSignal
): Promise<NormalizedAudio> {
  const startedAt = performance.now();
  const ffmpegBin = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
  const maxDurationMs = configuredMaxAudioDurationMs();
  const maxOutputBytes = maxNormalizedAudioBytes(maxDurationMs);

  await runProcess(
    ffmpegBin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-t",
      formatFfmpegSeconds(maxDurationMs),
      "-vn",
      "-map_metadata",
      "-1",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-sample_fmt",
      "s16",
      outputPath
    ],
    { timeoutMs: audioNormalizeTimeoutMs(), signal }
  );

  const output = await stat(outputPath);
  if (!output.isFile() || output.size > maxOutputBytes) {
    throw new Error(
      `Normalized audio exceeds the ${maxDurationMs} ms / ${maxOutputBytes} byte limit.`
    );
  }

  return {
    mediaType: "audio/wav",
    sampleRateHz: 16000,
    channelCount: 1,
    durationMs,
    latencyMs: elapsedMs(startedAt)
  };
}

export function configuredMaxAudioDurationMs(): number {
  const configured = process.env.JIKO_AUDIO_MAX_DURATION_MS;
  if (configured === undefined) {
    return defaultMaxAudioDurationMs;
  }
  const rawValue = configured.trim();
  const parsed = Number(rawValue);
  if (!rawValue || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("JIKO_AUDIO_MAX_DURATION_MS must be a positive safe integer");
  }
  return parsed;
}

export function maxNormalizedAudioBytes(
  maxDurationMs = configuredMaxAudioDurationMs()
): number {
  const pcmBytes = Math.ceil(
    (maxDurationMs / 1000) * normalizedPcmBytesPerSecond
  );
  const total = pcmBytes + normalizedContainerAllowanceBytes;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Configured normalized-audio byte ceiling is not a safe integer");
  }
  return total;
}

export function audioPipelineReservationBytes(bodyBytes: number): number {
  if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 0) {
    throw new Error("Audio pipeline body bytes must be a nonnegative safe integer");
  }
  const total = bodyBytes + maxNormalizedAudioBytes();
  if (!Number.isSafeInteger(total)) {
    throw new Error("Audio pipeline reservation is not a safe integer");
  }
  return total;
}

export function assertAudioPipelineConfiguration(): void {
  maxNormalizedAudioBytes();
}

function formatFfmpegSeconds(durationMs: number): string {
  return (durationMs / 1000).toFixed(3);
}

function buildReadingsWithConfidence(
  transcript: TranscriptResult,
  language: string,
  features: AudioFeatures
): Reading[] {
  const semanticText = transcript.semanticText ?? transcript.text;
  const readings = buildReadings(
    semanticText,
    language,
    features,
    transcript.confidence,
    "measured:audio",
    transcript.failureCode === undefined && semanticText.trim().length > 0
  );

  if (!features.digitalSilenceDetected) {
    return readings;
  }

  return readings.map((reading) => ({
    ...reading,
    availability: "unavailable",
    features: {
      ...reading.features,
      evidenceGate: "digital_silence"
    },
    privateReason: "Normalized PCM contains no non-zero samples; this reading is unavailable."
  }));
}

function transcriptStageStatus(transcript: TranscriptResult): PipelineStageStatus {
  if (transcript.failureCode === "provider_unavailable") {
    return "unavailable";
  }

  if (transcript.failureCode === "timed_out") {
    return "timed_out";
  }

  if (transcript.failureCode === "failed") {
    return "failed";
  }

  return "ready";
}

function audioNormalizeTimeoutMs(): number {
  const configured = Number(process.env.AUDIO_NORMALIZE_TIMEOUT_MS);

  if (!Number.isFinite(configured)) {
    return 15_000;
  }

  return Math.max(1_000, Math.min(90_000, Math.round(configured)));
}

function withTranscriptFeatures(features: AudioFeatures, transcript: TranscriptResult): AudioFeatures {
  const compactTextLength = transcript.text.replace(/\s/g, "").length;

  if (compactTextLength === 0 || features.digitalSilenceDetected) {
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Audio pipeline was cancelled");
}
