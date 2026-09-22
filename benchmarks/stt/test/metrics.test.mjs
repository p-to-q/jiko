import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCandidateMetrics,
  evaluateTranscript
} from "../metrics.mjs";

test("computes Chinese CER and English WER from normalized units", () => {
  const chinese = evaluateTranscript({
    language: "zh",
    reference: "我想改变。",
    hypothesis: "我想改",
    keywords: ["改变"]
  });
  const english = evaluateTranscript({
    language: "en",
    reference: "We stay here.",
    hypothesis: "we go here",
    keywords: ["stay", "here"]
  });

  assert.equal(chinese.metric, "cer");
  assert.equal(chinese.errorUnits, 1);
  assert.equal(chinese.referenceUnits, 4);
  assert.equal(chinese.keywordHits, 0);
  assert.equal(english.metric, "wer");
  assert.equal(english.errorUnits, 1);
  assert.equal(english.referenceUnits, 3);
  assert.equal(english.keywordHits, 1);
});

test("code-switch metric reports token and language-run errors separately", () => {
  const preservedBoundary = evaluateTranscript({
    language: "code_switch",
    reference: "我 want 改变",
    hypothesis: "我 want 保持",
    keywords: ["want"]
  });
  const lostBoundary = evaluateTranscript({
    language: "code_switch",
    reference: "我 want 改变",
    hypothesis: "我改变",
    keywords: ["want"]
  });

  assert.equal(preservedBoundary.errorUnits, 2);
  assert.equal(preservedBoundary.referenceUnits, 4);
  assert.equal(preservedBoundary.boundaryErrors, 0);
  assert.equal(preservedBoundary.boundaryReferenceUnits, 3);
  assert.equal(lostBoundary.boundaryErrors, 2);
  assert.equal(lostBoundary.keywordHits, 0);
});

test("silence distinguishes punctuation from hallucinated speech", () => {
  const punctuation = evaluateTranscript({
    language: "silence",
    reference: "",
    hypothesis: "...",
    keywords: []
  });
  const hallucination = evaluateTranscript({
    language: "silence",
    reference: "",
    hypothesis: "hello",
    keywords: []
  });

  assert.equal(punctuation.errorUnits, 0);
  assert.equal(hallucination.errorUnits, 1);
});

test("aggregate metrics bind rates and distributions to case receipts", () => {
  const cases = [
    caseResult({ metric: "cer", errorUnits: 1, referenceUnits: 4, latencyMs: 10 }),
    caseResult({ metric: "wer", errorUnits: 1, referenceUnits: 2, latencyMs: 20 }),
    caseResult({
      metric: "silence_hallucination",
      errorUnits: 1,
      referenceUnits: 0,
      keywordHits: 0,
      keywordTotal: 0,
      latencyMs: 30
    })
  ];
  const metrics = aggregateCandidateMetrics(cases);

  assert.equal(metrics.cer, 0.25);
  assert.equal(metrics.wer, 0.5);
  assert.equal(metrics.silenceHallucinationRate, 1);
  assert.equal(metrics.latencyMs.p50, 20);
  assert.equal(metrics.latencyMs.p95, 30);
  assert.equal(metrics.latencyMs.samples, 3);
});

function caseResult(overrides) {
  return {
    outcome: "completed",
    metric: "cer",
    errorUnits: 0,
    referenceUnits: 1,
    boundaryErrors: 0,
    boundaryReferenceUnits: 0,
    keywordHits: 1,
    keywordTotal: 1,
    latencyMs: 10,
    audioDurationMs: 100,
    ...overrides
  };
}
