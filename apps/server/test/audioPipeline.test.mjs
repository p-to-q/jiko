import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  audioPipelineReservationBytes,
  maxNormalizedAudioBytes,
  runAudioPipeline
} from "../dist/audioPipeline.js";
import { stopConfiguredSherpaSenseVoiceWorker } from "../dist/persistentSttWorker.js";

const fakeWorkerScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-stt-worker.mjs"
);

test("parent cancellation reaches ffmpeg and is not wrapped as a pipeline failure", async () => {
  const previousFfmpeg = process.env.FFMPEG_BIN;
  const previousMarker = process.env.JIKO_TEST_FFMPEG_MARKER;
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-cancel-test-"));
  const ffmpeg = path.join(fixtureDir, "blocking-ffmpeg.cjs");
  const marker = path.join(fixtureDir, "started");
  await writeFile(
    ffmpeg,
    [
      "#!/usr/bin/env node",
      "require('node:fs').writeFileSync(process.env.JIKO_TEST_FFMPEG_MARKER, 'started');",
      "setInterval(() => {}, 1000);"
    ].join("\n")
  );
  await chmod(ffmpeg, 0o755);
  process.env.FFMPEG_BIN = ffmpeg;
  process.env.JIKO_TEST_FFMPEG_MARKER = marker;

  const controller = new AbortController();
  const reason = new Error("attempt reset");
  const running = runAudioPipeline({
    sessionId: "cancel-normalization",
    source: "browser",
    mediaType: "audio/wav",
    body: Uint8Array.from([1, 2, 3, 4]),
    signal: controller.signal
  });
  void running.catch(() => undefined);

  try {
    await waitForFile(marker, 5_000);
    controller.abort(reason);
    await assert.rejects(running, (error) => error === reason);
  } finally {
    controller.abort(reason);
    await running.catch(() => undefined);
    restoreEnvironmentVariable("FFMPEG_BIN", previousFfmpeg);
    restoreEnvironmentVariable("JIKO_TEST_FFMPEG_MARKER", previousMarker);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("a soft STT cutoff preserves measured voice and timing evidence", async () => {
  const previousFfmpeg = process.env.FFMPEG_BIN;
  const previousProvider = process.env.STT_PROVIDER;
  const previousWhisperBin = process.env.WHISPER_CPP_BIN;
  const previousWhisperModel = process.env.WHISPER_MODEL;
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-partial-test-"));
  const ffmpeg = path.join(fixtureDir, "copy-ffmpeg.cjs");
  const whisper = path.join(fixtureDir, "blocking-whisper.cjs");
  await writeFile(
    ffmpeg,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "fs.copyFileSync(args[args.indexOf('-i') + 1], args.at(-1));"
    ].join("\n")
  );
  await writeFile(
    whisper,
    [
      "#!/usr/bin/env node",
      "process.on('SIGTERM', () => undefined);",
      "setInterval(() => {}, 1000);"
    ].join("\n")
  );
  await chmod(ffmpeg, 0o755);
  await chmod(whisper, 0o755);
  process.env.FFMPEG_BIN = ffmpeg;
  process.env.STT_PROVIDER = "whisper.cpp";
  process.env.WHISPER_CPP_BIN = whisper;
  process.env.WHISPER_MODEL = path.join(fixtureDir, "unused-model.bin");

  try {
    const result = await runAudioPipeline({
      sessionId: "partial-stt-timeout",
      source: "browser",
      mediaType: "audio/wav",
      body: sineWaveWav(400),
      durationMs: 400,
      sttDeadlineMs: performance.now() + 40
    });

    assert.equal(result.transcript.failureCode, "timed_out");
    assert.equal(
      result.pipeline.stages.find((stage) => stage.stage === "stt")?.status,
      "timed_out"
    );
    assert.equal(
      result.pipeline.stages.find((stage) => stage.stage === "total")?.status,
      "degraded"
    );
    assert.equal(result.result.coverage?.measured, 2);
    assert.deepEqual(result.result.coverage?.unavailableChannels, ["text"]);
    assert.equal(
      result.readings.find((reading) => reading.channel === "text")?.availability,
      "unavailable"
    );
    assert.equal(
      result.readings.find((reading) => reading.channel === "voice")?.availability,
      "measured"
    );
    assert.equal(
      result.readings.find((reading) => reading.channel === "timing")?.availability,
      "measured"
    );
    await result.resourceSettlement;
  } finally {
    restoreEnvironmentVariable("FFMPEG_BIN", previousFfmpeg);
    restoreEnvironmentVariable("STT_PROVIDER", previousProvider);
    restoreEnvironmentVariable("WHISPER_CPP_BIN", previousWhisperBin);
    restoreEnvironmentVariable("WHISPER_MODEL", previousWhisperModel);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("decoded audio has a hard duration-derived byte ceiling", async () => {
  const environment = preserveEnvironment([
    "FFMPEG_BIN",
    "JIKO_AUDIO_MAX_DURATION_MS",
    "STT_PROVIDER"
  ]);
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-decode-cap-test-"));
  const ffmpeg = path.join(fixtureDir, "oversize-ffmpeg.cjs");
  process.env.JIKO_AUDIO_MAX_DURATION_MS = "10";
  const ceiling = maxNormalizedAudioBytes();
  await writeFile(
    ffmpeg,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const output = process.argv.at(-1);",
      `fs.writeFileSync(output, Buffer.alloc(${ceiling + 1}));`
    ].join("\n")
  );
  await chmod(ffmpeg, 0o755);
  process.env.FFMPEG_BIN = ffmpeg;
  delete process.env.STT_PROVIDER;

  try {
    assert.equal(audioPipelineReservationBytes(100), 100 + ceiling);
    await assert.rejects(
      runAudioPipeline({
        sessionId: "decode-cap",
        source: "browser",
        mediaType: "audio/webm",
        body: Uint8Array.from([1, 2, 3, 4])
      }),
      /Normalized audio exceeds the 10 ms/
    );
    process.env.JIKO_AUDIO_MAX_DURATION_MS = "";
    assert.throws(() => maxNormalizedAudioBytes(), /positive safe integer/);
  } finally {
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("digital silence gates every reading without rewriting a completed STT receipt", async () => {
  const environment = preserveEnvironment([
    "FFMPEG_BIN",
    "STT_PROVIDER",
    "SHERPA_ONNX_PYTHON",
    "SHERPA_ONNX_WORKER_SCRIPT",
    "SHERPA_ONNX_SENSEVOICE_MODEL",
    "SHERPA_ONNX_SENSEVOICE_TOKENS",
    "FAKE_STT_PROVIDER_ID",
    "FAKE_STT_TRANSCRIPT",
    "FAKE_STT_LANGUAGE",
    "STT_TIMEOUT_MS"
  ]);
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-silence-gate-test-"));
  const ffmpeg = path.join(fixtureDir, "copy-ffmpeg.cjs");
  await writeFile(
    ffmpeg,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "fs.copyFileSync(args[args.indexOf('-i') + 1], args.at(-1));"
    ].join("\n")
  );
  await chmod(ffmpeg, 0o755);
  process.env.FFMPEG_BIN = ffmpeg;
  process.env.STT_PROVIDER = "sherpa-onnx";
  process.env.SHERPA_ONNX_PYTHON = process.execPath;
  process.env.SHERPA_ONNX_WORKER_SCRIPT = fakeWorkerScript;
  process.env.SHERPA_ONNX_SENSEVOICE_MODEL = "fake-model.onnx";
  process.env.SHERPA_ONNX_SENSEVOICE_TOKENS = "fake-tokens.txt";
  process.env.FAKE_STT_PROVIDER_ID = "local:sherpa-onnx-sensevoice";
  process.env.FAKE_STT_TRANSCRIPT = "嗯";
  process.env.FAKE_STT_LANGUAGE = "zh";
  process.env.STT_TIMEOUT_MS = "10000";

  try {
    const silent = await runAudioPipeline({
      sessionId: "digital-silence",
      source: "browser",
      mediaType: "audio/wav",
      body: pcm16Wav(new Int16Array(16_000)),
      durationMs: 1_000
    });

    assert.equal(silent.features.digitalSilenceDetected, true);
    assert.equal(silent.features.speechRateCharsPerSecond, undefined);
    assert.equal(silent.transcript.text, "嗯");
    assert.equal(silent.transcript.semanticText, "");
    assert.equal(silent.transcript.provider, "local:sherpa-onnx-sensevoice");
    assert.equal(silent.sttProviderReceipt.id, silent.transcript.provider);
    assert.equal(silent.sttProviderReceipt.outcome, "completed");
    assert.equal(
      silent.sttProviderReceipt.execution?.artifacts.model.sha256,
      "a".repeat(64)
    );
    assert.equal(
      silent.pipeline.stages.find((stage) => stage.stage === "stt")?.status,
      "ready"
    );
    assert.equal(
      silent.readings.every((reading) =>
        reading.availability === "unavailable" &&
        reading.features.evidenceGate === "digital_silence"
      ),
      true
    );
    assert.equal(silent.result.coverage?.measured, 0);
    assert.equal(silent.result.coverage?.unavailable, 3);
    assert.equal(silent.result.topWindow.status, "insufficient");
    assert.equal(silent.result.tts, undefined);

    const spokenFiller = await runAudioPipeline({
      sessionId: "spoken-filler",
      source: "browser",
      mediaType: "audio/wav",
      body: sineWaveWav(1_000),
      durationMs: 1_000
    });
    const textReading = spokenFiller.readings.find((reading) => reading.channel === "text");

    assert.equal(spokenFiller.features.digitalSilenceDetected, false);
    assert.equal(spokenFiller.transcript.semanticText, "");
    assert.equal(textReading?.availability, "unavailable");
    assert.equal(
      spokenFiller.readings
        .filter((reading) => reading.channel !== "text")
        .every((reading) => reading.availability === "measured"),
      true
    );
    assert.equal(spokenFiller.result.coverage?.measured, 2);
    assert.deepEqual(spokenFiller.result.coverage?.unavailableChannels, ["text"]);
    assert.equal(spokenFiller.result.topWindow.status, "partial");
    assert.equal(spokenFiller.result.tts, undefined);
  } finally {
    await stopConfiguredSherpaSenseVoiceWorker();
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("only an accepted streaming final can feed transcript enhancement and readings", async () => {
  const environment = preserveEnvironment(["FFMPEG_BIN", "STT_PROVIDER"]);
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-streaming-final-test-"));
  const ffmpeg = path.join(fixtureDir, "copy-ffmpeg.cjs");
  await writeFile(
    ffmpeg,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "fs.copyFileSync(args[args.indexOf('-i') + 1], args.at(-1));"
    ].join("\n")
  );
  await chmod(ffmpeg, 0o755);
  process.env.FFMPEG_BIN = ffmpeg;
  // This provider would be unavailable if the batch branch ran.
  process.env.STT_PROVIDER = "not-configured-for-this-test";

  try {
    const result = await runAudioPipeline({
      sessionId: "accepted-streaming-final",
      source: "browser",
      mediaType: "audio/wav",
      body: sineWaveWav(400),
      durationMs: 400,
      acceptedStreamingFinal: {
        identity: {
          sessionId: "accepted-streaming-final",
          attemptId: "attempt",
          sourceId: "source",
          audioProfileHash: "a".repeat(64)
        },
        finalSequence: 1,
        transcript: {
          text: "I should not leave yet",
          language: "en",
          provider: "local:fake-streaming-stt",
          latencyMs: 25
        },
        providerReceipt: {
          id: "local:fake-streaming-stt",
          latencyMs: 25,
          remote: false,
          outcome: "completed"
        },
        partialRevisionCount: 1,
        pushedChunkCount: 1,
        pushedByteCount: 2,
        queueHighWaterBytes: 2,
        openedAtMs: 0,
        finishedAtMs: 25
      }
    });

    assert.equal(result.transcript.text, "I should not leave yet");
    assert.equal(result.sttProviderReceipt.id, "local:fake-streaming-stt");
    assert.equal(result.sttProviderReceipt.outcome, "completed");
    assert.equal(
      result.pipeline.stages.find((stage) => stage.stage === "stt")?.provider,
      "local:fake-streaming-stt"
    );
    assert.equal(
      result.readings.find((reading) => reading.channel === "text")?.availability,
      "measured"
    );
  } finally {
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

async function waitForFile(filePath, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  throw new Error(`Timed out waiting for ${filePath}`);
}

function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function preserveEnvironment(names) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(environment) {
  for (const [name, value] of environment) {
    restoreEnvironmentVariable(name, value);
  }
}

function sineWaveWav(durationMs, sampleRateHz = 16000) {
  const sampleCount = Math.round((durationMs / 1000) * sampleRateHz);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
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
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 220 * index) / sampleRateHz) * 6000);
    buffer.writeInt16LE(sample, 44 + index * 2);
  }
  return buffer;
}

function pcm16Wav(samples, sampleRateHz = 16_000) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
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
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }
  return buffer;
}
