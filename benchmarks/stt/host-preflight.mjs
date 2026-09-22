import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSttBenchmarkConfig } from "./config.mjs";
import {
  assertSttBenchmarkReceipt,
  deriveEvidenceLevel,
  sha256
} from "./receipt.mjs";

const sttDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(sttDirectory, "../..");
const defaultConfigPath = path.join(
  sttDirectory,
  "config",
  "host-unconfigured-v1.json"
);
const configPath = resolveConfigPath(process.argv.slice(2));
const loadedConfig = await loadSttBenchmarkConfig(configPath);
const { config, bytes: configBytes } = loadedConfig;

const startedAt = new Date();
const candidates = config.candidates.map((candidate) => ({
  id: candidate.id,
  family: candidate.family,
  availability: "unavailable",
  reason:
    config.corpusManifestPath === null
      ? "corpus manifest is not configured; model execution was not attempted"
      : "this preflight runner does not execute models; use the measured runner with a verified corpus",
  identity: null,
  metrics: null,
  cases: []
}));
const receipt = {
  schemaVersion: "stt_benchmark_v1",
  runId: `stt-host-${startedAt.toISOString().replaceAll(":", "-")}`,
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  source: {
    gitSha: gitOutput(["rev-parse", "HEAD"]) || "unavailable",
    gitDirty: Boolean(gitOutput(["status", "--porcelain"])),
    configSha256: sha256(configBytes),
    lockfileSha256: sha256(await readFile(path.join(repositoryRoot, "pnpm-lock.yaml")))
  },
  environment: {
    kind: config.environmentKind,
    profileId: config.profileId,
    platform: platform(),
    release: release(),
    arch: arch(),
    node: process.version
  },
  corpus: {
    availability: "unavailable",
    caseCount: 0,
    caseIds: [],
    audioSpec: {
      mediaType: "audio/wav",
      sampleRateHz: 16000,
      channelCount: 1,
      sampleFormat: "pcm_s16le"
    },
    reason: "no frozen synthetic, licensed, or access-controlled corpus manifest was supplied"
  },
  measurement: {
    scope: "normalized-wav-to-transcript",
    normalizationId: "jiko-stt-text-normalization-v1",
    rawTranscriptStored: false,
    warmupIterations: config.warmupIterations,
    measuredIterations: config.measuredIterations
  },
  candidates,
  qualification: {
    evidenceLevel: "not_evaluated",
    thresholdsLocked: false,
    verdict: "not_evaluated",
    reason: "preflight only: no corpus or model execution evidence exists"
  }
};
receipt.qualification.evidenceLevel = deriveEvidenceLevel(receipt);
assertSttBenchmarkReceipt(receipt);

const outputDirectory = path.join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "stt-benchmark-v1"
);
await mkdir(outputDirectory, { recursive: true });
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
const runPath = path.join(outputDirectory, `${receipt.runId}.json`);
await writeFile(runPath, serialized);
await writeFile(path.join(outputDirectory, "latest.json"), serialized);

console.log("STT benchmark preflight: not_evaluated");
console.log(`receipt: ${path.relative(repositoryRoot, runPath)}`);

function resolveConfigPath(args) {
  const configIndex = args.indexOf("--config");
  if (configIndex === -1) {
    return defaultConfigPath;
  }
  const requested = args[configIndex + 1];
  if (!requested) {
    throw new Error("--config requires a path");
  }
  return path.resolve(repositoryRoot, requested);
}

function gitOutput(args) {
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
