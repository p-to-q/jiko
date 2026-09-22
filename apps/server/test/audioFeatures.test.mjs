import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { extractWavFeatures } from "../dist/audioFeatures.js";

test("pitch extraction selects the fundamental instead of a subharmonic", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jiko-feature-test-"));
  const wavPath = path.join(dir, "tone.wav");

  try {
    await writeFile(wavPath, sineWav(220, 1_000));
    const features = await extractWavFeatures(wavPath);

    assert.equal(features.durationMs, 1_000);
    assert.ok(
      features.pitchMeanHz >= 215 && features.pitchMeanHz <= 225,
      `expected about 220 Hz, got ${features.pitchMeanHz}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("digital silence is exact PCM evidence rather than an energy threshold", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jiko-feature-silence-test-"));
  const silentPath = path.join(dir, "silent.wav");
  const nonZeroPath = path.join(dir, "non-zero.wav");

  try {
    await writeFile(silentPath, pcmWav(new Int16Array(16_000)));
    const nonZeroSamples = new Int16Array(16_000);
    nonZeroSamples[8_000] = 1;
    await writeFile(nonZeroPath, pcmWav(nonZeroSamples));

    const silent = await extractWavFeatures(silentPath);
    const nonZero = await extractWavFeatures(nonZeroPath);

    assert.equal(silent.digitalSilenceDetected, true);
    assert.equal(silent.speechMs, 0);
    assert.equal(nonZero.digitalSilenceDetected, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function sineWav(frequencyHz, durationMs, sampleRateHz = 16_000) {
  const sampleCount = Math.round((durationMs / 1_000) * sampleRateHz);
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRateHz);
    buffer.writeInt16LE(Math.round(sample * 12_000), 44 + index * 2);
  }

  return buffer;
}

function pcmWav(samples, sampleRateHz = 16_000) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }

  return buffer;
}
