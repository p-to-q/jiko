import test from "node:test";
import assert from "node:assert/strict";

import { readText, readTiming, readVoice, runReadings } from "../dist/index.js";

test("text reading distinguishes maintain and deviate language", () => {
  assert.equal(readText({ transcript: "还是先别做，晚点再说" }).state, "maintain");
  assert.equal(readText({ transcript: "我想离开这里，开始改变" }).state, "deviate");
});

test("missing STT confidence does not become a zero-confidence rejection", () => {
  const reading = readText({ transcript: "我想开始改变" });

  assert.equal(reading.state, "deviate");
  assert.equal("sttConfidence" in reading.features, false);
});

test("uncalibrated provider confidence is telemetry and cannot change the reading", () => {
  const withoutConfidence = readText({ transcript: "我想开始改变" });
  const withLowProviderConfidence = readText({
    transcript: "我想开始改变",
    sttConfidence: 0.01
  });

  assert.equal(withLowProviderConfidence.state, withoutConfidence.state);
  assert.equal(withLowProviderConfidence.confidence, withoutConfidence.confidence);
  assert.equal(withLowProviderConfidence.features.sttConfidence, 0.01);
  assert.equal(
    withLowProviderConfidence.features.sttConfidenceUsage,
    "telemetry_only"
  );
});

test("content reading reverses locally negated movement and maintain cues", () => {
  const negatedMovement = readText({ transcript: "我不想辞职" });
  const negatedMaintain = readText({ transcript: "I will not stay" });

  assert.equal(negatedMovement.state, "maintain");
  assert.equal(negatedMovement.features.negatedDeviateKeywordCount, 1);
  assert.equal(negatedMaintain.state, "deviate");
  assert.equal(negatedMaintain.features.negatedMaintainKeywordCount, 1);
});

test("content reading abstains when opposed cues coexist even with unequal counts", () => {
  const reading = readText({
    transcript: "我想离开、开始改变，但我也想留下"
  });

  assert.equal(reading.state, "static");
  assert.ok(reading.features.maintainKeywordCount > 0);
  assert.ok(reading.features.deviateKeywordCount > 0);
});

test("content reading applies English word boundaries", () => {
  const reading = readText({
    transcript: "We can exchange notes and forgo nothing."
  });

  assert.equal(reading.state, "static");
  assert.equal(reading.features.deviateKeywordCount, 0);
});

test("content reading inspects repeated cue polarity instead of only the first match", () => {
  const reading = readText({
    transcript: "I do not want to stay, but after thinking I will stay."
  });

  assert.equal(reading.state, "static");
  assert.equal(reading.features.maintainKeywordCount, 1);
  assert.equal(reading.features.deviateKeywordCount, 1);
});

test("generic Chinese question nouns are not treated as an action cue", () => {
  const reading = readText({ transcript: "我还有一个问题需要想清楚" });

  assert.equal(reading.state, "static");
  assert.equal(reading.features.deviateKeywordCount, 0);
});

test("short or unusable audio remains static", () => {
  assert.equal(readVoice({ durationMs: 600, speechMs: 300 }).state, "static");
  assert.equal(readTiming({ durationMs: 600, speechMs: 300 }).state, "static");
});

test("all heuristic confidences stay below the declared ceiling", () => {
  const readings = runReadings({
    text: { transcript: "我想离开，开始改变" },
    voice: {
      durationMs: 4_000,
      speechMs: 3_300,
      silenceMs: 700,
      pauseCount: 1,
      longestPauseMs: 300,
      rmsMean: 0.12,
      rmsStd: 0.05,
      rmsPeak: 0.35,
      pitchStdHz: 50
    },
    timing: {
      durationMs: 4_000,
      speechMs: 3_300,
      preSpeechDelayMs: 200,
      pauseCount: 1,
      longestPauseMs: 300
    }
  });

  assert.equal(readings.every((reading) => reading.confidence <= 0.74), true);
});
