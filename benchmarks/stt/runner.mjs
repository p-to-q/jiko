import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSttBenchmarkConfig } from "./config.mjs";
import { canonicalAudioSpec, verifySttCorpusManifest } from "./corpus.mjs";
import {
  assertLoopbackEndpoint,
  configurationIdentity,
  stableStringify,
  verifyConfiguredArtifact,
  verifyFunasrIdentityManifest
} from "./identity.mjs";
import { aggregateCandidateMetrics, evaluateTranscript, sttNormalizationId } from "./metrics.mjs";
import {
  assertSttBenchmarkReceipt,
  deriveEvidenceLevel,
  sha256
} from "./receipt.mjs";

const sttDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRootDefault = path.resolve(sttDirectory, "../..");
const providerEnvironmentKeys = [
  "STT_PROVIDER",
  "STT_TIMEOUT_MS",
  "WHISPER_CPP_BIN",
  "WHISPER_MODEL",
  "WHISPER_LANGUAGE",
  "FUNASR_ENDPOINT",
  "FUNASR_MODEL",
  "FUNASR_LANGUAGE",
  "SHERPA_ONNX_PYTHON",
  "SHERPA_ONNX_WORKER_SCRIPT",
  "SHERPA_ONNX_SENSEVOICE_MODEL",
  "SHERPA_ONNX_SENSEVOICE_TOKENS",
  "SHERPA_ONNX_LANGUAGE",
  "SHERPA_ONNX_THREADS",
  "SHERPA_ONNX_PROVIDER",
  "SHERPA_ONNX_USE_ITN",
  "SHERPA_ONNX_STARTUP_TIMEOUT_MS",
  "SHERPA_ONNX_MAX_PENDING_REQUESTS"
];

export async function runMeasuredSttBenchmark({
  configPath,
  repositoryRoot = repositoryRootDefault,
  writeReceipt = true
}) {
  const loadedConfig = await loadSttBenchmarkConfig(configPath);
  const { config } = loadedConfig;
  const startedAt = new Date();
  const corpus = await loadCorpusForRun(config, loadedConfig.directory);
  const server = corpus.availability === "verified" && config.measuredIterations > 0
    ? await loadServerStt(repositoryRoot)
    : undefined;
  const candidates = [];

  for (const candidate of config.candidates) {
    if (corpus.availability !== "verified") {
      candidates.push(unavailableCandidate(candidate, "verified corpus is unavailable; execution was not attempted"));
      continue;
    }
    if (config.measuredIterations < 1) {
      candidates.push(unavailableCandidate(candidate, "measuredIterations is zero; execution was not attempted"));
      continue;
    }
    candidates.push(
      await runCandidate({
        candidate,
        configDirectory: loadedConfig.directory,
        corpus,
        measuredIterations: config.measuredIterations,
        warmupIterations: config.warmupIterations,
        server
      })
    );
  }

  const receipt = {
    schemaVersion: "stt_benchmark_v1",
    runId: `stt-${startedAt.toISOString().replaceAll(":", "-")}`,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    source: {
      gitSha: gitOutput(repositoryRoot, ["rev-parse", "HEAD"]) || "unavailable",
      gitDirty: Boolean(gitOutput(repositoryRoot, ["status", "--porcelain"])),
      configSha256: sha256(loadedConfig.bytes),
      lockfileSha256: sha256(await readFile(path.join(repositoryRoot, "pnpm-lock.yaml")))
    },
    environment: {
      kind: config.environmentKind,
      profileId: config.profileId,
      platform: platform(),
      release: release(),
      arch: arch(),
      node: process.version,
      ...(config.environmentKind === "target" ? config.target : {})
    },
    corpus: corpusReceipt(corpus),
    measurement: {
      scope: "normalized-wav-to-transcript",
      normalizationId: sttNormalizationId,
      rawTranscriptStored: false,
      warmupIterations: config.warmupIterations,
      measuredIterations: config.measuredIterations
    },
    candidates,
    qualification: {
      evidenceLevel: "not_evaluated",
      thresholdsLocked: false,
      verdict: "not_evaluated",
      reason: candidates.some((candidate) => candidate.availability === "measured")
        ? "measurement completed; release thresholds remain unlocked"
        : "no candidate produced measured evidence"
    }
  };
  receipt.qualification.evidenceLevel = deriveEvidenceLevel(receipt);
  assertSttBenchmarkReceipt(receipt);

  let runPath;
  if (writeReceipt) {
    const outputDirectory = path.join(
      repositoryRoot,
      "artifacts",
      "benchmarks",
      "stt-benchmark-v1"
    );
    await mkdir(outputDirectory, { recursive: true });
    const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
    runPath = path.join(outputDirectory, `${receipt.runId}.json`);
    await writeFile(runPath, serialized);
    await writeFile(path.join(outputDirectory, "latest.json"), serialized);
  }
  return { receipt, runPath };
}

async function loadCorpusForRun(config, configDirectory) {
  if (!config.corpusManifestPath) {
    return {
      availability: "unavailable",
      reason: "no corpus manifest was configured"
    };
  }
  try {
    const manifestPath = path.isAbsolute(config.corpusManifestPath)
      ? config.corpusManifestPath
      : path.resolve(configDirectory, config.corpusManifestPath);
    return {
      availability: "verified",
      ...(await verifySttCorpusManifest(manifestPath))
    };
  } catch (error) {
    console.error(`STT corpus unavailable: ${messageForLog(error)}`);
    return {
      availability: "unavailable",
      reason: "corpus manifest or audio identity verification failed"
    };
  }
}

async function runCandidate(input) {
  const { candidate } = input;
  if (!candidate.settings) {
    return unavailableCandidate(candidate, "candidate settings are not configured");
  }
  const environment = preserveEnvironment(providerEnvironmentKeys);
  const originalFetch = globalThis.fetch;
  let stopSenseVoice = false;
  try {
    clearProviderEnvironment();
    const prepared = await prepareCandidate(input);
    applyEnvironment(prepared.environment);
    if (candidate.family === "funasr") {
      installLoopbackOnlyFetch(originalFetch);
    }
    if (candidate.family === "sensevoice") {
      const readiness = await input.server.getConfiguredSherpaSenseVoiceWorker().start();
      stopSenseVoice = true;
      prepared.identity = identityFromSenseVoiceReadiness(
        candidate,
        readiness,
        prepared
      );
    }

    const warmupCase = input.corpus.cases.find((entry) => entry.language !== "silence")
      ?? input.corpus.cases[0];
    for (let index = 0; index < input.warmupIterations; index += 1) {
      const warmup = await input.server.transcribeLocalAudio({
        audioPath: warmupCase.audioPath,
        timeoutMs: candidate.settings.timeoutMs
      });
      assertProviderRun(candidate, prepared.identity, warmup.providerReceipt);
    }

    const cases = [];
    for (let iteration = 1; iteration <= input.measuredIterations; iteration += 1) {
      for (const corpusCase of input.corpus.cases) {
        cases.push(
          await measureCase({
            candidate,
            corpusCase,
            identity: prepared.identity,
            iteration,
            transcribeLocalAudio: input.server.transcribeLocalAudio
          })
        );
      }
    }

    return {
      id: candidate.id,
      family: candidate.family,
      availability: "measured",
      reason: null,
      identity: prepared.identity,
      metrics: aggregateCandidateMetrics(cases),
      cases
    };
  } catch (error) {
    console.error(`STT candidate ${candidate.id} unavailable: ${messageForLog(error)}`);
    return unavailableCandidate(
      candidate,
      "candidate prerequisites, runtime readiness, or identity verification failed"
    );
  } finally {
    if (stopSenseVoice) {
      await input.server.stopConfiguredSherpaSenseVoiceWorker().catch(() => undefined);
    }
    globalThis.fetch = originalFetch;
    restoreEnvironment(environment);
  }
}

async function prepareCandidate({ candidate, configDirectory }) {
  if (candidate.family === "sensevoice") {
    return prepareSenseVoice(candidate, configDirectory);
  }
  if (candidate.family === "whisper_cpp") {
    return prepareWhisper(candidate, configDirectory);
  }
  return prepareFunasr(candidate, configDirectory);
}

async function prepareSenseVoice(candidate, configDirectory) {
  const settings = candidate.settings;
  const python = await verifyConfiguredArtifact(settings.artifacts.python, "runtime", configDirectory);
  const worker = await verifyConfiguredArtifact(settings.artifacts.worker, "worker", configDirectory);
  const model = await verifyConfiguredArtifact(settings.artifacts.model, "model", configDirectory);
  const tokens = await verifyConfiguredArtifact(settings.artifacts.tokens, "tokens", configDirectory);
  const effectiveConfiguration = {
    language: settings.language,
    threads: settings.threads,
    executionProvider: settings.executionProvider,
    useItn: settings.useItn
  };
  const configuration = configurationIdentity(candidate.id, effectiveConfiguration);
  return {
    identity: undefined,
    expected: { model, tokens, effectiveConfiguration, configuration },
    baseArtifacts: [
      python.receipt,
      worker.receipt,
      model.receipt,
      tokens.receipt,
      configuration.artifact
    ],
    environment: {
      STT_PROVIDER: "sherpa-onnx",
      STT_TIMEOUT_MS: String(settings.timeoutMs),
      SHERPA_ONNX_PYTHON: python.filePath,
      SHERPA_ONNX_WORKER_SCRIPT: worker.filePath,
      SHERPA_ONNX_SENSEVOICE_MODEL: model.filePath,
      SHERPA_ONNX_SENSEVOICE_TOKENS: tokens.filePath,
      SHERPA_ONNX_LANGUAGE: settings.language,
      SHERPA_ONNX_THREADS: String(settings.threads),
      SHERPA_ONNX_PROVIDER: settings.executionProvider,
      ...(settings.useItn ? { SHERPA_ONNX_USE_ITN: "1" } : {})
    }
  };
}

async function prepareWhisper(candidate, configDirectory) {
  const settings = candidate.settings;
  const runtime = await verifyConfiguredArtifact(settings.artifacts.runtime, "runtime", configDirectory);
  const model = await verifyConfiguredArtifact(settings.artifacts.model, "model", configDirectory);
  const effectiveConfiguration = {
    language: settings.language,
    runtimeSha256: runtime.receipt.sha256,
    modelSha256: model.receipt.sha256
  };
  const configuration = configurationIdentity(candidate.id, effectiveConfiguration);
  return {
    identity: {
      providerId: "local:whisper.cpp",
      runtime: `whisper.cpp@sha256:${runtime.receipt.sha256.slice(0, 12)}`,
      configurationId: configuration.configurationId,
      artifacts: [runtime.receipt, model.receipt, configuration.artifact]
    },
    environment: {
      STT_PROVIDER: "whisper.cpp",
      STT_TIMEOUT_MS: String(settings.timeoutMs),
      WHISPER_CPP_BIN: runtime.filePath,
      WHISPER_MODEL: model.filePath,
      WHISPER_LANGUAGE: settings.language
    }
  };
}

async function prepareFunasr(candidate, configDirectory) {
  const settings = candidate.settings;
  const endpoint = assertLoopbackEndpoint(settings.endpoint);
  const identity = await verifyFunasrIdentityManifest(
    settings.identityManifestPath,
    configDirectory
  );
  const configuration = configurationIdentity(candidate.id, {
    model: settings.model,
    language: settings.language
  });
  if (identity.configurationId !== configuration.configurationId) {
    throw new Error("FunASR identity manifest configuration does not match candidate settings");
  }
  identity.artifacts.push(configuration.artifact);
  return {
    identity,
    environment: {
      STT_PROVIDER: "funasr",
      STT_TIMEOUT_MS: String(settings.timeoutMs),
      FUNASR_ENDPOINT: endpoint,
      FUNASR_MODEL: settings.model,
      FUNASR_LANGUAGE: settings.language
    }
  };
}

function identityFromSenseVoiceReadiness(candidate, readiness, prepared) {
  const expected = prepared.expected;
  if (
    readiness.providerId !== "local:sherpa-onnx-sensevoice" ||
    readiness.artifacts.model.sha256 !== expected.model.receipt.sha256 ||
    readiness.artifacts.model.bytes !== expected.model.receipt.bytes ||
    readiness.artifacts.tokens.sha256 !== expected.tokens.receipt.sha256 ||
    readiness.artifacts.tokens.bytes !== expected.tokens.receipt.bytes ||
    stableStringify(readiness.configuration) !== stableStringify(expected.effectiveConfiguration)
  ) {
    throw new Error("loaded SenseVoice identity does not match the frozen candidate config");
  }
  return {
    providerId: readiness.providerId,
    runtime: `${readiness.runtime.name}@${readiness.runtime.version}`,
    configurationId: expected.configuration.configurationId,
    artifacts: prepared.baseArtifacts
  };
}

async function measureCase({
  candidate,
  corpusCase,
  identity,
  iteration,
  transcribeLocalAudio
}) {
  const started = performance.now();
  let run;
  try {
    run = await transcribeLocalAudio({
      audioPath: corpusCase.audioPath,
      timeoutMs: candidate.settings.timeoutMs
    });
  } catch {
    run = {
      transcript: { text: "", provider: identity.providerId, failureCode: "failed" },
      providerReceipt: { id: identity.providerId, outcome: "failed" }
    };
  }
  assertProviderRun(candidate, identity, run.providerReceipt);
  const latencyMs = rounded(performance.now() - started);
  const hypothesis = run.transcript.text ?? "";
  const evaluated = evaluateTranscript({
    language: corpusCase.language,
    reference: corpusCase.reference,
    hypothesis,
    keywords: corpusCase.keywords
  });
  return {
    id: corpusCase.id,
    iteration,
    slices: [...corpusCase.slices],
    language: corpusCase.language,
    metric: evaluated.metric,
    audioSha256: corpusCase.audio.sha256,
    referenceSha256: sha256(Buffer.from(corpusCase.reference, "utf8")),
    hypothesisSha256: sha256(Buffer.from(hypothesis, "utf8")),
    outcome: run.providerReceipt.outcome ?? run.transcript.failureCode ?? "completed",
    latencyMs,
    audioDurationMs: rounded(corpusCase.audioDurationMs),
    errorUnits: evaluated.errorUnits,
    referenceUnits: evaluated.referenceUnits,
    boundaryErrors: evaluated.boundaryErrors,
    boundaryReferenceUnits: evaluated.boundaryReferenceUnits,
    keywordHits: evaluated.keywordHits,
    keywordTotal: evaluated.keywordTotal
  };
}

function assertProviderRun(candidate, identity, providerReceipt) {
  const baseProvider = String(providerReceipt?.id ?? "").split(":timed_out")[0]
    .split(":failed")[0]
    .split(":unavailable")[0];
  if (baseProvider !== identity.providerId) {
    throw new Error("provider identity changed during the benchmark run");
  }
  if (candidate.family !== "sensevoice") {
    return;
  }
  const execution = providerReceipt.execution;
  const model = identity.artifacts.find((artifact) => artifact.role === "model");
  const tokens = identity.artifacts.find((artifact) => artifact.role === "tokens");
  if (
    !execution ||
    execution.artifacts.model.sha256 !== model?.sha256 ||
    execution.artifacts.tokens.sha256 !== tokens?.sha256 ||
    `${execution.runtime.name}@${execution.runtime.version}` !== identity.runtime
  ) {
    throw new Error("SenseVoice execution identity changed during the benchmark run");
  }
}

function corpusReceipt(corpus) {
  if (corpus.availability !== "verified") {
    return {
      availability: "unavailable",
      caseCount: 0,
      caseIds: [],
      audioSpec: canonicalAudioSpec,
      reason: corpus.reason
    };
  }
  return {
    availability: "verified",
    manifestId: corpus.manifest.manifestId,
    manifestSha256: corpus.manifestSha256,
    caseCount: corpus.cases.length,
    caseIds: corpus.cases.map((entry) => entry.id),
    audioSpec: canonicalAudioSpec,
    reason: null
  };
}

function unavailableCandidate(candidate, reason) {
  return {
    id: candidate.id,
    family: candidate.family,
    availability: "unavailable",
    reason,
    identity: null,
    metrics: null,
    cases: []
  };
}

async function loadServerStt(repositoryRoot) {
  const stt = await import(
    pathToFileURL(path.join(repositoryRoot, "apps", "server", "dist", "stt.js"))
  );
  const worker = await import(
    pathToFileURL(
      path.join(repositoryRoot, "apps", "server", "dist", "persistentSttWorker.js")
    )
  );
  return {
    transcribeLocalAudio: stt.transcribeLocalAudio,
    getConfiguredSherpaSenseVoiceWorker: worker.getConfiguredSherpaSenseVoiceWorker,
    stopConfiguredSherpaSenseVoiceWorker: worker.stopConfiguredSherpaSenseVoiceWorker
  };
}

function installLoopbackOnlyFetch(originalFetch) {
  globalThis.fetch = (input, init = {}) => {
    const requested = input instanceof URL
      ? input.toString()
      : typeof input === "string"
        ? input
        : input.url;
    assertLoopbackEndpoint(requested);
    return originalFetch(input, { ...init, redirect: "manual" });
  };
}

function clearProviderEnvironment() {
  for (const key of providerEnvironmentKeys) {
    delete process.env[key];
  }
}

function applyEnvironment(environment) {
  for (const [key, value] of Object.entries(environment)) {
    process.env[key] = value;
  }
}

function preserveEnvironment(keys) {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(environment) {
  for (const [key, value] of environment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function gitOutput(repositoryRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function messageForLog(error) {
  return error instanceof Error ? error.message.replaceAll(/\s+/g, " ") : String(error);
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
