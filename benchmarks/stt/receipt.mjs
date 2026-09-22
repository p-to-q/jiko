import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { aggregateCandidateMetrics } from "./metrics.mjs";

const sttDirectory = path.dirname(fileURLToPath(import.meta.url));
export const sttBenchmarkSchemaPath = path.join(
  sttDirectory,
  "schema",
  "stt-benchmark-v1.schema.json"
);

const schema = JSON.parse(readFileSync(sttBenchmarkSchemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);
const providerByFamily = {
  sensevoice: "local:sherpa-onnx-sensevoice",
  whisper_cpp: "local:whisper.cpp",
  funasr: "self-hosted:funasr-http:loopback"
};
const requiredArtifactRoles = {
  sensevoice: ["runtime", "worker", "model", "tokens", "configuration"],
  whisper_cpp: ["runtime", "model", "configuration"],
  funasr: ["runtime", "model", "configuration", "identity_manifest"]
};

export function validateSttBenchmarkReceipt(receipt) {
  const issues = [];
  if (!validateSchema(receipt)) {
    for (const error of validateSchema.errors ?? []) {
      issues.push({
        path: error.instancePath || "/",
        message: `schema: ${error.message ?? "invalid value"}`
      });
    }
  }

  if (receipt && typeof receipt === "object") {
    validateTime(receipt, issues);
    validateCorpus(receipt, issues);
    validateCandidates(receipt, issues);
    validateEvidenceBoundary(receipt, issues);
  }

  return { ok: issues.length === 0, issues };
}

export function assertSttBenchmarkReceipt(receipt) {
  const result = validateSttBenchmarkReceipt(receipt);
  if (!result.ok) {
    const detail = result.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid stt_benchmark_v1 receipt:\n${detail}`);
  }
  return receipt;
}

export function deriveEvidenceLevel(receipt) {
  const measured = Array.isArray(receipt?.candidates)
    ? receipt.candidates.some((candidate) => candidate?.availability === "measured")
    : false;
  if (!measured) {
    return "not_evaluated";
  }
  return receipt?.environment?.kind === "target"
    ? "target_measured"
    : "host_measured";
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateTime(receipt, issues) {
  const startedAt = Date.parse(receipt.startedAt);
  const finishedAt = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(startedAt)) {
    issues.push({ path: "/startedAt", message: "must be a valid timestamp" });
  }
  if (!Number.isFinite(finishedAt)) {
    issues.push({ path: "/finishedAt", message: "must be a valid timestamp" });
  }
  if (Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt < startedAt) {
    issues.push({ path: "/finishedAt", message: "must not precede startedAt" });
  }
}

function validateCorpus(receipt, issues) {
  const corpus = receipt.corpus;
  if (!corpus || typeof corpus !== "object" || !Array.isArray(corpus.caseIds)) {
    return;
  }
  if (corpus.caseCount !== corpus.caseIds.length) {
    issues.push({
      path: "/corpus/caseCount",
      message: "must equal the number of declared caseIds"
    });
  }
}

function validateCandidates(receipt, issues) {
  if (!Array.isArray(receipt.candidates)) {
    return;
  }
  const ids = new Set();
  const families = new Set();
  for (const [index, candidate] of receipt.candidates.entries()) {
    const pointer = `/candidates/${index}`;
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    if (ids.has(candidate.id)) {
      issues.push({ path: `${pointer}/id`, message: "must be unique" });
    }
    ids.add(candidate.id);
    if (families.has(candidate.family)) {
      issues.push({
        path: `${pointer}/family`,
        message: "only one result per candidate family is allowed in one run"
      });
    }
    families.add(candidate.family);

    if (candidate.availability === "measured") {
      validateMeasuredCandidate(receipt, candidate, pointer, issues);
    } else if (candidate.availability === "failed" && candidate.cases?.length === 0) {
      issues.push({
        path: `${pointer}/cases`,
        message: "failed execution must retain at least one hashed case result"
      });
    }
  }
  validateCrossCandidateInputs(receipt.candidates, issues);
}

function validateMeasuredCandidate(receipt, candidate, pointer, issues) {
  if (
    receipt.corpus?.availability !== "verified" ||
    receipt.corpus?.caseCount < 1 ||
    receipt.measurement?.measuredIterations < 1
  ) {
    issues.push({
      path: pointer,
      message: "measured candidates require a verified corpus and at least one measured iteration"
    });
    return;
  }

  const expectedProvider = providerByFamily[candidate.family];
  if (candidate.identity?.providerId !== expectedProvider) {
    issues.push({
      path: `${pointer}/identity/providerId`,
      message: `must be ${expectedProvider}`
    });
  }
  validateIdentity(candidate, pointer, issues);
  validateCaseCoverage(receipt, candidate, pointer, issues);
  validateMetricArithmetic(candidate, pointer, issues);
}

function validateIdentity(candidate, pointer, issues) {
  const artifacts = candidate.identity?.artifacts;
  if (!Array.isArray(artifacts)) {
    return;
  }
  const artifactKeys = new Set();
  const roles = new Set();
  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const key = `${artifact?.role}:${artifact?.name}`;
    if (artifactKeys.has(key)) {
      issues.push({
        path: `${pointer}/identity/artifacts/${artifactIndex}`,
        message: "artifact role/name pairs must be unique"
      });
    }
    artifactKeys.add(key);
    roles.add(artifact?.role);
  }
  for (const role of requiredArtifactRoles[candidate.family] ?? []) {
    if (!roles.has(role)) {
      issues.push({
        path: `${pointer}/identity/artifacts`,
        message: `candidate family ${candidate.family} requires artifact role ${role}`
      });
    }
  }
  const configurationArtifacts = artifacts.filter(
    (artifact) => artifact?.role === "configuration"
  );
  if (
    !configurationArtifacts.some(
      (artifact) => artifact?.sha256 === candidate.identity?.configurationId
    )
  ) {
    issues.push({
      path: `${pointer}/identity/configurationId`,
      message: "must equal a configuration artifact SHA-256"
    });
  }
}

function validateCaseCoverage(receipt, candidate, pointer, issues) {
  if (!Array.isArray(candidate.cases) || !Array.isArray(receipt.corpus?.caseIds)) {
    return;
  }
  const expected = new Set();
  for (const id of receipt.corpus.caseIds) {
    for (let iteration = 1; iteration <= receipt.measurement.measuredIterations; iteration += 1) {
      expected.add(`${id}:${iteration}`);
    }
  }
  const observed = new Set();
  const inputByCase = new Map();
  for (const [caseIndex, caseResult] of candidate.cases.entries()) {
    const key = `${caseResult?.id}:${caseResult?.iteration}`;
    if (observed.has(key)) {
      issues.push({
        path: `${pointer}/cases/${caseIndex}`,
        message: "case id/iteration pairs must be unique"
      });
    }
    observed.add(key);
    if (!expected.has(key)) {
      issues.push({
        path: `${pointer}/cases/${caseIndex}`,
        message: "is not part of the verified corpus/iteration matrix"
      });
    }
    validateCaseMetric(caseResult, `${pointer}/cases/${caseIndex}`, issues);
    const priorInput = inputByCase.get(caseResult?.id);
    if (priorInput) {
      compareCaseInputs(
        priorInput,
        caseResult,
        `${pointer}/cases/${caseIndex}`,
        "must stay constant across iterations",
        issues
      );
    }
    inputByCase.set(caseResult?.id, caseResult);
  }
  for (const key of expected) {
    if (!observed.has(key)) {
      issues.push({ path: `${pointer}/cases`, message: `missing verified case iteration ${key}` });
    }
  }
}

function validateCrossCandidateInputs(candidates, issues) {
  const measured = candidates.filter(
    (candidate) => candidate?.availability === "measured" && Array.isArray(candidate.cases)
  );
  if (measured.length < 2) {
    return;
  }
  const baseline = new Map(
    measured[0].cases.map((caseResult) => [
      `${caseResult.id}:${caseResult.iteration}`,
      caseResult
    ])
  );
  for (const candidate of measured.slice(1)) {
    const candidateIndex = candidates.indexOf(candidate);
    for (const [caseIndex, caseResult] of candidate.cases.entries()) {
      const key = `${caseResult.id}:${caseResult.iteration}`;
      const expected = baseline.get(key);
      if (!expected) {
        continue;
      }
      compareCaseInputs(
        expected,
        caseResult,
        `/candidates/${candidateIndex}/cases/${caseIndex}`,
        "must match the same case input recorded by every measured candidate",
        issues
      );
    }
  }
}

const caseInputFields = [
  "audioSha256",
  "language",
  "metric",
  "referenceSha256",
  "referenceUnits",
  "boundaryReferenceUnits",
  "keywordTotal"
];

function compareCaseInputs(expected, actual, pointer, message, issues) {
  for (const field of caseInputFields) {
    if (actual?.[field] !== expected?.[field]) {
      issues.push({ path: `${pointer}/${field}`, message });
    }
  }
  if (
    Number.isFinite(expected?.audioDurationMs) &&
    Number.isFinite(actual?.audioDurationMs) &&
    Math.abs(expected.audioDurationMs - actual.audioDurationMs) > 0.001
  ) {
    issues.push({ path: `${pointer}/audioDurationMs`, message });
  }
}

function validateCaseMetric(caseResult, pointer, issues) {
  const expectedMetric = {
    zh: "cer",
    en: "wer",
    code_switch: "code_switch_token_error",
    silence: "silence_hallucination"
  }[caseResult?.language];
  if (expectedMetric && caseResult.metric !== expectedMetric) {
    issues.push({ path: `${pointer}/metric`, message: `must be ${expectedMetric}` });
  }
  if (
    caseResult?.language !== "code_switch" &&
    (caseResult?.boundaryErrors !== 0 || caseResult?.boundaryReferenceUnits !== 0)
  ) {
    issues.push({
      path: pointer,
      message: "only code-switch cases may report language-run boundary units"
    });
  }
  if (
    caseResult?.language === "silence" &&
    (caseResult?.referenceUnits !== 0 || caseResult?.keywordTotal !== 0)
  ) {
    issues.push({
      path: pointer,
      message: "silence cases must have zero reference and keyword units"
    });
  }
  if (caseResult?.keywordHits > caseResult?.keywordTotal) {
    issues.push({ path: `${pointer}/keywordHits`, message: "cannot exceed keywordTotal" });
  }
}

function validateMetricArithmetic(candidate, pointer, issues) {
  if (!candidate.metrics || !Array.isArray(candidate.cases) || candidate.cases.length === 0) {
    return;
  }
  const expected = aggregateCandidateMetrics(candidate.cases);
  compareMetricObject(candidate.metrics, expected, `${pointer}/metrics`, issues);
}

function compareMetricObject(actual, expected, pointer, issues) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (expectedValue && typeof expectedValue === "object") {
      compareMetricObject(actualValue ?? {}, expectedValue, `${pointer}/${key}`, issues);
    } else if (!sameMetricValue(actualValue, expectedValue)) {
      issues.push({
        path: `${pointer}/${key}`,
        message: `must equal the value recomputed from case receipts (${String(expectedValue)})`
      });
    }
  }
}

function sameMetricValue(actual, expected) {
  if (actual === null || expected === null) {
    return actual === expected;
  }
  if (typeof actual === "number" && typeof expected === "number") {
    return Number.isFinite(actual) && Math.abs(actual - expected) <= 0.000001;
  }
  return actual === expected;
}

function validateEvidenceBoundary(receipt, issues) {
  const derivedEvidenceLevel = deriveEvidenceLevel(receipt);
  if (receipt.qualification?.evidenceLevel !== derivedEvidenceLevel) {
    issues.push({
      path: "/qualification/evidenceLevel",
      message: `must be ${derivedEvidenceLevel} for the recorded candidate evidence`
    });
  }

  if (receipt.qualification?.evidenceLevel === "target_measured") {
    if (
      receipt.environment?.kind !== "target" ||
      !receipt.environment?.dutId ||
      !receipt.environment?.hardwareRevision ||
      !receipt.environment?.osImageSha256 ||
      !receipt.environment?.powerMode
    ) {
      issues.push({
        path: "/environment",
        message: "target evidence requires DUT, hardware, OS-image, and power identities"
      });
    }
  }

  if (
    receipt.qualification?.thresholdsLocked === false &&
    receipt.qualification?.verdict !== "not_evaluated"
  ) {
    issues.push({
      path: "/qualification/verdict",
      message: "cannot pass or fail a release gate before thresholds are locked"
    });
  }

  if (receipt.qualification?.thresholdsLocked === true) {
    issues.push({
      path: "/qualification/thresholdsLocked",
      message: "stt_benchmark_v1 has no policy-bound threshold artifact; thresholdsLocked must remain false"
    });
  }
}
