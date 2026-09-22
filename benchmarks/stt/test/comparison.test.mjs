import test from "node:test";
import assert from "node:assert/strict";

import { compareSttCandidates } from "../comparison.mjs";
import { aggregateCandidateMetrics } from "../metrics.mjs";

const digest = "a".repeat(64);

test("compares same-corpus candidates without selecting a winner", () => {
  const comparison = compareSttCandidates(comparisonReceipt());

  assert.equal(comparison.status, "comparison_only");
  assert.equal(comparison.winnerCandidateId, null);
  assert.equal(comparison.selectionAllowed, false);
  assert.equal(comparison.configuredCandidates.length, 2);
  assert.equal(comparison.measuredCandidates.length, 2);
  assert.match(comparison.sourceReceipt.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.equal(comparison.sourceReceipt.configSha256, digest);
  assert.equal(
    comparison.measuredCandidates[0].executionIdentity.providerId,
    "local:whisper.cpp"
  );
  assert.match(
    comparison.measuredCandidates[0].executionIdentity.identitySha256,
    /^[a-f0-9]{64}$/
  );
  assert.equal(
    comparison.measuredCandidates[0].inputMatrixSha256,
    comparison.measuredCandidates[1].inputMatrixSha256
  );
  assert.deepEqual(
    comparison.measuredCandidates[0].slices.map((slice) => slice.id),
    ["commands", "noise", "quiet"]
  );
  assert.equal(comparison.measuredCandidates[0].slices[0].caseCount, 2);
  assert.equal(comparison.pairwise.length, 1);
  assert.equal(comparison.pairwise[0].metrics.failureRate.rightMinusLeft, 0.5);
  assert.equal(comparison.pairwise[0].metrics.wer.rightMinusLeft, 0.25);
  assert.equal(comparison.pairwise[0].metrics.latencyP95Ms.rightMinusLeft, 200);
  assert.deepEqual(
    comparison.blockers.map((blocker) => blocker.code),
    [
      "target_device_evidence_absent",
      "dirty_source",
      "release_threshold_policy_absent",
      "resource_metrics_absent",
      "paired_uncertainty_absent",
      "runtime_lifecycle_not_normalized"
    ]
  );
});

test("makes absent slice evidence explicit without inventing labels", () => {
  const receipt = comparisonReceipt();
  for (const candidate of receipt.candidates) {
    delete candidate.cases[0].slices;
  }

  const comparison = compareSttCandidates(receipt);

  assert.equal(comparison.status, "comparison_only");
  assert.ok(
    comparison.blockers.some((blocker) => blocker.code === "slice_evidence_absent")
  );
  assert.deepEqual(
    comparison.measuredCandidates[0].slices.map((slice) => slice.id),
    ["commands", "noise"]
  );
});

test("refuses pairwise comparison when only one candidate completed", () => {
  const receipt = comparisonReceipt();
  receipt.candidates[1] = {
    id: receipt.candidates[1].id,
    family: receipt.candidates[1].family,
    availability: "unavailable",
    reason: "runtime missing",
    identity: null,
    metrics: null,
    cases: []
  };

  const comparison = compareSttCandidates(receipt);

  assert.equal(comparison.status, "not_comparable");
  assert.equal(comparison.pairwise.length, 0);
  assert.ok(
    comparison.blockers.some(
      (blocker) => blocker.code === "insufficient_measured_candidates"
    )
  );
  assert.ok(
    comparison.blockers.some(
      (blocker) => blocker.code === "configured_candidate_set_incomplete"
    )
  );
});

test("rejects pairwise evidence when candidates did not receive identical inputs", () => {
  for (const [field, replacement] of [
    ["audioSha256", "d".repeat(64)],
    ["referenceSha256", "e".repeat(64)],
    ["audioDurationMs", 1001],
    ["referenceUnits", 3],
    ["keywordTotal", 2],
    ["language", "zh"]
  ]) {
    const receipt = comparisonReceipt();
    receipt.candidates[1].cases[0][field] = replacement;
    receipt.candidates[1].metrics = aggregateCandidateMetrics(
      receipt.candidates[1].cases
    );

    assert.throws(
      () => compareSttCandidates(receipt),
      new RegExp(`/${field}: must match the same case input`)
    );
  }
});

function comparisonReceipt() {
  const whisperCases = [
    caseResult({
      id: "en-001",
      slices: ["commands", "quiet"],
      errorUnits: 1,
      outcome: "completed",
      latencyMs: 100
    }),
    caseResult({
      id: "en-002",
      slices: ["commands", "noise"],
      errorUnits: 0,
      outcome: "completed",
      latencyMs: 200
    })
  ];
  const senseVoiceCases = [
    caseResult({
      id: "en-001",
      slices: ["commands", "quiet"],
      errorUnits: 0,
      outcome: "completed",
      latencyMs: 80
    }),
    caseResult({
      id: "en-002",
      slices: ["commands", "noise"],
      errorUnits: 2,
      outcome: "timed_out",
      latencyMs: 400
    })
  ];
  return {
    schemaVersion: "stt_benchmark_v1",
    runId: "comparison-test-v1",
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
      caseCount: 2,
      caseIds: ["en-001", "en-002"],
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
      measuredIterations: 1
    },
    candidates: [
      measuredCandidate({
        id: "whisper-test",
        family: "whisper_cpp",
        providerId: "local:whisper.cpp",
        roles: ["runtime", "model", "configuration"],
        cases: whisperCases
      }),
      measuredCandidate({
        id: "sensevoice-test",
        family: "sensevoice",
        providerId: "local:sherpa-onnx-sensevoice",
        roles: ["runtime", "worker", "model", "tokens", "configuration"],
        cases: senseVoiceCases
      })
    ],
    qualification: {
      evidenceLevel: "host_measured",
      thresholdsLocked: false,
      verdict: "not_evaluated",
      reason: "measurement completed; release thresholds remain unlocked"
    }
  };
}

function measuredCandidate({ id, family, providerId, roles, cases }) {
  return {
    id,
    family,
    availability: "measured",
    reason: null,
    identity: {
      providerId,
      runtime: `${id}@test`,
      configurationId: digest,
      artifacts: roles.map((role) => artifact(role, `${id}-${role}`))
    },
    metrics: aggregateCandidateMetrics(cases),
    cases
  };
}

function caseResult({ id, slices, errorUnits, outcome, latencyMs }) {
  return {
    id,
    iteration: 1,
    slices,
    language: "en",
    metric: "wer",
    audioSha256: "f".repeat(64),
    referenceSha256: "b".repeat(64),
    hypothesisSha256: "c".repeat(64),
    outcome,
    latencyMs,
    audioDurationMs: 1000,
    errorUnits,
    referenceUnits: 2,
    boundaryErrors: 0,
    boundaryReferenceUnits: 0,
    keywordHits: errorUnits === 0 ? 1 : 0,
    keywordTotal: 1
  };
}

function artifact(role, name) {
  return { role, name, sha256: digest, bytes: 1 };
}
