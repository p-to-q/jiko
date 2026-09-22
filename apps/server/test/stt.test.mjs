import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getConfiguredSherpaSenseVoiceWorker,
  stopConfiguredSherpaSenseVoiceWorker
} from "../dist/persistentSttWorker.js";
import {
  describeFunAsrEndpoint,
  transcribeLocalAudio
} from "../dist/stt.js";

const fakeWorkerScript = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-stt-worker.mjs"
);

test("unconfigured local STT returns an explicit unavailable result", async () => {
  const previousProvider = process.env.STT_PROVIDER;
  delete process.env.STT_PROVIDER;

  try {
    const { transcript, providerReceipt } = await transcribeLocalAudio({
      audioPath: "/not-read-by-unconfigured-provider.wav"
    });

    assert.equal(transcript.text, "");
    assert.equal(transcript.provider, "local:stt-unconfigured:unavailable");
    assert.equal(transcript.failureCode, "provider_unavailable");
    assert.equal(transcript.confidence, undefined);
    assert.equal(providerReceipt.outcome, "provider_unavailable");
    assert.equal(providerReceipt.execution, undefined);
  } finally {
    if (previousProvider === undefined) {
      delete process.env.STT_PROVIDER;
    } else {
      process.env.STT_PROVIDER = previousProvider;
    }
  }
});

test("configured SenseVoice paths are not treated as loaded model identity", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "SHERPA_ONNX_SENSEVOICE_MODEL",
    "SHERPA_ONNX_SENSEVOICE_TOKENS"
  ]);
  process.env.STT_PROVIDER = "sherpa-onnx";
  process.env.SHERPA_ONNX_SENSEVOICE_MODEL = "configured-only.onnx";
  delete process.env.SHERPA_ONNX_SENSEVOICE_TOKENS;

  try {
    const result = await transcribeLocalAudio({ audioPath: "unused.wav" });

    assert.equal(result.transcript.failureCode, "provider_unavailable");
    assert.equal(result.providerReceipt.outcome, "provider_unavailable");
    assert.equal(result.providerReceipt.execution, undefined);
  } finally {
    await stopConfiguredSherpaSenseVoiceWorker();
    restoreEnvironment(environment);
  }
});

test("parent cancellation is rethrown instead of becoming provider unavailable", async () => {
  const previousProvider = process.env.STT_PROVIDER;
  delete process.env.STT_PROVIDER;
  const controller = new AbortController();
  const reason = new Error("attempt reset");
  controller.abort(reason);

  try {
    await assert.rejects(
      transcribeLocalAudio({
        audioPath: "/not-read-by-cancelled-provider.wav",
        signal: controller.signal
      }),
      (error) => error === reason
    );
  } finally {
    if (previousProvider === undefined) {
      delete process.env.STT_PROVIDER;
    } else {
      process.env.STT_PROVIDER = previousProvider;
    }
  }
});

test("an attempt STT budget returns timed_out without waiting for a slow CLI", async () => {
  const previousProvider = process.env.STT_PROVIDER;
  const previousBin = process.env.WHISPER_CPP_BIN;
  const previousModel = process.env.WHISPER_MODEL;
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-stt-budget-"));
  const blockingCli = path.join(fixtureDir, "blocking-stt.cjs");
  await writeFile(
    blockingCli,
    [
      "#!/usr/bin/env node",
      "process.on('SIGTERM', () => undefined);",
      "setInterval(() => {}, 1000);"
    ].join("\n")
  );
  await chmod(blockingCli, 0o755);
  process.env.STT_PROVIDER = "whisper.cpp";
  process.env.WHISPER_CPP_BIN = blockingCli;
  process.env.WHISPER_MODEL = path.join(fixtureDir, "unused-model.bin");

  try {
    const startedAt = performance.now();
    const { transcript, providerReceipt, resourceSettlement } = await transcribeLocalAudio({
      audioPath: path.join(fixtureDir, "unused.wav"),
      timeoutMs: 30
    });

    assert.equal(transcript.text, "");
    assert.equal(transcript.failureCode, "timed_out");
    assert.equal(transcript.provider, "local:whisper.cpp:timed_out");
    assert.equal(providerReceipt.outcome, "timed_out");
    assert.equal(providerReceipt.execution, undefined);
    assert.ok(
      performance.now() - startedAt < 500,
      "the provider promise should be detached at the soft STT cutoff"
    );
    await resourceSettlement;
  } finally {
    restoreEnvironmentVariable("STT_PROVIDER", previousProvider);
    restoreEnvironmentVariable("WHISPER_CPP_BIN", previousBin);
    restoreEnvironmentVariable("WHISPER_MODEL", previousModel);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("SenseVoice requests reuse the process-wide ready worker", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "SHERPA_ONNX_PYTHON",
    "SHERPA_ONNX_WORKER_SCRIPT",
    "SHERPA_ONNX_SENSEVOICE_MODEL",
    "SHERPA_ONNX_SENSEVOICE_TOKENS",
    "FAKE_STT_PROVIDER_ID",
    "STT_TIMEOUT_MS"
  ]);
  process.env.STT_PROVIDER = "sherpa-onnx";
  process.env.SHERPA_ONNX_PYTHON = process.execPath;
  process.env.SHERPA_ONNX_WORKER_SCRIPT = fakeWorkerScript;
  process.env.SHERPA_ONNX_SENSEVOICE_MODEL = "fake-model.onnx";
  process.env.SHERPA_ONNX_SENSEVOICE_TOKENS = "fake-tokens.txt";
  process.env.FAKE_STT_PROVIDER_ID = "local:sherpa-onnx-sensevoice";
  process.env.STT_TIMEOUT_MS = "10000";

  try {
    const firstRun = await transcribeLocalAudio({ audioPath: "first.wav" });
    const secondRun = await transcribeLocalAudio({ audioPath: "second.wav" });
    const first = firstRun.transcript;
    const second = secondRun.transcript;

    assert.equal(first.text, "fake transcript 1");
    assert.equal(second.text, "fake transcript 2");
    assert.equal(first.provider, "local:sherpa-onnx-sensevoice");
    assert.equal(second.provider, "local:sherpa-onnx-sensevoice");
    assert.equal(first.confidence, undefined);
    assert.equal(second.confidence, undefined);
    assert.equal(firstRun.providerReceipt.outcome, "completed");
    assert.equal(
      firstRun.providerReceipt.execution?.runtime.version,
      "1.0.0-test"
    );
    assert.deepEqual(
      firstRun.providerReceipt.execution,
      secondRun.providerReceipt.execution
    );
    assert.equal(
      firstRun.providerReceipt.execution?.artifacts.model.sha256,
      "a".repeat(64)
    );
    assert.equal(
      firstRun.providerReceipt.execution?.artifacts.model.bytes,
      123
    );
    assert.equal(
      firstRun.providerReceipt.execution?.artifacts.tokens.sha256,
      "b".repeat(64)
    );
  } finally {
    await stopConfiguredSherpaSenseVoiceWorker();
    restoreEnvironment(environment);
  }
});

test("SenseVoice soft timeout stops the active worker without delaying fallback", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "SHERPA_ONNX_PYTHON",
    "SHERPA_ONNX_WORKER_SCRIPT",
    "SHERPA_ONNX_SENSEVOICE_MODEL",
    "SHERPA_ONNX_SENSEVOICE_TOKENS",
    "FAKE_STT_PROVIDER_ID",
    "STT_TIMEOUT_MS"
  ]);
  process.env.STT_PROVIDER = "sherpa-onnx";
  process.env.SHERPA_ONNX_PYTHON = process.execPath;
  process.env.SHERPA_ONNX_WORKER_SCRIPT = fakeWorkerScript;
  process.env.SHERPA_ONNX_SENSEVOICE_MODEL = "fake-model.onnx";
  process.env.SHERPA_ONNX_SENSEVOICE_TOKENS = "fake-tokens.txt";
  process.env.FAKE_STT_PROVIDER_ID = "local:sherpa-onnx-sensevoice";
  process.env.STT_TIMEOUT_MS = "10000";

  try {
    await getConfiguredSherpaSenseVoiceWorker().start();
    const startedAt = performance.now();
    const timedOutRun = await transcribeLocalAudio({
      audioPath: "hang.wav",
      timeoutMs: 30
    });
    const timedOut = timedOutRun.transcript;

    assert.equal(timedOut.text, "");
    assert.equal(timedOut.failureCode, "timed_out");
    assert.equal(timedOut.provider, "local:sherpa-onnx-sensevoice:timed_out");
    assert.equal(timedOutRun.providerReceipt.outcome, "timed_out");
    assert.equal(
      timedOutRun.providerReceipt.execution?.artifacts.model.sha256,
      "a".repeat(64)
    );
    assert.ok(performance.now() - startedAt < 500);
    await timedOutRun.resourceSettlement;

    const retry = await transcribeLocalAudio({ audioPath: "retry.wav" });
    assert.equal(retry.transcript.text, "fake transcript 1");
  } finally {
    await stopConfiguredSherpaSenseVoiceWorker();
    restoreEnvironment(environment);
  }
});

test("SenseVoice failure keeps only loaded worker identity, never configured-path guesses", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "SHERPA_ONNX_PYTHON",
    "SHERPA_ONNX_WORKER_SCRIPT",
    "SHERPA_ONNX_SENSEVOICE_MODEL",
    "SHERPA_ONNX_SENSEVOICE_TOKENS",
    "FAKE_STT_PROVIDER_ID",
    "STT_TIMEOUT_MS"
  ]);
  process.env.STT_PROVIDER = "sherpa-onnx";
  process.env.SHERPA_ONNX_PYTHON = process.execPath;
  process.env.SHERPA_ONNX_WORKER_SCRIPT = fakeWorkerScript;
  process.env.SHERPA_ONNX_SENSEVOICE_MODEL = "configured-name-is-not-proof.onnx";
  process.env.SHERPA_ONNX_SENSEVOICE_TOKENS = "configured-name-is-not-proof.txt";
  process.env.FAKE_STT_PROVIDER_ID = "local:sherpa-onnx-sensevoice";
  process.env.STT_TIMEOUT_MS = "10000";

  try {
    const failed = await transcribeLocalAudio({ audioPath: "crash.wav" });

    assert.equal(failed.transcript.failureCode, "failed");
    assert.equal(failed.providerReceipt.outcome, "failed");
    assert.equal(
      failed.providerReceipt.execution?.artifacts.model.name,
      "fake-model.onnx"
    );
    assert.notEqual(
      failed.providerReceipt.execution?.artifacts.model.name,
      process.env.SHERPA_ONNX_SENSEVOICE_MODEL
    );
  } finally {
    await stopConfiguredSherpaSenseVoiceWorker();
    restoreEnvironment(environment);
  }
});

test("Deepgram sends nothing unless both global policy and this request grant consent", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "JIKO_ALLOW_REMOTE_AUDIO",
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_ENDPOINT",
    "DEEPGRAM_MODEL",
    "DEEPGRAM_VERSION",
    "DEEPGRAM_LANGUAGE"
  ]);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called");
  };
  process.env.STT_PROVIDER = "deepgram";
  process.env.DEEPGRAM_API_KEY = "test-secret-never-sent";
  process.env.DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";
  process.env.DEEPGRAM_VERSION = "pinned-test-version";

  try {
    delete process.env.JIKO_ALLOW_REMOTE_AUDIO;
    const policyBlocked = await transcribeLocalAudio({
      audioPath: "/synthetic-audio-is-not-read.wav",
      remoteAudioConsent: "deepgram"
    });
    assert.equal(policyBlocked.transcript.failureCode, "provider_unavailable");
    assert.equal(policyBlocked.providerReceipt.remote, true);
    assert.equal(policyBlocked.providerReceipt.remoteExecution, undefined);

    process.env.JIKO_ALLOW_REMOTE_AUDIO = "1";
    const consentBlocked = await transcribeLocalAudio({
      audioPath: "/synthetic-audio-is-still-not-read.wav"
    });
    assert.equal(consentBlocked.transcript.failureCode, "provider_unavailable");
    assert.equal(consentBlocked.providerReceipt.remote, true);
    assert.equal(consentBlocked.providerReceipt.remoteExecution, undefined);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment(environment);
  }
});

test("Deepgram batch request forces MIP opt-out and records response identity without the key", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "JIKO_ALLOW_REMOTE_AUDIO",
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_ENDPOINT",
    "DEEPGRAM_MODEL",
    "DEEPGRAM_VERSION",
    "DEEPGRAM_LANGUAGE"
  ]);
  const previousFetch = globalThis.fetch;
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-deepgram-test-"));
  const audioPath = path.join(fixtureDir, "synthetic.wav");
  const syntheticBytes = Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0]);
  await writeFile(audioPath, syntheticBytes);
  const secret = "deepgram-test-key-must-not-enter-receipt";
  let captured;

  process.env.STT_PROVIDER = "deepgram";
  process.env.JIKO_ALLOW_REMOTE_AUDIO = "1";
  process.env.DEEPGRAM_API_KEY = secret;
  process.env.DEEPGRAM_ENDPOINT = "https://api.eu.deepgram.com/v1/listen";
  process.env.DEEPGRAM_MODEL = "nova-3";
  process.env.DEEPGRAM_VERSION = "2026-08-06.1";
  process.env.DEEPGRAM_LANGUAGE = "multi";
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return {
          metadata: {
            request_id: "dg-request-001",
            models: ["dg-model-uuid"],
            model_info: {
              "dg-model-uuid": {
                name: "nova-3",
                version: "2026-08-06.1",
                arch: "nova-3"
              }
            }
          },
          results: {
            channels: [{
              detected_language: "zh",
              alternatives: [{ transcript: "这是合成测试。", confidence: 0.91 }]
            }]
          }
        };
      },
      async text() {
        return "";
      }
    };
  };

  try {
    const result = await transcribeLocalAudio({
      audioPath,
      remoteAudioConsent: "deepgram"
    });
    const requestUrl = new URL(captured.url);

    assert.equal(requestUrl.protocol, "https:");
    assert.equal(requestUrl.searchParams.get("mip_opt_out"), "true");
    assert.equal(requestUrl.searchParams.get("model"), "nova-3");
    assert.equal(requestUrl.searchParams.get("version"), "2026-08-06.1");
    assert.equal(requestUrl.searchParams.get("language"), "multi");
    assert.equal(captured.init.headers.Authorization, `Token ${secret}`);
    assert.equal(captured.init.redirect, "error");
    assert.deepEqual([...captured.init.body], [...syntheticBytes]);
    assert.equal(result.transcript.provider, "remote:deepgram-batch");
    assert.equal(result.transcript.text, "这是合成测试。");
    assert.equal(result.providerReceipt.remote, true);
    assert.equal(result.providerReceipt.outcome, "completed");
    assert.deepEqual(result.providerReceipt.remoteExecution, {
      provider: "deepgram",
      model: "nova-3",
      version: "2026-08-06.1",
      resolvedModel: "nova-3",
      resolvedVersion: "2026-08-06.1",
      region: "eu",
      mode: "batch",
      trustBoundary: "deepgram_api",
      endpointOrigin: "https://api.eu.deepgram.com",
      requestId: "dg-request-001",
      mipOptOut: true
    });
    assert.equal(JSON.stringify(result.providerReceipt).includes(secret), false);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("Deepgram rejects non-HTTPS endpoints and never falls back to a local provider", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "JIKO_ALLOW_REMOTE_AUDIO",
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_ENDPOINT",
    "DEEPGRAM_VERSION"
  ]);
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch must not be called");
  };
  process.env.STT_PROVIDER = "deepgram";
  process.env.JIKO_ALLOW_REMOTE_AUDIO = "1";
  process.env.DEEPGRAM_API_KEY = "unused-test-key";
  process.env.DEEPGRAM_ENDPOINT = "http://api.deepgram.com/v1/listen";
  process.env.DEEPGRAM_VERSION = "pinned-test-version";

  try {
    const result = await transcribeLocalAudio({
      audioPath: "/synthetic-audio-is-not-read.wav",
      remoteAudioConsent: "deepgram"
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result.transcript.provider, "remote:deepgram-batch:unavailable");
    assert.equal(result.transcript.failureCode, "provider_unavailable");
    assert.equal(result.providerReceipt.outcome, "provider_unavailable");
    assert.equal(result.providerReceipt.remote, true);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment(environment);
  }
});

test("Deepgram HTTP failure stays a typed remote failure with no silent local retry", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "JIKO_ALLOW_REMOTE_AUDIO",
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_ENDPOINT",
    "DEEPGRAM_VERSION"
  ]);
  const previousFetch = globalThis.fetch;
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-deepgram-failure-"));
  const audioPath = path.join(fixtureDir, "synthetic.wav");
  await writeFile(audioPath, Uint8Array.from([0, 1, 2, 3]));
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      async json() {
        return {};
      },
      async text() {
        return "response body is deliberately ignored";
      }
    };
  };
  process.env.STT_PROVIDER = "deepgram";
  process.env.JIKO_ALLOW_REMOTE_AUDIO = "1";
  process.env.DEEPGRAM_API_KEY = "unused-test-key";
  process.env.DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";
  process.env.DEEPGRAM_VERSION = "pinned-test-version";

  try {
    const result = await transcribeLocalAudio({
      audioPath,
      remoteAudioConsent: "deepgram"
    });

    assert.equal(fetchCalls, 1);
    assert.equal(result.transcript.provider, "remote:deepgram-batch:failed");
    assert.equal(result.transcript.failureCode, "failed");
    assert.equal(result.providerReceipt.outcome, "failed");
    assert.equal(result.providerReceipt.remoteExecution?.requestId, undefined);
    assert.equal(result.providerReceipt.remoteExecution?.mipOptOut, true);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("Deepgram preserves parent cancellation and STT deadline semantics", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "STT_TIMEOUT_MS",
    "JIKO_ALLOW_REMOTE_AUDIO",
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_ENDPOINT",
    "DEEPGRAM_VERSION"
  ]);
  const previousFetch = globalThis.fetch;
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-deepgram-abort-"));
  const audioPath = path.join(fixtureDir, "synthetic.wav");
  await writeFile(audioPath, Uint8Array.from([0, 1, 2, 3]));
  process.env.STT_PROVIDER = "deepgram";
  process.env.STT_TIMEOUT_MS = "1000";
  process.env.JIKO_ALLOW_REMOTE_AUDIO = "1";
  process.env.DEEPGRAM_API_KEY = "unused-test-key";
  process.env.DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";
  process.env.DEEPGRAM_VERSION = "pinned-test-version";

  try {
    let markCancellationFetchStarted;
    const cancellationFetchStarted = new Promise((resolve) => {
      markCancellationFetchStarted = resolve;
    });
    globalThis.fetch = (_url, init) => {
      markCancellationFetchStarted();
      return abortablePendingResponse(init.signal);
    };
    const controller = new AbortController();
    const cancellationReason = new Error("attempt reset");
    const cancelled = transcribeLocalAudio({
      audioPath,
      signal: controller.signal,
      remoteAudioConsent: "deepgram"
    });
    await cancellationFetchStarted;
    controller.abort(cancellationReason);
    await assert.rejects(cancelled, (error) => error === cancellationReason);

    let deadlineFetchCalls = 0;
    globalThis.fetch = (_url, init) => {
      deadlineFetchCalls += 1;
      return abortablePendingResponse(init.signal);
    };
    const timedOut = await transcribeLocalAudio({
      audioPath,
      timeoutMs: 30,
      remoteAudioConsent: "deepgram"
    });

    assert.ok(
      deadlineFetchCalls <= 1,
      "the deadline may expire before fetch, but must never cause a retry"
    );
    assert.equal(timedOut.transcript.failureCode, "timed_out");
    assert.equal(timedOut.transcript.provider, "remote:deepgram-batch:timed_out");
    assert.equal(timedOut.providerReceipt.outcome, "timed_out");
    assert.equal(timedOut.providerReceipt.remote, true);
    assert.equal(timedOut.providerReceipt.remoteExecution?.requestId, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("FunASR endpoint scope trusts only numeric loopback and private IP literals", () => {
  const cases = [
    ["http://127.0.0.1:10095/v1/audio/transcriptions", "loopback"],
    ["http://127.255.1.2:10095/v1/audio/transcriptions", "loopback"],
    ["http://10.1.2.3:10095/v1/audio/transcriptions", "lan"],
    ["http://172.16.0.1:10095/v1/audio/transcriptions", "lan"],
    ["http://172.31.255.254:10095/v1/audio/transcriptions", "lan"],
    ["http://192.168.10.8:10095/v1/audio/transcriptions", "lan"],
    ["http://[::1]:10095/v1/audio/transcriptions", "loopback"],
    ["http://[fc00::1]:10095/v1/audio/transcriptions", "lan"],
    ["http://[fdff:1234::1]:10095/v1/audio/transcriptions", "lan"],
    ["http://172.32.0.1:10095/v1/audio/transcriptions", "network"],
    ["http://[fe80::1]:10095/v1/audio/transcriptions", "network"],
    ["http://127.1:10095/v1/audio/transcriptions", "network"],
    ["http://2130706433:10095/v1/audio/transcriptions", "network"],
    ["http://0x7f000001:10095/v1/audio/transcriptions", "network"],
    ["http://localhost:10095/v1/audio/transcriptions", "network"],
    ["https://fd.example.com/v1/audio/transcriptions", "network"],
    ["https://fc00.example.com/v1/audio/transcriptions", "network"],
    ["https://203.0.113.10/v1/audio/transcriptions", "network"]
  ];

  for (const [endpoint, expectedScope] of cases) {
    assert.equal(
      describeFunAsrEndpoint(endpoint)?.scope,
      expectedScope,
      endpoint
    );
  }
});

test("FunASR allows self-hosted loopback without redirects and blocks public or DNS endpoints", async () => {
  const environment = preserveEnvironment([
    "STT_PROVIDER",
    "FUNASR_ENDPOINT",
    "FUNASR_MODEL",
    "FUNASR_LANGUAGE"
  ]);
  const previousFetch = globalThis.fetch;
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "jiko-funasr-test-"));
  const audioPath = path.join(fixtureDir, "synthetic.wav");
  await writeFile(audioPath, Uint8Array.from([0, 1, 2, 3]));
  let fetchCalls = 0;
  let fetchInit;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    fetchInit = init;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return { text: "synthetic fixture" };
      },
      async text() {
        return "";
      }
    };
  };
  process.env.STT_PROVIDER = "funasr";
  process.env.FUNASR_ENDPOINT = "http://127.0.0.1:10095/v1/audio/transcriptions";

  try {
    const result = await transcribeLocalAudio({ audioPath });

    assert.equal(fetchCalls, 1);
    assert.equal(
      result.transcript.provider,
      "self-hosted:funasr-http:loopback"
    );
    assert.equal(result.providerReceipt.remote, false);
    assert.equal(result.providerReceipt.remoteExecution, undefined);
    assert.equal(fetchInit.redirect, "error");

    process.env.FUNASR_ENDPOINT = "https://fd.example.com/v1/audio/transcriptions";
    const blocked = await transcribeLocalAudio({
      audioPath: "/dns-funasr-must-not-read-audio.wav"
    });
    assert.equal(fetchCalls, 1);
    assert.equal(blocked.transcript.failureCode, "provider_unavailable");
    assert.equal(
      blocked.transcript.provider,
      "self-hosted:funasr-http:network-blocked:unavailable"
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment(environment);
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function abortablePendingResponse(signal) {
  return new Promise((_, reject) => {
    const safetyTimeout = setTimeout(
      () => reject(new Error("mock fetch was not aborted")),
      1_000
    );
    const handleAbort = () => {
      clearTimeout(safetyTimeout);
      reject(signal.reason);
    };
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function preserveEnvironment(names) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(environment) {
  for (const [name, value] of environment) {
    restoreEnvironmentVariable(name, value);
  }
}
