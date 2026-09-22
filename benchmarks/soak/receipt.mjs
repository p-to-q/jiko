import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const soakDirectory = path.dirname(fileURLToPath(import.meta.url));
export const hostSoakSchemaPath = path.join(
  soakDirectory,
  "schema",
  "host-soak-v1.schema.json"
);

const schema = JSON.parse(readFileSync(hostSoakSchemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

const integrityFailureFields = [
  "duplicateFinalResultCount",
  "stuckSessionCount",
  "eventLossCount",
  "unexpectedSseEventCount",
  "duplicateSseEventCount",
  "ssePayloadMismatchCount",
  "sseOrderViolationCount",
  "sseReplayFailureCount",
  "sequenceGapCount",
  "receiptMismatchCount",
  "providerBoundaryViolationCount",
  "diskReceiptMissingCount",
  "orphanTempReceiptCount",
  "serverProcessFailureCount",
  "requestFailureCount"
];

export function validateHostSoakReceipt(receipt) {
  const issues = [];
  const schemaValid = validateSchema(receipt);

  if (!schemaValid) {
    for (const error of validateSchema.errors ?? []) {
      issues.push({
        path: error.instancePath || "/",
        message: `schema: ${error.message ?? "invalid value"}`
      });
    }
  }

  if (receipt && typeof receipt === "object") {
    validateTime(receipt, issues);
    validateCampaign(receipt, issues);
    validateCases(receipt, issues);
    validateCoverage(receipt, issues);
    validateProviderObservations(receipt, issues);
    validateIntegrity(receipt, issues);
    validateMeasurements(receipt, issues);
    validateQualification(receipt, issues);
  }

  return { ok: issues.length === 0, issues };
}

export function assertHostSoakReceipt(receipt) {
  const result = validateHostSoakReceipt(receipt);
  if (!result.ok) {
    const detail = result.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid host_soak_v1 receipt:\n${detail}`);
  }
  return receipt;
}

export function deriveHostSoftwareIntegrity(receipt) {
  const campaign = receipt?.campaign;
  const integrity = receipt?.integrity;
  const coverage = receipt?.coverage;
  const configuration = receipt?.configuration;
  const cases = receipt?.cases;
  if (!campaign || !integrity || !coverage || !configuration || !Array.isArray(cases)) {
    return "fail";
  }

  if (
    campaign.attemptedTurns !== campaign.plannedTurns ||
    campaign.resultTurns !== campaign.plannedTurns ||
    campaign.terminalErrorTurns !== 0 ||
    campaign.stuckTurns !== 0 ||
    campaign.harnessErrorTurns !== 0
  ) {
    return "fail";
  }

  if (
    integrity.sessionsCreated !== campaign.plannedTurns ||
    integrity.singleFinalSessions !== campaign.resultTurns
  ) {
    return "fail";
  }

  const expectedAudioTurns = scheduledTurnCount(
    campaign.plannedTurns,
    configuration.audioEvery
  );
  const expectedReplayTurns = scheduledTurnCount(
    campaign.plannedTurns,
    configuration.replayEvery
  );
  if (
    coverage.nodeHttpServer !== true ||
    coverage.http !== true ||
    coverage.sseLive !== true ||
    coverage.receiptEndpoint !== true ||
    coverage.receiptDisk !== true ||
    coverage.manualTurns !== campaign.plannedTurns - expectedAudioTurns ||
    coverage.syntheticAudioTurns !== expectedAudioTurns ||
    coverage.recordingStartStopTurns !== expectedAudioTurns ||
    coverage.duplicateCreateProbes !== campaign.plannedTurns ||
    coverage.duplicateFinalSubmissionProbes !== campaign.plannedTurns ||
    coverage.sseReplayProbes !== expectedReplayTurns ||
    coverage.sseReplay !== (expectedReplayTurns > 0)
  ) {
    return "fail";
  }

  if (
    cases.length !== campaign.plannedTurns ||
    cases.some((caseResult) => {
      const replayExpected =
        configuration.replayEvery > 0 &&
        caseResult.turn % configuration.replayEvery === 0;
      return (
        caseResult.duplicateCreateProbe !== "passed" ||
        caseResult.duplicateFinalSubmissionProbe !== "passed" ||
        (caseResult.path === "synthetic_audio"
          ? caseResult.recordingStartStopProbe !== "passed"
          : caseResult.recordingStartStopProbe !== "not_run") ||
        (replayExpected
          ? caseResult.sseReplayProbe !== "passed"
          : caseResult.sseReplayProbe !== "not_run")
      );
    })
  ) {
    return "fail";
  }

  return integrityFailureFields.every((field) => integrity[field] === 0)
    ? "pass"
    : "fail";
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateTime(receipt, issues) {
  const startedAt = Date.parse(receipt.startedAt);
  const finishedAt = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(startedAt)) {
    issues.push({ path: "/startedAt", message: "must be a valid UTC timestamp" });
  }
  if (!Number.isFinite(finishedAt)) {
    issues.push({ path: "/finishedAt", message: "must be a valid UTC timestamp" });
  }
  if (
    Number.isFinite(startedAt) &&
    Number.isFinite(finishedAt) &&
    finishedAt < startedAt
  ) {
    issues.push({ path: "/finishedAt", message: "must not precede startedAt" });
  }
}

function validateCampaign(receipt, issues) {
  const campaign = receipt.campaign;
  const configuration = receipt.configuration;
  if (!campaign || !configuration) {
    return;
  }

  if (campaign.plannedTurns !== configuration.plannedTurns) {
    issues.push({
      path: "/campaign/plannedTurns",
      message: "must match configuration.plannedTurns"
    });
  }
  if (campaign.attemptedTurns > campaign.plannedTurns) {
    issues.push({
      path: "/campaign/attemptedTurns",
      message: "cannot exceed plannedTurns"
    });
  }
  if (
    configuration.resultCommitReserveMs >= configuration.sessionDeadlineMs
  ) {
    issues.push({
      path: "/configuration/resultCommitReserveMs",
      message: "must be smaller than sessionDeadlineMs"
    });
  }

  const classifiedTurns =
    campaign.resultTurns +
    campaign.terminalErrorTurns +
    campaign.stuckTurns +
    campaign.harnessErrorTurns;
  if (classifiedTurns !== campaign.attemptedTurns) {
    issues.push({
      path: "/campaign",
      message: "turn outcome counts must sum to attemptedTurns"
    });
  }
}

function validateCases(receipt, issues) {
  if (!Array.isArray(receipt.cases) || !receipt.campaign) {
    return;
  }

  if (receipt.cases.length !== receipt.campaign.attemptedTurns) {
    issues.push({
      path: "/cases",
      message: "case count must equal campaign.attemptedTurns"
    });
  }

  const sessionIds = new Set();
  const outcomeCounts = {
    result: 0,
    terminal_error: 0,
    stuck: 0,
    harness_error: 0
  };
  for (const [index, caseResult] of receipt.cases.entries()) {
    if (!caseResult || typeof caseResult !== "object") {
      continue;
    }
    if (caseResult.turn !== index + 1) {
      issues.push({
        path: `/cases/${index}/turn`,
        message: "turns must be contiguous and one-based"
      });
    }
    if (sessionIds.has(caseResult.sessionId)) {
      issues.push({
        path: `/cases/${index}/sessionId`,
        message: "sessionId must be unique within the run"
      });
    }
    sessionIds.add(caseResult.sessionId);
    if (caseResult.outcome in outcomeCounts) {
      outcomeCounts[caseResult.outcome] += 1;
    }
  }

  const expected = receipt.campaign;
  const comparisons = [
    ["result", "resultTurns"],
    ["terminal_error", "terminalErrorTurns"],
    ["stuck", "stuckTurns"],
    ["harness_error", "harnessErrorTurns"]
  ];
  for (const [outcome, campaignField] of comparisons) {
    if (outcomeCounts[outcome] !== expected[campaignField]) {
      issues.push({
        path: `/campaign/${campaignField}`,
        message: `must equal the number of ${outcome} cases`
      });
    }
  }
}

function validateCoverage(receipt, issues) {
  if (!receipt.coverage || !Array.isArray(receipt.cases)) {
    return;
  }

  const manualTurns = receipt.cases.filter((item) => item.path === "manual").length;
  const audioTurns = receipt.cases.filter(
    (item) => item.path === "synthetic_audio"
  ).length;
  const duplicateCreateProbes = receipt.cases.filter(
    (item) => item.duplicateCreateProbe !== "not_run"
  ).length;
  const duplicateFinalProbes = receipt.cases.filter(
    (item) => item.duplicateFinalSubmissionProbe !== "not_run"
  ).length;
  const replayProbes = receipt.cases.filter(
    (item) => item.sseReplayProbe !== "not_run"
  ).length;
  const recordingStartStopTurns = receipt.cases.filter(
    (item) => item.recordingStartStopProbe === "passed"
  ).length;

  const comparisons = [
    ["manualTurns", manualTurns],
    ["syntheticAudioTurns", audioTurns],
    ["recordingStartStopTurns", recordingStartStopTurns],
    ["duplicateCreateProbes", duplicateCreateProbes],
    ["duplicateFinalSubmissionProbes", duplicateFinalProbes],
    ["sseReplayProbes", replayProbes]
  ];
  for (const [field, expected] of comparisons) {
    if (receipt.coverage[field] !== expected) {
      issues.push({
        path: `/coverage/${field}`,
        message: `must equal ${expected} from recorded cases`
      });
    }
  }

  if (receipt.coverage.sseReplay !== (replayProbes > 0)) {
    issues.push({
      path: "/coverage/sseReplay",
      message: "must reflect whether any replay probe ran"
    });
  }

  if (receipt.configuration && receipt.campaign) {
    const expectedAudioTurns = scheduledTurnCount(
      receipt.campaign.plannedTurns,
      receipt.configuration.audioEvery
    );
    const expectedReplayTurns = scheduledTurnCount(
      receipt.campaign.plannedTurns,
      receipt.configuration.replayEvery
    );
    for (const [field, expected] of [
      ["syntheticAudioTurns", expectedAudioTurns],
      ["manualTurns", receipt.campaign.plannedTurns - expectedAudioTurns],
      ["sseReplayProbes", expectedReplayTurns]
    ]) {
      if (receipt.coverage[field] !== expected) {
        issues.push({
          path: `/coverage/${field}`,
          message: `must equal ${expected} from the configured turn schedule`
        });
      }
    }
  }
}

function validateProviderObservations(receipt, issues) {
  if (!Array.isArray(receipt.cases) || !receipt.integrity) {
    return;
  }

  let providerBoundaryIssueCount = 0;
  for (const [index, caseResult] of receipt.cases.entries()) {
    const stt = caseResult?.providers?.stt;
    const tts = caseResult?.providers?.tts;
    if (!stt || !tts) {
      continue;
    }

    if (stt.route !== "not_observed" && !stt.providerId) {
      issues.push({
        path: `/cases/${index}/providers/stt/providerId`,
        message: "is required when an STT provider route was observed"
      });
    }
    if (stt.route !== "not_observed" && !stt.outcome) {
      issues.push({
        path: `/cases/${index}/providers/stt/outcome`,
        message: "is required when an STT provider route was observed"
      });
    }
    if (tts.route !== "not_observed" && !tts.providerId) {
      issues.push({
        path: `/cases/${index}/providers/tts/providerId`,
        message: "is required when a TTS provider route was observed"
      });
    }
    if (stt.route === "manual" && stt.outcome !== "not_run") {
      issues.push({
        path: `/cases/${index}/providers/stt/outcome`,
        message: "manual route must have outcome not_run"
      });
    }
    if (stt.route === "disabled" && stt.outcome !== "provider_unavailable") {
      issues.push({
        path: `/cases/${index}/providers/stt/outcome`,
        message: "disabled route must have outcome provider_unavailable"
      });
    }

    const allowedSttRoutes =
      caseResult.path === "manual"
        ? new Set(["manual", "not_observed"])
        : new Set(["disabled", "not_observed"]);
    const violatesDisabledProviderBoundary =
      !allowedSttRoutes.has(stt.route) ||
      !new Set(["disabled", "not_observed"]).has(tts.route);
    const recordsBoundaryIssue = caseResult.issueCodes?.includes(
      "provider_boundary_violation"
    );
    if (recordsBoundaryIssue) {
      providerBoundaryIssueCount += 1;
    }
    if (violatesDisabledProviderBoundary && !recordsBoundaryIssue) {
      issues.push({
        path: `/cases/${index}/issueCodes`,
        message: "must record provider_boundary_violation for an executed provider route"
      });
    }
  }

  if (
    receipt.integrity.providerBoundaryViolationCount !==
    providerBoundaryIssueCount
  ) {
    issues.push({
      path: "/integrity/providerBoundaryViolationCount",
      message: "must equal provider_boundary_violation case issue count"
    });
  }
}

function validateIntegrity(receipt, issues) {
  if (!receipt.integrity || !receipt.campaign) {
    return;
  }
  if (receipt.integrity.stuckSessionCount !== receipt.campaign.stuckTurns) {
    issues.push({
      path: "/integrity/stuckSessionCount",
      message: "must equal campaign.stuckTurns"
    });
  }
  if (receipt.integrity.singleFinalSessions > receipt.integrity.sessionsCreated) {
    issues.push({
      path: "/integrity/singleFinalSessions",
      message: "cannot exceed sessionsCreated"
    });
  }
  if (receipt.integrity.sessionsCreated > receipt.campaign.attemptedTurns) {
    issues.push({
      path: "/integrity/sessionsCreated",
      message: "cannot exceed campaign.attemptedTurns"
    });
  }
  if (receipt.integrity.singleFinalSessions !== receipt.campaign.resultTurns) {
    issues.push({
      path: "/integrity/singleFinalSessions",
      message: "must equal campaign.resultTurns"
    });
  }
}

function validateMeasurements(receipt, issues) {
  const measurements = receipt.measurements;
  if (!measurements) {
    return;
  }
  for (const [field, value] of [
    ["turnLatencyMs", measurements.turnLatencyMs],
    ["manualTurnLatencyMs", measurements.manualTurnLatencyMs],
    ["syntheticAudioTurnLatencyMs", measurements.syntheticAudioTurnLatencyMs]
  ]) {
    if (value?.availability !== "measured") {
      continue;
    }
    if (!(value.p50 <= value.p95 && value.p95 <= value.max)) {
      issues.push({
        path: `/measurements/${field}`,
        message: "must satisfy p50 <= p95 <= max"
      });
    }
  }

  const rss = measurements.serverRss;
  if (rss?.availability === "measured" && rss.peak < Math.max(rss.start, rss.end)) {
    issues.push({
      path: "/measurements/serverRss/peak",
      message: "must be at least start and end RSS"
    });
  }
}

function validateQualification(receipt, issues) {
  if (!receipt.qualification) {
    return;
  }
  const expected = deriveHostSoftwareIntegrity(receipt);
  if (receipt.qualification.hostSoftwareIntegrity !== expected) {
    issues.push({
      path: "/qualification/hostSoftwareIntegrity",
      message: `must be ${expected} for the recorded campaign and integrity counters`
    });
  }

  const expectedHarnessStatus =
    receipt.campaign?.attemptedTurns !== receipt.campaign?.plannedTurns
      ? "error"
      : expected === "pass"
        ? "completed"
        : "failed";
  if (receipt.harnessStatus !== expectedHarnessStatus) {
    issues.push({
      path: "/harnessStatus",
      message: `must be ${expectedHarnessStatus} for the recorded outcome`
    });
  }
}

function scheduledTurnCount(plannedTurns, every) {
  return every > 0 ? Math.floor(plannedTurns / every) : 0;
}
