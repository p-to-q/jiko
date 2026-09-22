import { execFileSync } from "node:child_process";
import { cpus, arch, platform, release } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  assertHardwareHilReceipt,
  hardwareHilSchemaPath,
  sha256
} from "./receipt.mjs";

const hardwareDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(hardwareDir, "..", "..");
const fixturePath = path.join(hardwareDir, "fixtures", "host-simulation-v1.json");
const configurationPath = path.join(hardwareDir, "config", "host-simulation-v1.json");
const harnessPath = fileURLToPath(import.meta.url);
const lockfilePath = path.join(repositoryRoot, "pnpm-lock.yaml");
const outputRoot = path.join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "hardware-hil-v1"
);

const wallStartedAt = new Date();
const monotonicStartedAt = performance.now();
const [fixtureBytes, configurationBytes, schemaBytes, harnessBytes, lockfileBytes] =
  await Promise.all([
    readFile(fixturePath),
    readFile(configurationPath),
    readFile(hardwareHilSchemaPath),
    readFile(harnessPath),
    readFile(lockfilePath)
  ]);
const fixture = JSON.parse(fixtureBytes.toString("utf8"));
const configuration = JSON.parse(configurationBytes.toString("utf8"));

const runId = `host-${wallStartedAt.toISOString().replaceAll(":", "-")}`;
const outputDirectory = path.join(outputRoot, runId);
await mkdir(outputDirectory, { recursive: true });

const wallFinishedAt = new Date();
const elapsedMonotonicMs = rounded(performance.now() - monotonicStartedAt);
const traceBytes = Buffer.from(
  [
    {
      type: "host_simulation.started",
      runId,
      monotonicOffsetMs: 0,
      scope: configuration.scope
    },
    {
      type: "host_simulation.completed",
      runId,
      monotonicOffsetMs: elapsedMonotonicMs,
      productTurns: 0,
      hardwareQualification: "not_evaluated"
    }
  ]
    .map((event) => JSON.stringify(event))
    .join("\n") + "\n",
  "utf8"
);
const tracePath = path.join(outputDirectory, "controller-trace.ndjson");
await writeFile(tracePath, traceBytes);

const fixtureSha256 = sha256(fixtureBytes);
const configurationSha256 = sha256(configurationBytes);
const traceSha256 = sha256(traceBytes);
const uncollectedHardwareReason =
  "No DUT or physical instrumentation was present in this host-simulation scaffold run.";
const noProductTurnReason =
  "This metadata-only scaffold did not execute the product event, audio, or output path.";

const receipt = {
  schema: "hardware_hil_v1",
  schemaVersion: 1,
  runId,
  evidenceClass: "host_simulation",
  harnessStatus: "completed",
  startedAt: wallStartedAt.toISOString(),
  finishedAt: wallFinishedAt.toISOString(),
  elapsedMonotonicMs,
  reproducibility: {
    suite: {
      id: configuration.id,
      version: configuration.schemaVersion,
      manifestSha256: fixtureSha256
    },
    source: {
      git: gitIdentity(),
      lockfileSha256: sha256(lockfileBytes),
      schemaSha256: sha256(schemaBytes),
      harnessSha256: sha256(harnessBytes),
      fixtureManifestSha256: fixtureSha256,
      configurationSha256
    },
    protocol: {
      sessionEvent: unavailable(noProductTurnReason),
      sessionReceipt: unavailable(noProductTurnReason)
    }
  },
  controller: {
    platform: platform(),
    release: release(),
    arch: arch(),
    runtime: `node ${process.version}`,
    logicalCpuCount: Math.max(1, cpus().length),
    profileId: unavailable(
      "No pinned controller hardware profile was supplied; controller identity is diagnostic only."
    ),
    powerMode: unavailable(
      "The host scaffold does not have a calibrated controller power-mode probe."
    )
  },
  dut: {
    present: false,
    reason: uncollectedHardwareReason
  },
  fixture: {
    kind: "synthetic",
    id: fixture.id,
    manifestSha256: fixtureSha256,
    description: fixture.description
  },
  pathCoverage: configuration.pathCoverage,
  campaign: {
    scope: configuration.scope,
    startCondition: "warm",
    plannedTurns: 0,
    completedTurns: 0,
    inputDurationMs: unavailable(noProductTurnReason)
  },
  cases: [],
  measurements: {
    capture: {
      sampleCount: unavailable(uncollectedHardwareReason),
      monotonicElapsedMs: unavailable(uncollectedHardwareReason),
      clockDriftPpm: unavailable(uncollectedHardwareReason),
      firstPhonemeClipped: unavailable(uncollectedHardwareReason),
      lastPhonemeClipped: unavailable(uncollectedHardwareReason),
      xrunCount: unavailable(uncollectedHardwareReason),
      gapCount: unavailable(uncollectedHardwareReason),
      resetCount: unavailable(uncollectedHardwareReason),
      duplicateFrameCount: unavailable(uncollectedHardwareReason),
      outOfOrderFrameCount: unavailable(uncollectedHardwareReason),
      overflowCount: unavailable(uncollectedHardwareReason),
      ringHighWaterFrames: unavailable(uncollectedHardwareReason),
      hostQueueHighWaterFrames: unavailable(uncollectedHardwareReason),
      maxQueueAgeMs: unavailable(uncollectedHardwareReason)
    },
    integrity: {
      eventLossCount: unavailable(noProductTurnReason),
      duplicateFinalResultCount: unavailable(noProductTurnReason),
      stuckSessionCount: unavailable(noProductTurnReason)
    },
    latency: {
      buttonDownToAckMs: unavailable(noProductTurnReason),
      buttonUpToProcessingMs: unavailable(noProductTurnReason),
      releaseToResultMs: unavailable(noProductTurnReason),
      releaseToErrorMs: unavailable(noProductTurnReason)
    },
    dutPower: {
      railCurrentMa: unavailable(uncollectedHardwareReason),
      energyMwh: unavailable(uncollectedHardwareReason)
    },
    dutThermal: {
      temperatureC: unavailable(uncollectedHardwareReason),
      throttleCount: unavailable(uncollectedHardwareReason)
    }
  },
  faults: [],
  checks: [
    {
      id: "host_scope_declared",
      required: true,
      verdict: "pass",
      message: "The receipt declares host_simulation and exercises no product or hardware path.",
      evidenceArtifactSha256: configurationSha256
    },
    {
      id: "dut_absence_declared",
      required: true,
      verdict: "pass",
      message: "The receipt explicitly declares that no DUT was present.",
      evidenceArtifactSha256: traceSha256
    },
    {
      id: "content_free_fixture",
      required: true,
      verdict: "pass",
      message: "The fixture contains no audio, transcript, or personal data.",
      evidenceArtifactSha256: fixtureSha256
    }
  ],
  qualification: {
    profile: "none",
    verdict: "not_evaluated",
    reasons: [
      "No DUT, physical fixture, capture path, output path, or calibrated instrumentation was present."
    ]
  },
  privacy: {
    stimulusClass: "none",
    rawCapturedAudio: "none",
    transcriptContent: "omitted",
    containsPersonalData: false
  },
  artifacts: [
    artifact("fixture_manifest", fixturePath, fixtureBytes, "application/json"),
    artifact("configuration", configurationPath, configurationBytes, "application/json"),
    artifact(
      "controller_trace",
      tracePath,
      traceBytes,
      "application/x-ndjson"
    )
  ]
};

await assertHardwareHilReceipt(receipt, {
  repositoryRoot,
  verifyArtifacts: true
});

const serializedReceipt = `${JSON.stringify(receipt, null, 2)}\n`;
const receiptPath = path.join(outputDirectory, "receipt.json");
await Promise.all([
  writeFile(receiptPath, serializedReceipt, "utf8"),
  writeFile(path.join(outputRoot, "latest.json"), serializedReceipt, "utf8")
]);

console.log("hardware_hil_v1 host simulation completed");
console.log("hardware qualification: not_evaluated");
console.log(`receipt: ${repositoryRelative(receiptPath)}`);

function artifact(role, filePath, bytes, mediaType) {
  return {
    role,
    path: repositoryRelative(filePath),
    sha256: sha256(bytes),
    byteSize: bytes.byteLength,
    mediaType
  };
}

function unavailable(reason) {
  return {
    availability: "not_collected",
    reason
  };
}

function gitIdentity() {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const dirty = Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim()
    );
    return {
      availability: "identified",
      sha,
      dirty
    };
  } catch (error) {
    return {
      availability: "unavailable",
      reason: `Git identity unavailable: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function repositoryRelative(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function rounded(value) {
  return Number(value.toFixed(4));
}
