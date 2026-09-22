import { aggregateCandidateMetrics } from "./metrics.mjs";
import { assertSttBenchmarkReceipt, sha256 } from "./receipt.mjs";

const metricDefinitions = [
  ["failureRate", "lower_is_better"],
  ["cer", "lower_is_better"],
  ["wer", "lower_is_better"],
  ["codeSwitchTokenErrorRate", "lower_is_better"],
  ["codeSwitchBoundaryErrorRate", "lower_is_better"],
  ["silenceHallucinationRate", "lower_is_better"],
  ["keywordPreservationRate", "higher_is_better"],
  ["latencyP95Ms", "lower_is_better"],
  ["realTimeFactorP95", "lower_is_better"]
];

export function compareSttCandidates(receipt) {
  assertSttBenchmarkReceipt(receipt);

  const measuredCandidates = receipt.candidates.filter(
    (candidate) => candidate.availability === "measured"
  );
  const blockers = [];
  const addBlocker = (code, message) => {
    if (!blockers.some((blocker) => blocker.code === code)) {
      blockers.push({ code, message });
    }
  };

  if (measuredCandidates.length < 2) {
    addBlocker(
      "insufficient_measured_candidates",
      "At least two measured candidates are required for a comparison."
    );
  }
  if (measuredCandidates.length !== receipt.candidates.length) {
    addBlocker(
      "configured_candidate_set_incomplete",
      "At least one configured candidate was unavailable or failed before completing the corpus."
    );
  }
  if (receipt.environment.kind !== "target") {
    addBlocker(
      "target_device_evidence_absent",
      "Host measurements do not establish target-device latency, thermals, or resource fit."
    );
  }
  if (receipt.source.gitDirty) {
    addBlocker(
      "dirty_source",
      "The run came from a dirty worktree and is not tied to a reproducible source revision."
    );
  }
  if (!receipt.qualification.thresholdsLocked) {
    addBlocker(
      "release_threshold_policy_absent",
      "stt_benchmark_v1 has no policy-bound release thresholds."
    );
  }
  addBlocker(
    "resource_metrics_absent",
    "stt_benchmark_v1 does not record peak RSS, CPU, model initialization, temperature, throttling, power, or installed bytes."
  );
  addBlocker(
    "paired_uncertainty_absent",
    "The receipt has no speaker-group bootstrap intervals or paired uncertainty estimates."
  );
  addBlocker(
    "runtime_lifecycle_not_normalized",
    "Candidate adapter lifecycle costs differ and the receipt has no separate cold-start phase."
  );

  const missingSlices = measuredCandidates.flatMap((candidate) =>
    candidate.cases
      .filter((caseResult) => !Array.isArray(caseResult.slices) || caseResult.slices.length === 0)
      .map((caseResult) => `${candidate.id}:${caseResult.id}:${caseResult.iteration}`)
  );
  if (missingSlices.length > 0) {
    addBlocker(
      "slice_evidence_absent",
      `${missingSlices.length} measured case result(s) lack corpus slice labels.`
    );
  }
  if (!sliceAssignmentsMatch(measuredCandidates)) {
    addBlocker(
      "slice_labels_inconsistent",
      "The same corpus case has different slice labels across candidates."
    );
  }

  const measuredCandidateSummaries = measuredCandidates.map(summarizeCandidate);
  const pairwise = [];
  for (let leftIndex = 0; leftIndex < measuredCandidateSummaries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < measuredCandidateSummaries.length;
      rightIndex += 1
    ) {
      pairwise.push(
        comparePair(
          measuredCandidateSummaries[leftIndex],
          measuredCandidateSummaries[rightIndex]
        )
      );
    }
  }

  return {
    schemaVersion: "stt_comparison_v1",
    sourceReceipt: {
      runId: receipt.runId,
      canonicalSha256: sha256(canonicalJson(receipt)),
      gitSha: receipt.source.gitSha,
      gitDirty: receipt.source.gitDirty,
      configSha256: receipt.source.configSha256,
      lockfileSha256: receipt.source.lockfileSha256,
      corpusManifestSha256: receipt.corpus.manifestSha256 ?? null,
      environmentKind: receipt.environment.kind,
      profileId: receipt.environment.profileId
    },
    status: measuredCandidates.length >= 2 ? "comparison_only" : "not_comparable",
    winnerCandidateId: null,
    selectionAllowed: false,
    selectionReason:
      "stt_benchmark_v1 can expose same-corpus evidence and deltas, but cannot select a default model.",
    configuredCandidates: receipt.candidates.map((candidate) => ({
      id: candidate.id,
      family: candidate.family,
      availability: candidate.availability,
      reason: candidate.reason
    })),
    measuredCandidates: measuredCandidateSummaries,
    pairwise,
    blockers
  };
}

function summarizeCandidate(candidate) {
  const bySlice = new Map();
  for (const caseResult of candidate.cases) {
    for (const slice of caseResult.slices ?? []) {
      const cases = bySlice.get(slice) ?? [];
      cases.push(caseResult);
      bySlice.set(slice, cases);
    }
  }
  return {
    id: candidate.id,
    family: candidate.family,
    inputMatrixSha256: sha256(
      canonicalJson(
        [...candidate.cases]
          .sort((left, right) =>
            `${left.id}:${left.iteration}`.localeCompare(`${right.id}:${right.iteration}`)
          )
          .map(caseInputIdentity)
      )
    ),
    executionIdentity: {
      providerId: candidate.identity.providerId,
      runtime: candidate.identity.runtime,
      configurationId: candidate.identity.configurationId,
      identitySha256: sha256(canonicalJson(candidate.identity)),
      artifacts: candidate.identity.artifacts.map((artifact) => ({
        role: artifact.role,
        name: artifact.name,
        sha256: artifact.sha256,
        bytes: artifact.bytes
      }))
    },
    caseCount: candidate.cases.length,
    metrics: comparisonMetrics(candidate.cases),
    slices: [...bySlice.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, cases]) => ({
        id,
        caseCount: cases.length,
        metrics: comparisonMetrics(cases)
      }))
  };
}

function caseInputIdentity(caseResult) {
  return {
    id: caseResult.id,
    iteration: caseResult.iteration,
    slices: Array.isArray(caseResult.slices) ? [...caseResult.slices].sort() : null,
    audioSha256: caseResult.audioSha256,
    language: caseResult.language,
    metric: caseResult.metric,
    referenceSha256: caseResult.referenceSha256,
    audioDurationMs: caseResult.audioDurationMs,
    referenceUnits: caseResult.referenceUnits,
    boundaryReferenceUnits: caseResult.boundaryReferenceUnits,
    keywordTotal: caseResult.keywordTotal
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparisonMetrics(cases) {
  const aggregate = aggregateCandidateMetrics(cases);
  const totalCases = aggregate.completedCases + aggregate.failedCases;
  return {
    completedCases: aggregate.completedCases,
    failedCases: aggregate.failedCases,
    failureRate: roundedRate(aggregate.failedCases, totalCases),
    cer: aggregate.cer,
    wer: aggregate.wer,
    codeSwitchTokenErrorRate: aggregate.codeSwitchTokenErrorRate,
    codeSwitchBoundaryErrorRate: aggregate.codeSwitchBoundaryErrorRate,
    silenceHallucinationRate: aggregate.silenceHallucinationRate,
    keywordPreservationRate: aggregate.keywordPreservationRate,
    latencyP95Ms: aggregate.latencyMs.p95,
    realTimeFactorP95: aggregate.realTimeFactor.p95
  };
}

function comparePair(left, right) {
  const metrics = {};
  for (const [name, preference] of metricDefinitions) {
    const leftValue = left.metrics[name];
    const rightValue = right.metrics[name];
    metrics[name] = {
      preference,
      left: leftValue,
      right: rightValue,
      rightMinusLeft:
        typeof leftValue === "number" && typeof rightValue === "number"
          ? rounded(rightValue - leftValue)
          : null
    };
  }
  return {
    leftCandidateId: left.id,
    rightCandidateId: right.id,
    metrics
  };
}

function sliceAssignmentsMatch(candidates) {
  if (candidates.length < 2) {
    return true;
  }
  const baseline = sliceAssignments(candidates[0]);
  for (const candidate of candidates.slice(1)) {
    const observed = sliceAssignments(candidate);
    for (const [caseKey, slices] of baseline) {
      if (observed.get(caseKey) !== slices) {
        return false;
      }
    }
  }
  return true;
}

function sliceAssignments(candidate) {
  return new Map(
    candidate.cases.map((caseResult) => [
      `${caseResult.id}:${caseResult.iteration}`,
      Array.isArray(caseResult.slices) ? [...caseResult.slices].sort().join("\u0000") : ""
    ])
  );
}

function roundedRate(numerator, denominator) {
  return denominator === 0 ? null : rounded(numerator / denominator);
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
