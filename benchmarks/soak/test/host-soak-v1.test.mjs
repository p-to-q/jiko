import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveHostSoftwareIntegrity,
  validateHostSoakReceipt
} from "../receipt.mjs";

const hash = "a".repeat(64);

test("accepts a bounded host-software receipt without promoting hardware evidence", () => {
  const result = validateHostSoakReceipt(validReceipt());

  assert.equal(result.ok, true, formatIssues(result));
});

test("rejects claims that the synthetic host run covered physical hardware", () => {
  const receipt = validReceipt();
  receipt.coverage.excluded.hardwarePresent = true;
  receipt.qualification.hardwareReliability = "pass";

  const result = validateHostSoakReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.path.includes("hardwarePresent") ||
        issue.path.includes("hardwareReliability")
    ),
    formatIssues(result)
  );
});

test("cannot report host integrity pass when a duplicate final was observed", () => {
  const receipt = validReceipt();
  receipt.integrity.duplicateFinalResultCount = 1;

  assert.equal(deriveHostSoftwareIntegrity(receipt), "fail");
  const result = validateHostSoakReceipt(receipt);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.path === "/qualification/hostSoftwareIntegrity"
    ),
    formatIssues(result)
  );
});

test("checks campaign, coverage, and case arithmetic", () => {
  const receipt = validReceipt();
  receipt.campaign.resultTurns = 0;
  receipt.coverage.manualTurns = 0;

  const result = validateHostSoakReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "/campaign"),
    formatIssues(result)
  );
  assert.ok(
    result.issues.some((issue) => issue.path === "/coverage/manualTurns"),
    formatIssues(result)
  );
});

test("rejects impossible latency and RSS distributions", () => {
  const receipt = validReceipt();
  receipt.measurements.turnLatencyMs = {
    availability: "measured",
    unit: "ms",
    sampleCount: 1,
    p50: 20,
    p95: 10,
    max: 15,
    source: "host monotonic clock"
  };
  receipt.measurements.serverRss.peak = 50;

  const result = validateHostSoakReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "/measurements/turnLatencyMs"),
    formatIssues(result)
  );
  assert.ok(
    result.issues.some((issue) => issue.path === "/measurements/serverRss/peak"),
    formatIssues(result)
  );
});

test("records a remote batch label without treating it as qualified by host soak", () => {
  const receipt = validReceipt();
  receipt.cases[0].path = "synthetic_audio";
  receipt.cases[0].recordingStartStopProbe = "passed";
  receipt.configuration.audioEvery = 1;
  receipt.cases[0].providers.stt = {
    route: "remote_batch",
    providerId: "remote:any-batch-provider",
    outcome: "completed"
  };
  receipt.cases[0].issueCodes = ["provider_boundary_violation"];
  receipt.coverage.manualTurns = 0;
  receipt.coverage.syntheticAudioTurns = 1;
  receipt.coverage.recordingStartStopTurns = 1;
  receipt.integrity.providerBoundaryViolationCount = 1;
  receipt.qualification.hostSoftwareIntegrity = "fail";
  receipt.harnessStatus = "failed";

  const result = validateHostSoakReceipt(receipt);

  assert.equal(result.ok, true, formatIssues(result));
  assert.equal(deriveHostSoftwareIntegrity(receipt), "fail");
  assert.equal(receipt.qualification.sttQuality, "not_evaluated");
});

test("requires provider identity when an execution route is observed", () => {
  const receipt = validReceipt();
  receipt.cases[0].providers.stt = {
    route: "local",
    outcome: "completed"
  };
  receipt.cases[0].issueCodes = ["provider_boundary_violation"];
  receipt.integrity.providerBoundaryViolationCount = 1;
  receipt.qualification.hostSoftwareIntegrity = "fail";
  receipt.harnessStatus = "failed";

  const result = validateHostSoakReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.path === "/cases/0/providers/stt/providerId"
    ),
    formatIssues(result)
  );
});

test("cannot pass without exercising duplicate-final rejection", () => {
  const receipt = validReceipt();
  receipt.cases[0].duplicateFinalSubmissionProbe = "not_run";
  receipt.coverage.duplicateFinalSubmissionProbes = 0;

  assert.equal(deriveHostSoftwareIntegrity(receipt), "fail");
  const result = validateHostSoakReceipt(receipt);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.path === "/qualification/hostSoftwareIntegrity"
    ),
    formatIssues(result)
  );
});

function validReceipt() {
  return {
    schema: "host_soak_v1",
    schemaVersion: 1,
    runId: "host-soak-test",
    evidenceClass: "host_software",
    harnessStatus: "completed",
    disclaimer:
      "Host software HTTP/SSE/session/receipt evidence only; not hardware, physical capture, STT-quality, power, or thermal evidence.",
    startedAt: "2026-09-18T00:00:00.000Z",
    finishedAt: "2026-09-18T00:00:01.000Z",
    elapsedMonotonicMs: 1000,
    source: {
      git: {
        availability: "identified",
        sha: "b".repeat(40),
        dirty: true
      },
      lockfileSha256: hash,
      schemaSha256: hash,
      validatorSha256: hash,
      harnessSha256: hash,
      serverEntrySha256: hash,
      configurationSha256: hash
    },
    environment: {
      kind: "host",
      platform: "darwin",
      release: "test",
      arch: "arm64",
      node: "v22.0.0",
      serverPid: 42
    },
    configuration: {
      plannedTurns: 1,
      audioEvery: 0,
      replayEvery: 0,
      startupTimeoutMs: 60000,
      turnTimeoutMs: 10000,
      sessionDeadlineMs: 8000,
      resultCommitReserveMs: 750,
      rssSampleEvery: 1,
      keepSessionReceipts: false,
      server: {
        runtime: "spawned_node_process",
        transport: "localhost_http_sse",
        receiptWriting: true,
        stt: "disabled",
        ttsPlayback: "disabled"
      },
      syntheticAudio: {
        generatedInMemory: true,
        mediaType: "audio/wav",
        durationMs: 400,
        sampleRateHz: 16000,
        channelCount: 1,
        sampleFormat: "pcm_s16le"
      }
    },
    coverage: {
      nodeHttpServer: true,
      http: true,
      sseLive: true,
      sseReplay: false,
      receiptEndpoint: true,
      receiptDisk: true,
      manualTurns: 1,
      syntheticAudioTurns: 0,
      recordingStartStopTurns: 0,
      duplicateCreateProbes: 1,
      duplicateFinalSubmissionProbes: 1,
      sseReplayProbes: 0,
      excluded: {
        hardwarePresent: false,
        physicalControls: false,
        realMicrophone: false,
        realSpeech: false,
        sttQuality: false,
        speakerPlayback: false,
        power: false,
        thermal: false
      }
    },
    campaign: {
      plannedTurns: 1,
      attemptedTurns: 1,
      resultTurns: 1,
      terminalErrorTurns: 0,
      stuckTurns: 0,
      harnessErrorTurns: 0
    },
    integrity: {
      sessionsCreated: 1,
      singleFinalSessions: 1,
      duplicateFinalResultCount: 0,
      stuckSessionCount: 0,
      eventLossCount: 0,
      unexpectedSseEventCount: 0,
      duplicateSseEventCount: 0,
      ssePayloadMismatchCount: 0,
      sseOrderViolationCount: 0,
      sseReplayFailureCount: 0,
      sequenceGapCount: 0,
      receiptMismatchCount: 0,
      providerBoundaryViolationCount: 0,
      diskReceiptMissingCount: 0,
      orphanTempReceiptCount: 0,
      serverProcessFailureCount: 0,
      requestFailureCount: 0
    },
    measurements: {
      serverStartupMs: 20,
      turnLatencyMs: measuredLatency(),
      manualTurnLatencyMs: measuredLatency(),
      syntheticAudioTurnLatencyMs: unavailable("No synthetic-audio turn ran."),
      latencyDrift: unavailable("At least two turns are required."),
      serverRss: {
        availability: "measured",
        unit: "bytes",
        sampleCount: 2,
        start: 100,
        end: 120,
        peak: 120,
        delta: 20,
        source: "host ps RSS for spawned server PID"
      }
    },
    cases: [
      {
        turn: 1,
        sessionId: "host-soak-test-00001",
        path: "manual",
        outcome: "result",
        latencyMs: 10,
        finalStatus: "result",
        lastSequence: 10,
        eventCount: 10,
        sseEventCount: 10,
        recordingStartStopProbe: "not_run",
        duplicateCreateProbe: "passed",
        duplicateFinalSubmissionProbe: "passed",
        sseReplayProbe: "not_run",
        providers: {
          stt: {
            route: "manual",
            providerId: "local:manual",
            outcome: "not_run"
          },
          tts: {
            route: "disabled",
            providerId: "local:tts-unconfigured"
          }
        },
        issueCodes: []
      }
    ],
    qualification: {
      hostSoftwareIntegrity: "pass",
      performance: "not_evaluated",
      hardwareReliability: "not_evaluated",
      physicalAudioCapture: "not_evaluated",
      sttQuality: "not_evaluated",
      power: "not_evaluated",
      thermal: "not_evaluated",
      release: "not_evaluated",
      reasons: [
        "The pass applies only to the configured host software integrity campaign.",
        "Latency and RSS are observational because release thresholds are not locked."
      ]
    },
    privacy: {
      stimulus: "fixed_synthetic_text_and_generated_pcm",
      realPersonContent: false,
      rawAudioRetainedByHarness: false,
      serverTempAudioResidueAudited: false,
      transcriptContentInSoakReceipt: false,
      sessionReceiptsRetained: false
    },
    errors: [],
    omittedErrorCount: 0
  };
}

function measuredLatency() {
  return {
    availability: "measured",
    unit: "ms",
    sampleCount: 1,
    p50: 10,
    p95: 10,
    max: 10,
    source: "host monotonic clock"
  };
}

function unavailable(reason) {
  return {
    availability: "not_applicable",
    reason
  };
}

function formatIssues(result) {
  return result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}
