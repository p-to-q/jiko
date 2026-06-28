import { readFile } from "node:fs/promises";
import type { AudioFeatures } from "@jiko/protocol";

type WavData = {
  samples: Int16Array;
  sampleRateHz: number;
};

const sampleMax = 32768;
const frameMs = 25;
const pitchFrameMs = 60;
const silenceThreshold = 0.015;
const speechThreshold = 0.026;
const minPauseMs = 220;
const minPitchHz = 60;
const maxPitchHz = 500;
const minPitchCorrelation = 0.35;

export async function extractWavFeatures(path: string): Promise<AudioFeatures> {
  const wav = parsePcm16MonoWav(await readFile(path));
  const frameSize = Math.max(1, Math.round((wav.sampleRateHz * frameMs) / 1000));
  const pitchFrameSize = Math.max(1, Math.round((wav.sampleRateHz * pitchFrameMs) / 1000));
  const frameRms = collectFrameRms(wav.samples, frameSize);
  const durationMs = Math.round((wav.samples.length / wav.sampleRateHz) * 1000);
  const rmsMean = mean(frameRms);
  const rmsStd = standardDeviation(frameRms, rmsMean);
  const rmsPeak = frameRms.reduce((peak, value) => Math.max(peak, value), 0);
  const speechFlags = frameRms.map((value) => value >= speechThreshold);
  const silenceFlags = frameRms.map((value) => value <= silenceThreshold);
  const speechFrameCount = speechFlags.filter(Boolean).length;
  const silenceFrameCount = silenceFlags.filter(Boolean).length;
  const pauseRuns = collectPauseRuns(speechFlags, frameMs, minPauseMs);
  const firstSpeechFrame = speechFlags.findIndex(Boolean);
  const clippedSamples = countClippedSamples(wav.samples);
  const pitchValues = collectPitchValues(wav.samples, wav.sampleRateHz, pitchFrameSize);
  const pitchMeanHz = pitchValues.length ? mean(pitchValues) : undefined;

  return {
    durationMs,
    speechMs: clampMs(speechFrameCount * frameMs, durationMs),
    silenceMs: clampMs(silenceFrameCount * frameMs, durationMs),
    preSpeechDelayMs: firstSpeechFrame >= 0 ? clampMs(firstSpeechFrame * frameMs, durationMs) : durationMs,
    pauseCount: pauseRuns.length,
    longestPauseMs: pauseRuns.reduce((longest, value) => Math.max(longest, value), 0),
    rmsMean: round(rmsMean),
    rmsStd: round(rmsStd),
    rmsPeak: round(rmsPeak),
    pitchMeanHz: pitchMeanHz === undefined ? undefined : round(pitchMeanHz),
    pitchStdHz: pitchMeanHz === undefined ? undefined : round(standardDeviation(pitchValues, pitchMeanHz)),
    clippingDetected: clippedSamples > Math.max(12, wav.samples.length * 0.001),
    noiseDetected: rmsMean > 0 && rmsMean < 0.006 && rmsPeak > 0.08
  };
}

function parsePcm16MonoWav(buffer: Buffer): WavData {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected RIFF/WAVE audio after normalization.");
  }

  let offset = 12;
  let audioFormat: number | undefined;
  let channelCount: number | undefined;
  let sampleRateHz: number | undefined;
  let bitsPerSample: number | undefined;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      audioFormat = buffer.readUInt16LE(chunkStart);
      channelCount = buffer.readUInt16LE(chunkStart + 2);
      sampleRateHz = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    }

    if (chunkId === "data") {
      dataStart = chunkStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || channelCount !== 1 || bitsPerSample !== 16 || !sampleRateHz || dataStart < 0) {
    throw new Error("Expected PCM 16-bit mono WAV after normalization.");
  }

  const sampleCount = Math.floor(dataSize / 2);
  const samples = new Int16Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(dataStart + index * 2);
  }

  return {
    samples,
    sampleRateHz
  };
}

function collectFrameRms(samples: Int16Array, frameSize: number): number[] {
  const values: number[] = [];

  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let sumSquares = 0;

    for (let index = start; index < end; index += 1) {
      const normalized = samples[index] / sampleMax;
      sumSquares += normalized * normalized;
    }

    values.push(Math.sqrt(sumSquares / Math.max(1, end - start)));
  }

  return values.length > 0 ? values : [0];
}

function collectPauseRuns(speechFlags: boolean[], frameDurationMs: number, minDurationMs: number): number[] {
  const pauses: number[] = [];
  const firstSpeech = speechFlags.findIndex(Boolean);
  const lastSpeech = findLastIndex(speechFlags, true);

  if (firstSpeech < 0 || lastSpeech <= firstSpeech) {
    return pauses;
  }

  let runFrames = 0;

  for (let index = firstSpeech; index <= lastSpeech; index += 1) {
    if (!speechFlags[index]) {
      runFrames += 1;
      continue;
    }

    const runMs = runFrames * frameDurationMs;
    if (runMs >= minDurationMs) {
      pauses.push(runMs);
    }
    runFrames = 0;
  }

  return pauses;
}

function findLastIndex(values: boolean[], target: boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] === target) {
      return index;
    }
  }

  return -1;
}

function countClippedSamples(samples: Int16Array): number {
  let count = 0;

  for (const sample of samples) {
    if (Math.abs(sample) >= 32700) {
      count += 1;
    }
  }

  return count;
}

function collectPitchValues(
  samples: Int16Array,
  sampleRateHz: number,
  frameSize: number
): number[] {
  const values: number[] = [];

  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    const rms = frameRms(samples, start, end);

    if (rms < speechThreshold) {
      continue;
    }

    const pitch = estimateFramePitch(samples, start, end, sampleRateHz);

    if (pitch !== undefined) {
      values.push(pitch);
    }
  }

  return values;
}

function frameRms(samples: Int16Array, start: number, end: number): number {
  let sumSquares = 0;

  for (let index = start; index < end; index += 1) {
    const normalized = samples[index] / sampleMax;
    sumSquares += normalized * normalized;
  }

  return Math.sqrt(sumSquares / Math.max(1, end - start));
}

function estimateFramePitch(
  samples: Int16Array,
  start: number,
  end: number,
  sampleRateHz: number
): number | undefined {
  const length = end - start;

  if (length < 32) {
    return undefined;
  }

  const minLag = Math.max(1, Math.floor(sampleRateHz / maxPitchHz));
  const maxLag = Math.min(length - 1, Math.ceil(sampleRateHz / minPitchHz));
  let bestLag = 0;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;

    for (let index = start; index < end - lag; index += 1) {
      const a = samples[index] / sampleMax;
      const b = samples[index + lag] / sampleMax;
      sum += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(energyA * energyB);
    const correlation = denominator > 0 ? sum / denominator : 0;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestLag === 0 || bestCorrelation < minPitchCorrelation) {
    return undefined;
  }

  return sampleRateHz / bestLag;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function standardDeviation(values: number[], average: number): number {
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length);

  return Math.sqrt(variance);
}

function clampMs(value: number, max: number): number {
  return Math.max(0, Math.min(Math.round(value), max));
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
