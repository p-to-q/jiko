import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { composeSessionResult } from "../packages/core/dist/index.js";
import { runReadings } from "../packages/readings/dist/index.js";

const benchmarkDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(benchmarkDir, "..");
const casesPath = resolve(benchmarkDir, "cases.json");
const lockPath = resolve(repositoryRoot, "pnpm-lock.yaml");
const outputDir = resolve(repositoryRoot, "artifacts/benchmarks");
const casesBytes = await readFile(casesPath);
const suite = JSON.parse(casesBytes.toString("utf8"));
const startedAt = new Date();
const warmupIterations = readIterationCount(
  process.env.JIKO_BENCH_WARMUP_ITERATIONS,
  suite.measurement?.warmupIterations ?? 100
);
const measuredIterations = readIterationCount(
  process.env.JIKO_BENCH_ITERATIONS,
  suite.measurement?.measuredIterations ?? 1000
);

const results = suite.cases.map((benchmarkCase) => {
  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    executeCase(benchmarkCase);
  }

  const samples = Array.from(
    { length: measuredIterations },
    () => executeCase(benchmarkCase)
  );
  const baseline = samples[0];
  const baselineSignature = resultSignature(baseline);
  const deterministic = samples.every(
    (sample) => resultSignature(sample) === baselineSignature
  );
  const latency = latencySummary(samples.map((sample) => sample.latencyMs));

  return {
    id: benchmarkCase.id,
    passed: baseline.passed && deterministic,
    deterministic,
    latencyMs: latency.p50,
    latency,
    expectedStates: benchmarkCase.expectedStates,
    actualStates: baseline.actualStates,
    expectedResult: benchmarkCase.expectedResult,
    actualResult: baseline.actualResult,
    confidences: baseline.confidences
  };
});

const aggregateLatency = latencySummary(
  results.flatMap((result) => result.latency.samples)
);
for (const result of results) {
  delete result.latency.samples;
}

function resultExpectationPassed(expected, actual) {
  if (!expected) {
    return true;
  }

  return Object.entries(expected).every(([key, value]) => {
    if (Array.isArray(value)) {
      return JSON.stringify(actual[key]) === JSON.stringify(value);
    }

    return actual[key] === value;
  });
}

const finishedAt = new Date();
const receipt = {
  schemaVersion: suite.schemaVersion,
  suite: suite.suite,
  disclaimer:
    "Structural contract proxy only. This is not STT accuracy, user validity, or device-performance evidence.",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  source: {
    gitSha: gitOutput(["rev-parse", "HEAD"]) || "unavailable",
    gitDirty: Boolean(gitOutput(["status", "--porcelain"])),
    casesSha256: sha256(casesBytes),
    lockfileSha256: sha256(await readFile(lockPath))
  },
  runtime: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch()
  },
  measurement: {
    scope:
      suite.measurement?.scope ??
      "warmed in-process shared-core microbenchmark",
    coldStartIncluded: false,
    warmupIterations,
    measuredIterations,
    totalMeasuredSamples: measuredIterations * suite.cases.length,
    aggregateLatencyMs: withoutSamples(aggregateLatency)
  },
  summary: {
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    total: results.length
  },
  results
};

await mkdir(outputDir, { recursive: true });
const runId = startedAt.toISOString().replaceAll(":", "-");
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
await writeFile(resolve(outputDir, `${runId}.json`), serialized);
await writeFile(resolve(outputDir, "latest.json"), serialized);

console.log(
  `benchmark ${receipt.summary.failed === 0 ? "passed" : "failed"}: ${receipt.summary.passed}/${receipt.summary.total}`
);
console.log(`receipt: artifacts/benchmarks/${runId}.json`);

if (receipt.summary.failed > 0) {
  process.exitCode = 1;
}

function executeCase(benchmarkCase) {
  const before = performance.now();
  const readings = runReadings(benchmarkCase.input).map((reading) => ({
    ...reading,
    availability:
      benchmarkCase.availabilityByChannel?.[reading.channel] ?? "measured"
  }));
  const sessionResult = composeSessionResult({
    sessionId: benchmarkCase.id,
    readings
  });
  const latencyMs = performance.now() - before;
  const actualStates = Object.fromEntries(
    readings.map((reading) => [reading.channel, reading.state])
  );
  const actualResult = {
    topWindowStatus: sessionResult.topWindow.status,
    majorityState: sessionResult.majorityState ?? null,
    unavailableChannels: sessionResult.coverage?.unavailableChannels ?? [],
    hasTts: Boolean(sessionResult.tts)
  };
  const statesPassed = Object.entries(benchmarkCase.expectedStates).every(
    ([channel, expected]) => actualStates[channel] === expected
  );

  return {
    passed:
      statesPassed &&
      resultExpectationPassed(benchmarkCase.expectedResult, actualResult),
    latencyMs,
    actualStates,
    actualResult,
    confidences: Object.fromEntries(
      readings.map((reading) => [reading.channel, reading.confidence])
    )
  };
}

function resultSignature(result) {
  return JSON.stringify({
    passed: result.passed,
    actualStates: result.actualStates,
    actualResult: result.actualResult,
    confidences: result.confidences
  });
}

function latencySummary(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);

  return {
    samples: sorted,
    mean: rounded(total / sorted.length),
    p50: rounded(percentile(sorted, 0.5)),
    p95: rounded(percentile(sorted, 0.95)),
    max: rounded(sorted.at(-1) ?? 0)
  };
}

function percentile(sorted, quantile) {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function rounded(value) {
  return Number(value.toFixed(4));
}

function withoutSamples(summary) {
  const { samples: _samples, ...receiptSummary } = summary;
  return receiptSummary;
}

function readIterationCount(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, 10_000);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
