import { composeSessionResult } from "@jiko/core";
import type { AudioFeatures, Reading, SessionResult } from "@jiko/protocol";
import { runReadings } from "@jiko/readings";

export function buildMockFeatures(transcript: string): AudioFeatures {
  const compactLength = Math.max(1, transcript.replace(/\s/g, "").length);
  const hash = hashText(transcript);
  const punctuationPauses = (transcript.match(/[，,。.!?！？；;]/g) ?? []).length;
  const pauseCount = clampNumber(punctuationPauses + (hash % 2), 0, 5);
  const durationMs = clampNumber(1800 + compactLength * 88 + (hash % 900), 1600, 12000);
  const preSpeechDelayMs = 260 + (hash % 780);
  const longestPauseMs = pauseCount > 0 ? 360 + (hash % 760) : 0;
  const silenceMs = clampNumber(
    preSpeechDelayMs + pauseCount * 260 + Math.round(longestPauseMs * 0.35),
    250,
    durationMs - 500
  );
  const speechMs = Math.max(500, durationMs - silenceMs);

  return {
    durationMs,
    speechMs,
    silenceMs,
    preSpeechDelayMs,
    pauseCount,
    longestPauseMs,
    rmsMean: round(0.08 + (hash % 70) / 1000),
    rmsStd: round(0.018 + (hash % 32) / 1000),
    rmsPeak: round(0.28 + (hash % 42) / 100),
    pitchMeanHz: 145 + (hash % 86),
    pitchStdHz: 12 + (hash % 34),
    speechRateCharsPerSecond: round(compactLength / (speechMs / 1000))
  };
}

export function buildReadings(
  transcript: string,
  language: string,
  features: AudioFeatures
): Reading[] {
  return runReadings({
    text: {
      transcript,
      language,
      sttConfidence: 0.86
    },
    voice: {
      durationMs: features.durationMs,
      speechMs: features.speechMs,
      silenceMs: features.silenceMs,
      pauseCount: features.pauseCount,
      longestPauseMs: features.longestPauseMs,
      rmsMean: features.rmsMean,
      rmsStd: features.rmsStd,
      rmsPeak: features.rmsPeak,
      pitchMeanHz: features.pitchMeanHz,
      pitchStdHz: features.pitchStdHz,
      clipping: features.clippingDetected,
      noisy: features.noiseDetected
    },
    timing: {
      durationMs: features.durationMs,
      speechMs: features.speechMs,
      preSpeechDelayMs: features.preSpeechDelayMs,
      pauseCount: features.pauseCount,
      longestPauseMs: features.longestPauseMs
    }
  });
}

export function buildResult(sessionId: string, readings: Reading[]): SessionResult {
  return composeSessionResult({
    sessionId,
    readings,
    silenceMs: 3200
  });
}

function hashText(value: string): number {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

