import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectDiagnostics } from "../dist/diagnostics.js";
import { stopConfiguredSherpaSenseVoiceWorker } from "../dist/persistentSttWorker.js";

const fakeWorkerScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-stt-worker.mjs"
);

test("SenseVoice diagnostics prove loaded readiness and expose artifact identity", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-stt-readiness-"));
  const model = path.join(fixtureDir, "model.onnx");
  const tokens = path.join(fixtureDir, "tokens.txt");
  await Promise.all([
    writeFile(model, "fake model"),
    writeFile(tokens, "fake tokens")
  ]);
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "SHERPA_ONNX_PYTHON",
    "SHERPA_ONNX_WORKER_SCRIPT",
    "SHERPA_ONNX_SENSEVOICE_MODEL",
    "SHERPA_ONNX_SENSEVOICE_TOKENS",
    "FAKE_STT_PROVIDER_ID",
    "TTS_PROVIDER"
  ]);
  process.env.STT_PROVIDER = "sherpa-onnx";
  process.env.SHERPA_ONNX_PYTHON = process.execPath;
  process.env.SHERPA_ONNX_WORKER_SCRIPT = fakeWorkerScript;
  process.env.SHERPA_ONNX_SENSEVOICE_MODEL = model;
  process.env.SHERPA_ONNX_SENSEVOICE_TOKENS = tokens;
  process.env.FAKE_STT_PROVIDER_ID = "local:sherpa-onnx-sensevoice";
  delete process.env.TTS_PROVIDER;

  try {
    const first = await collectDiagnostics();
    const second = await collectDiagnostics();
    const stt = first.providers.stt;

    assert.equal(stt.status, "ready");
    assert.equal(stt.id, "local:sherpa-onnx-sensevoice");
    assert.equal(stt.readiness?.runtime.version, "1.0.0-test");
    assert.equal(stt.readiness?.artifacts.model.sha256, "a".repeat(64));
    assert.equal(stt.readiness?.artifacts.tokens.sha256, "b".repeat(64));
    assert.match(stt.detail || "", /sha256:aaaaaaaaaaaa/);
    assert.equal(
      second.providers.stt.readiness?.workerPid,
      stt.readiness?.workerPid,
      "health checks should observe the shared warm worker"
    );
  } finally {
    await stopConfiguredSherpaSenseVoiceWorker();
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("Deepgram diagnostics distinguish policy disabled, missing config, and configured without exposing the key", async () => {
  const environment = preserveEnvironment([
    "FFMPEG_BIN",
    "STT_PROVIDER",
    "JIKO_ALLOW_REMOTE_AUDIO",
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_ENDPOINT",
    "DEEPGRAM_MODEL",
    "DEEPGRAM_VERSION",
    "TTS_PROVIDER"
  ]);
  const secret = "diagnostic-secret-must-not-be-returned";
  process.env.FFMPEG_BIN = process.execPath;
  process.env.STT_PROVIDER = "deepgram";
  process.env.DEEPGRAM_API_KEY = secret;
  process.env.DEEPGRAM_ENDPOINT = "https://api.au.deepgram.com/v1/listen";
  delete process.env.TTS_PROVIDER;

  try {
    delete process.env.JIKO_ALLOW_REMOTE_AUDIO;
    const disabled = (await collectDiagnostics()).providers.stt;
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.id, "remote:deepgram-batch");

    process.env.JIKO_ALLOW_REMOTE_AUDIO = "1";
    delete process.env.DEEPGRAM_API_KEY;
    const missing = (await collectDiagnostics()).providers.stt;
    assert.equal(missing.status, "missing");
    assert.match(missing.detail || "", /DEEPGRAM_API_KEY/);

    process.env.DEEPGRAM_API_KEY = secret;
    process.env.DEEPGRAM_VERSION = "latest";
    const unpinned = (await collectDiagnostics()).providers.stt;
    assert.equal(unpinned.status, "missing");
    assert.match(unpinned.detail || "", /explicit pinned version/);

    process.env.DEEPGRAM_VERSION = "pinned-test-version";
    const configured = (await collectDiagnostics()).providers.stt;
    assert.equal(configured.status, "configured");
    assert.match(configured.detail || "", /pre-recorded batch/);
    assert.match(configured.detail || "", /region=au/);
    assert.match(configured.detail || "", /mip_opt_out=true/);
    assert.equal(JSON.stringify(configured).includes(secret), false);
  } finally {
    restoreEnvironment(environment);
  }
});

test("FunASR diagnostics identify self-hosted loopback and LAN boundaries", async () => {
  const environment = preserveEnvironment([
    "FFMPEG_BIN",
    "STT_PROVIDER",
    "FUNASR_ENDPOINT",
    "TTS_PROVIDER"
  ]);
  process.env.FFMPEG_BIN = process.execPath;
  process.env.STT_PROVIDER = "funasr";
  delete process.env.TTS_PROVIDER;

  try {
    process.env.FUNASR_ENDPOINT = "http://127.0.0.1:10095/v1/audio/transcriptions";
    const loopback = (await collectDiagnostics()).providers.stt;
    assert.equal(loopback.status, "configured");
    assert.equal(loopback.id, "self-hosted:funasr-http:loopback");
    assert.match(loopback.detail || "", /operator-managed self-hosted/);

    process.env.FUNASR_ENDPOINT = "http://192.168.4.20:10095/v1/audio/transcriptions";
    const lan = (await collectDiagnostics()).providers.stt;
    assert.equal(lan.status, "configured");
    assert.equal(lan.id, "self-hosted:funasr-http:lan");

    process.env.FUNASR_ENDPOINT = "https://funasr.example.com/v1/audio/transcriptions";
    const network = (await collectDiagnostics()).providers.stt;
    assert.equal(network.status, "missing");
    assert.equal(network.id, "self-hosted:funasr-http:network-blocked");
  } finally {
    restoreEnvironment(environment);
  }
});

test("ffmpeg diagnostics bound a hung probe and coalesce concurrent health checks", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-ffmpeg-health-"));
  const hangingProbe = path.join(fixtureDir, "hanging-ffmpeg.cjs");
  const countedProbe = path.join(fixtureDir, "counted-ffmpeg.cjs");
  const countFile = path.join(fixtureDir, "probe-count.txt");
  await Promise.all([
    writeFile(
      hangingProbe,
      "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n"
    ),
    writeFile(
      countedProbe,
      [
        "#!/bin/sh",
        `printf x >> ${JSON.stringify(countFile)}`,
        "printf 'ffmpeg version fake\\n'"
      ].join("\n")
    )
  ]);
  await Promise.all([chmod(hangingProbe, 0o755), chmod(countedProbe, 0o755)]);
  const environment = preserveEnvironment(["FFMPEG_BIN", "STT_PROVIDER", "TTS_PROVIDER"]);
  delete process.env.STT_PROVIDER;
  delete process.env.TTS_PROVIDER;

  try {
    process.env.FFMPEG_BIN = hangingProbe;
    const startedAt = performance.now();
    const hung = (await collectDiagnostics()).runtime.ffmpeg;
    assert.equal(hung.status, "missing");
    assert.match(hung.detail || "", /timed out after 1000 ms/);
    assert.ok(performance.now() - startedAt < 2_500);

    process.env.FFMPEG_BIN = countedProbe;
    const reports = await Promise.all(
      Array.from({ length: 8 }, () => collectDiagnostics())
    );
    assert.equal(reports.every((report) => report.runtime.ffmpeg.status === "ready"), true);
    assert.equal(await readFile(countFile, "utf8"), "x");
  } finally {
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("configured FunASR and Piper never satisfy strict readiness", async () => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-configured-health-"));
  const voice = path.join(fixtureDir, "voice.onnx");
  const ffmpegProbe = path.join(fixtureDir, "ready-ffmpeg.cjs");
  await Promise.all([
    writeFile(voice, "fake voice"),
    writeFile(ffmpegProbe, "#!/bin/sh\nprintf 'ffmpeg version fake\\n'\n")
  ]);
  await chmod(ffmpegProbe, 0o755);
  const environment = preserveEnvironment([
    "FFMPEG_BIN",
    "STT_PROVIDER",
    "FUNASR_ENDPOINT",
    "TTS_PROVIDER",
    "PIPER_VOICE"
  ]);
  process.env.FFMPEG_BIN = ffmpegProbe;
  process.env.STT_PROVIDER = "funasr";
  process.env.FUNASR_ENDPOINT = "http://127.0.0.1:10095/v1/audio/transcriptions";
  process.env.TTS_PROVIDER = "piper";
  process.env.PIPER_VOICE = voice;

  try {
    const diagnostics = await collectDiagnostics();
    assert.equal(diagnostics.providers.stt.status, "configured");
    assert.equal(diagnostics.providers.tts.status, "configured");
    assert.equal(diagnostics.strictReady, false);
    assert.deepEqual(
      diagnostics.strictBlocking.map(({ component, status }) => ({ component, status })),
      [
        { component: "providers.stt", status: "configured" },
        { component: "providers.tts", status: "configured" }
      ]
    );
  } finally {
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

function preserveEnvironment(names) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(environment) {
  for (const [name, value] of environment) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
