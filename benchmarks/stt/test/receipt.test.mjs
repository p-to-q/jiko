import test from "node:test";
import assert from "node:assert/strict";

import { aggregateCandidateMetrics } from "../metrics.mjs";
import {
  assertSttBenchmarkReceipt,
  validateSttBenchmarkReceipt
} from "../receipt.mjs";

const digest = "a".repeat(64);

test("accepts an internally consistent measured receipt without transcript text", () => {
  const receipt = measuredReceipt();

  assert.doesNotThrow(() => assertSttBenchmarkReceipt(receipt));
  assert.equal(JSON.stringify(receipt).includes("hello world"), false);
  assert.equal(receipt.measurement.rawTranscriptStored, false);
  assert.equal(receipt.qualification.verdict, "not_evaluated");
});

test("accepts timeout and failure outcomes as measured failure evidence", () => {
  const receipt = measuredReceipt({ measuredIterations: 2 });
  receipt.candidates[0].cases[0].outcome = "timed_out";
  receipt.candidates[0].cases.push({
    ...receipt.candidates[0].cases[0],
    iteration: 2,
    outcome: "failed",
    latencyMs: 23
  });
  receipt.candidates[0].metrics = aggregateCandidateMetrics(receipt.candidates[0].cases);

  const validation = validateSttBenchmarkReceipt(receipt);

  assert.equal(validation.ok, true, JSON.stringify(validation.issues));
  assert.equal(receipt.candidates[0].metrics.completedCases, 0);
  assert.equal(receipt.candidates[0].metrics.failedCases, 2);
});

test("rejects missing or duplicate corpus/iteration coverage", () => {
  const missing = measuredReceipt({ measuredIterations: 2 });
  const duplicate = measuredReceipt({ measuredIterations: 2 });
  duplicate.candidates[0].cases.push({ ...duplicate.candidates[0].cases[0] });
  duplicate.candidates[0].metrics = aggregateCandidateMetrics(
    duplicate.candidates[0].cases
  );

  assert.equal(validateSttBenchmarkReceipt(missing).ok, false);
  assert.ok(
    validateSttBenchmarkReceipt(missing).issues.some((issue) =>
      issue.message.includes("missing verified case iteration en-001:2")
    )
  );
  assert.ok(
    validateSttBenchmarkReceipt(duplicate).issues.some((issue) =>
      issue.message.includes("case id/iteration pairs must be unique")
    )
  );
});

test("rejects forged aggregate metrics and incomplete model identity", () => {
  const forged = measuredReceipt();
  forged.candidates[0].metrics.wer = 0;
  const incomplete = measuredReceipt();
  incomplete.candidates[0].identity.artifacts = incomplete.candidates[0].identity.artifacts
    .filter((artifact) => artifact.role !== "model");
  const wrongProvider = measuredReceipt();
  wrongProvider.candidates[0].identity.providerId = "local:funasr-http";
  const wrongConfiguration = measuredReceipt();
  wrongConfiguration.candidates[0].identity.configurationId = "d".repeat(64);

  assert.ok(
    validateSttBenchmarkReceipt(forged).issues.some((issue) =>
      issue.path.endsWith("/metrics/wer")
    )
  );
  assert.ok(
    validateSttBenchmarkReceipt(incomplete).issues.some((issue) =>
      issue.message.includes("requires artifact role model")
    )
  );
  assert.ok(
    validateSttBenchmarkReceipt(wrongProvider).issues.some((issue) =>
      issue.message.includes("must be local:whisper.cpp")
    )
  );
  assert.ok(
    validateSttBenchmarkReceipt(wrongConfiguration).issues.some((issue) =>
      issue.path.endsWith("/identity/configurationId")
    )
  );
});

test("rejects overstated target evidence and verdicts before gates are locked", () => {
  const falseTarget = measuredReceipt();
  falseTarget.qualification.evidenceLevel = "target_measured";
  const falsePass = measuredReceipt();
  falsePass.qualification.verdict = "pass";

  assert.ok(
    validateSttBenchmarkReceipt(falseTarget).issues.some((issue) =>
      issue.path === "/qualification/evidenceLevel"
    )
  );
  assert.ok(
    validateSttBenchmarkReceipt(falsePass).issues.some((issue) =>
      issue.path === "/qualification/verdict"
    )
  );

  const unboundThresholds = measuredReceipt();
  unboundThresholds.qualification.thresholdsLocked = true;
  unboundThresholds.qualification.verdict = "pass";
  assert.ok(
    validateSttBenchmarkReceipt(unboundThresholds).issues.some((issue) =>
      issue.path === "/qualification/thresholdsLocked" &&
      issue.message.includes("no policy-bound threshold artifact")
    )
  );
});

function measuredReceipt({ measuredIterations = 1 } = {}) {
  const cases = [
    {
      id: "en-001",
      iteration: 1,
      language: "en",
      metric: "wer",
      audioSha256: "d".repeat(64),
      referenceSha256: "b".repeat(64),
      hypothesisSha256: "c".repeat(64),
      outcome: "completed",
      latencyMs: 12,
      audioDurationMs: 100,
      errorUnits: 1,
      referenceUnits: 2,
      boundaryErrors: 0,
      boundaryReferenceUnits: 0,
      keywordHits: 1,
      keywordTotal: 1
    }
  ];
  return {
    schemaVersion: "stt_benchmark_v1",
    runId: "receipt-test-v1",
    startedAt: "2026-09-18T00:00:00.000Z",
    finishedAt: "2026-09-18T00:00:01.000Z",
    source: {
      gitSha: "test",
      gitDirty: true,
      configSha256: digest,
      lockfileSha256: digest
    },
    environment: {
      kind: "host",
      profileId: "test-host",
      platform: "test",
      release: "test",
      arch: "test",
      node: "test"
    },
    corpus: {
      availability: "verified",
      manifestId: "synthetic-test-v1",
      manifestSha256: digest,
      caseCount: 1,
      caseIds: ["en-001"],
      audioSpec: {
        mediaType: "audio/wav",
        sampleRateHz: 16000,
        channelCount: 1,
        sampleFormat: "pcm_s16le"
      },
      reason: null
    },
    measurement: {
      scope: "normalized-wav-to-transcript",
      normalizationId: "jiko-stt-text-normalization-v1",
      rawTranscriptStored: false,
      warmupIterations: 0,
      measuredIterations
    },
    candidates: [
      {
        id: "whisper-test",
        family: "whisper_cpp",
        availability: "measured",
        reason: null,
        identity: {
          providerId: "local:whisper.cpp",
          runtime: "whisper.cpp@test",
          configurationId: digest,
          artifacts: [
            artifact("runtime", "whisper"),
            artifact("model", "model.bin"),
            artifact("configuration", "whisper-test.configuration.json")
          ]
        },
        metrics: aggregateCandidateMetrics(cases),
        cases
      }
    ],
    qualification: {
      evidenceLevel: "host_measured",
      thresholdsLocked: false,
      verdict: "not_evaluated",
      reason: "measurement completed; release thresholds remain unlocked"
    }
  };
}

function artifact(role, name) {
  return { role, name, sha256: digest, bytes: 1 };
}
