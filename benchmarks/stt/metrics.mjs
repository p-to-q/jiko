export const sttNormalizationId = "jiko-stt-text-normalization-v1";

export function evaluateTranscript({ language, reference, hypothesis, keywords }) {
  const referenceUnits = unitsForLanguage(reference, language);
  const hypothesisUnits = unitsForLanguage(hypothesis, language);
  const keywordHits = keywords.filter((keyword) =>
    containsSequence(
      hypothesisUnits,
      unitsForLanguage(keyword, language === "silence" ? "en" : language)
    )
  ).length;

  if (language === "silence") {
    return {
      metric: "silence_hallucination",
      errorUnits: hasRecognizableContent(hypothesis) ? 1 : 0,
      referenceUnits: 0,
      boundaryErrors: 0,
      boundaryReferenceUnits: 0,
      keywordHits: 0,
      keywordTotal: 0
    };
  }

  if (language === "code_switch") {
    const referenceRuns = languageRuns(referenceUnits);
    const hypothesisRuns = languageRuns(hypothesisUnits);
    return {
      metric: "code_switch_token_error",
      errorUnits: editDistance(referenceUnits, hypothesisUnits),
      referenceUnits: referenceUnits.length,
      boundaryErrors: editDistance(referenceRuns, hypothesisRuns),
      boundaryReferenceUnits: referenceRuns.length,
      keywordHits,
      keywordTotal: keywords.length
    };
  }

  return {
    metric: language === "zh" ? "cer" : "wer",
    errorUnits: editDistance(referenceUnits, hypothesisUnits),
    referenceUnits: referenceUnits.length,
    boundaryErrors: 0,
    boundaryReferenceUnits: 0,
    keywordHits,
    keywordTotal: keywords.length
  };
}

export function aggregateCandidateMetrics(cases) {
  const totals = {
    completedCases: 0,
    failedCases: 0,
    characterErrors: 0,
    characterReferenceUnits: 0,
    wordErrors: 0,
    wordReferenceUnits: 0,
    codeSwitchErrors: 0,
    codeSwitchReferenceUnits: 0,
    codeSwitchBoundaryErrors: 0,
    codeSwitchBoundaryReferenceUnits: 0,
    silenceCases: 0,
    silenceHallucinations: 0,
    keywordHits: 0,
    keywordTotal: 0
  };
  const latencies = [];
  const realTimeFactors = [];

  for (const result of cases) {
    if (result.outcome === "completed") {
      totals.completedCases += 1;
    } else {
      totals.failedCases += 1;
    }
    if (result.metric === "cer") {
      totals.characterErrors += result.errorUnits;
      totals.characterReferenceUnits += result.referenceUnits;
    } else if (result.metric === "wer") {
      totals.wordErrors += result.errorUnits;
      totals.wordReferenceUnits += result.referenceUnits;
    } else if (result.metric === "code_switch_token_error") {
      totals.codeSwitchErrors += result.errorUnits;
      totals.codeSwitchReferenceUnits += result.referenceUnits;
      totals.codeSwitchBoundaryErrors += result.boundaryErrors;
      totals.codeSwitchBoundaryReferenceUnits += result.boundaryReferenceUnits;
    } else if (result.metric === "silence_hallucination") {
      totals.silenceCases += 1;
      totals.silenceHallucinations += result.errorUnits;
    }
    totals.keywordHits += result.keywordHits;
    totals.keywordTotal += result.keywordTotal;
    latencies.push(result.latencyMs);
    realTimeFactors.push(result.latencyMs / result.audioDurationMs);
  }

  return {
    ...totals,
    cer: rate(totals.characterErrors, totals.characterReferenceUnits),
    wer: rate(totals.wordErrors, totals.wordReferenceUnits),
    codeSwitchTokenErrorRate: rate(
      totals.codeSwitchErrors,
      totals.codeSwitchReferenceUnits
    ),
    codeSwitchBoundaryErrorRate: rate(
      totals.codeSwitchBoundaryErrors,
      totals.codeSwitchBoundaryReferenceUnits
    ),
    silenceHallucinationRate: rate(
      totals.silenceHallucinations,
      totals.silenceCases
    ),
    keywordPreservationRate: rate(totals.keywordHits, totals.keywordTotal),
    latencyMs: distribution(latencies),
    realTimeFactor: distribution(realTimeFactors)
  };
}

export function unitsForLanguage(value, language) {
  const normalized = String(value ?? "").normalize("NFKC").toLocaleLowerCase("en");
  if (language === "zh") {
    return Array.from(normalized).filter((character) => /[\p{L}\p{N}]/u.test(character));
  }
  if (language === "code_switch") {
    return normalized.match(/[\p{Script=Han}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  }
  return normalized.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

export function languageRuns(tokens) {
  const runs = [];
  for (const token of tokens) {
    const current = /^[\p{Script=Han}]+$/u.test(token) ? "zh" : "en";
    if (runs.at(-1) !== current) {
      runs.push(current);
    }
  }
  return runs;
}

export function editDistance(reference, hypothesis) {
  const previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex += 1) {
    const current = [referenceIndex];
    for (let hypothesisIndex = 1; hypothesisIndex <= hypothesis.length; hypothesisIndex += 1) {
      const substitution = previous[hypothesisIndex - 1] +
        (reference[referenceIndex - 1] === hypothesis[hypothesisIndex - 1] ? 0 : 1);
      current[hypothesisIndex] = Math.min(
        previous[hypothesisIndex] + 1,
        current[hypothesisIndex - 1] + 1,
        substitution
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[hypothesis.length];
}

function containsSequence(haystack, needle) {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, index) => haystack[start + index] === token)) {
      return true;
    }
  }
  return false;
}

function hasRecognizableContent(value) {
  return /[\p{L}\p{N}]/u.test(String(value ?? "").normalize("NFKC"));
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : rounded(numerator / denominator);
}

function distribution(values) {
  if (values.length === 0) {
    throw new Error("cannot build a distribution without samples");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p50: rounded(nearestRank(sorted, 0.5)),
    p95: rounded(nearestRank(sorted, 0.95)),
    max: rounded(sorted.at(-1))
  };
}

function nearestRank(sorted, percentile) {
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function rounded(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
