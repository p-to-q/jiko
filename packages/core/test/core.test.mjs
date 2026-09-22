import test from "node:test";
import assert from "node:assert/strict";

import {
  canApplySessionEvent,
  canAcceptExternalEvent,
  classifySessionEvent,
  composeSessionReceipt,
  composeSessionResult,
  createInitialSessionState,
  projectInstrumentScene,
  reduceSessionEvent
} from "../dist/index.js";

const readings = [
  { channel: "text", state: "deviate", confidence: 0.64, features: {} },
  { channel: "voice", state: "deviate", confidence: 0.66, features: {} },
  { channel: "timing", state: "maintain", confidence: 0.59, features: {} }
];

test("manual and hardware events use the same reducer", () => {
  const initial = createInitialSessionState();
  const recording = reduceSessionEvent(initial, {
    type: "input.recording.started",
    sessionId: "device-001",
    attemptId: "attempt-device-001",
    sequence: 1,
    timestamp: 100,
    source: "device"
  });
  const processing = reduceSessionEvent(recording, {
    type: "input.recording.stopped",
    sessionId: "device-001",
    attemptId: "attempt-device-001",
    sequence: 2,
    timestamp: 200,
    source: "device",
    durationMs: 100
  });

  assert.equal(recording.phase, "recording");
  assert.equal(processing.phase, "processing");
});

test("result composition is deterministic for the same receipt", () => {
  const input = { sessionId: "stable-session", readings, silenceMs: 3_200 };
  const first = composeSessionResult(input);
  const second = composeSessionResult(input);

  assert.deepEqual(first, second);
  assert.equal(first.majorityState, "deviate");
  assert.deepEqual(first.minorityStates, ["maintain"]);
  assert.equal(first.topWindow.status, "minority_exists");
});

test("result composition canonicalizes minority states independently of input order", () => {
  const result = composeSessionResult({
    sessionId: "canonical-minority-states",
    readings: [
      { channel: "timing", state: "static", confidence: 0.6, features: {} },
      { channel: "text", state: "deviate", confidence: 0.8, features: {} },
      { channel: "voice", state: "maintain", confidence: 0.7, features: {} }
    ]
  });

  assert.equal(result.majorityState, undefined);
  assert.deepEqual(result.minorityStates, ["maintain", "deviate", "static"]);
  assert.equal(result.topWindow.status, "mixed");
});

test("result composition refuses duplicate or incomplete product channels", () => {
  assert.throws(
    () => composeSessionResult({
      sessionId: "duplicate-lines",
      readings: readings.map((reading) => ({ ...reading, channel: "text" }))
    }),
    /each channel|text, voice, and timing/
  );
  assert.throws(
    () => composeSessionResult({
      sessionId: "missing-line",
      readings: readings.slice(0, 2)
    }),
    /text, voice, and timing/
  );
});

test("the instrument scene is a pure projection of shared session state", () => {
  const state = {
    ...createInitialSessionState("scene-session", "scene-attempt"),
    phase: "reading",
    readings: {
      text: {
        channel: "text",
        state: "maintain",
        confidence: 0.7,
        availability: "measured",
        features: {}
      },
      voice: {
        channel: "voice",
        state: "static",
        confidence: 0.5,
        availability: "unavailable",
        features: {}
      }
    }
  };

  assert.deepEqual(projectInstrumentScene(state), {
    phase: "processing",
    topTitle: "READING",
    topSubtitle: "PROCESSING",
    lamps: { text: "red", voice: "dim", timing: "dim" },
    lampMotions: { text: "locked", voice: "locked", timing: "spinning" }
  });
});

test("result and silence scenes preserve canonical copy and signal semantics", () => {
  const result = composeSessionResult({
    sessionId: "scene-result",
    readings
  });
  const resultState = {
    ...createInitialSessionState("scene-result", "scene-attempt"),
    phase: "result",
    readings: Object.fromEntries(readings.map((reading) => [reading.channel, reading])),
    result
  };

  const resultScene = projectInstrumentScene(resultState);
  const silenceScene = projectInstrumentScene({ ...resultState, phase: "silence" });

  assert.equal(resultScene.phase, "result");
  assert.equal(resultScene.topTitle, result.topWindow.lineZh);
  assert.equal(resultScene.topSubtitle, result.topWindow.lineEn);
  assert.deepEqual(resultScene.lamps, {
    text: "green",
    voice: "green",
    timing: "red"
  });
  assert.deepEqual(silenceScene, resultScene);
});

test("runtime errors stay visually unclear instead of becoming red verdicts", () => {
  const scene = projectInstrumentScene({
    ...createInitialSessionState("scene-error", "scene-attempt"),
    phase: "error",
    errors: ["local provider timed out and needs a reset"]
  });

  assert.equal(scene.phase, "error");
  assert.equal(scene.topTitle, "ERROR");
  assert.equal(scene.topSubtitle, "LOCAL PROVIDER TIMED O");
  assert.deepEqual(scene.lamps, { text: "amber", voice: "amber", timing: "amber" });
});

test("empty readings produce a non-speaking waiting result", () => {
  const result = composeSessionResult({ sessionId: "empty", readings: [] });

  assert.equal(result.topWindow.status, "empty");
  assert.equal(result.tts, undefined);
});

test("external controls cannot skip or duplicate recording transitions", () => {
  assert.equal(canAcceptExternalEvent("created", "input.recording.started"), true);
  assert.equal(canAcceptExternalEvent("created", "input.recording.stopped"), false);
  assert.equal(canAcceptExternalEvent("recording", "input.recording.started"), false);
  assert.equal(canAcceptExternalEvent("recording", "input.recording.stopped"), true);
  assert.equal(canAcceptExternalEvent("reading", "session.silence"), false);
  assert.equal(canAcceptExternalEvent("result", "session.silence"), true);
  assert.equal(canAcceptExternalEvent("error", "session.reset"), true);
});

test("the shared transition contract seals result and reset states", () => {
  assert.equal(canApplySessionEvent("created", "audio.transcribed"), true);
  assert.equal(canApplySessionEvent("processing", "reading.started"), true);
  assert.equal(canApplySessionEvent("reading", "session.result"), true);
  assert.equal(canApplySessionEvent("result", "tts.started"), true);
  assert.equal(canApplySessionEvent("result", "audio.uploaded"), false);
  assert.equal(canApplySessionEvent("reset", "input.recording.started"), false);
  assert.equal(canApplySessionEvent("reset", "session.error"), false);
  assert.equal(canApplySessionEvent("reset", "session.reset"), false);
  assert.equal(canApplySessionEvent("error", "session.error"), false);
  assert.equal(canApplySessionEvent("error", "session.reset"), true);
});

test("an unavailable line cannot be counted as static consensus", () => {
  const result = composeSessionResult({
    sessionId: "partial-session",
    readings: [
      {
        channel: "text",
        state: "static",
        confidence: 0.44,
        availability: "unavailable",
        features: {}
      },
      {
        channel: "voice",
        state: "deviate",
        confidence: 0.6,
        availability: "measured",
        features: {}
      },
      {
        channel: "timing",
        state: "deviate",
        confidence: 0.58,
        availability: "measured",
        features: {}
      }
    ]
  });

  assert.equal(result.majorityState, "deviate");
  assert.equal(result.topWindow.status, "partial");
  assert.deepEqual(result.coverage.unavailableChannels, ["text"]);
  assert.equal(result.colors.text, "signal.unavailable");
  assert.equal(result.tts, undefined);
});

test("coverage uses canonical channel order even when inputs arrive out of order", () => {
  const result = composeSessionResult({
    sessionId: "out-of-order-coverage",
    readings: [
      {
        channel: "timing",
        state: "static",
        confidence: 0,
        availability: "unavailable",
        features: {}
      },
      {
        channel: "voice",
        state: "maintain",
        confidence: 0.7,
        availability: "measured",
        features: {}
      },
      {
        channel: "text",
        state: "static",
        confidence: 0,
        availability: "unavailable",
        features: {}
      }
    ]
  });

  assert.deepEqual(result.coverage.unavailableChannels, ["text", "timing"]);
});

test("shared receipts can carry observer-only pipeline diagnostics", () => {
  const state = reduceSessionEvent(createInitialSessionState(), {
    type: "session.created",
    sessionId: "receipt-session",
    attemptId: "attempt-receipt-session",
    sequence: 1,
    timestamp: 100,
    source: "device"
  });
  const pipeline = {
    startedAt: "2026-09-17T00:00:00.000Z",
    finishedAt: "2026-09-17T00:00:00.012Z",
    totalLatencyMs: 12,
    stages: [
      {
        stage: "total",
        status: "ready",
        latencyMs: 12,
        provider: "jiko:audio-pipeline-v1"
      }
    ]
  };
  const receipt = composeSessionReceipt(state, {
    startedAt: "2026-09-17T00:00:00.000Z",
    pipeline
  });

  assert.deepEqual(receipt.pipeline, pipeline);
  assert.equal(receipt.schemaVersion, "session_receipt_v1");
  assert.equal(receipt.attemptId, "attempt-receipt-session");
  assert.equal(receipt.lastSequence, 1);
  assert.equal(receipt.status, "created");
  assert.equal(receipt.source, "device");
  assert.deepEqual(receipt.input, { audioStored: false });
});

test("a bound session rejects interleaved events from another session", () => {
  const stateA = reduceSessionEvent(createInitialSessionState("session-a"), {
    type: "session.created",
    sessionId: "session-a",
    attemptId: "attempt-a",
    sequence: 1,
    timestamp: 1,
    source: "browser"
  });
  const eventB = {
    type: "session.created",
    sessionId: "session-b",
    attemptId: "attempt-b",
    sequence: 1,
    timestamp: 2,
    source: "browser"
  };

  assert.equal(classifySessionEvent(stateA, eventB), "foreign_session");
  assert.throws(() => reduceSessionEvent(stateA, eventB), /foreign_session/);
  assert.equal(stateA.sessionId, "session-a");
  assert.deepEqual(stateA.readings, {});
});

test("session event replay is idempotent and sequence gaps are explicit", () => {
  const created = {
    type: "session.created",
    sessionId: "replay-session",
    attemptId: "replay-attempt",
    sequence: 1,
    timestamp: 1,
    source: "device"
  };
  const state = reduceSessionEvent(createInitialSessionState("replay-session"), created);

  assert.strictEqual(reduceSessionEvent(state, created), state);
  assert.equal(classifySessionEvent(state, { ...created, sequence: 3 }), "sequence_gap");
  assert.throws(
    () => reduceSessionEvent(state, { ...created, sequence: 3 }),
    /sequence_gap/
  );
});

test("terminal reset rejects late TTS and pipeline events", () => {
  const reset = reduceSessionEvent(createInitialSessionState("tts-session"), {
    type: "session.reset",
    sessionId: "tts-session",
    attemptId: "tts-attempt",
    sequence: 1,
    timestamp: 1,
    source: "operator"
  });

  assert.throws(
    () => reduceSessionEvent(reset, {
      type: "tts.started",
      sessionId: "tts-session",
      attemptId: "tts-attempt",
      sequence: 2,
      timestamp: 2,
      source: "server",
      tts: { language: "zh", text: "完成" }
    }),
    /invalid_transition/
  );
  assert.throws(
    () => reduceSessionEvent(reset, {
      type: "audio.transcribed",
      sessionId: "tts-session",
      attemptId: "tts-attempt",
      sequence: 2,
      timestamp: 2,
      source: "server",
      transcript: { text: "late", provider: "test" }
    }),
    /invalid_transition/
  );
  assert.throws(
    () => reduceSessionEvent(reset, {
      type: "session.error",
      sessionId: "tts-session",
      attemptId: "tts-attempt",
      sequence: 2,
      timestamp: 2,
      source: "server",
      message: "late failure",
      recoverable: true
    }),
    /invalid_transition/
  );
  assert.equal(reset.phase, "reset");
  assert.equal(reset.lastSequence, 1);
});

test("terminal errors reject late work until an explicit reset", () => {
  const failed = reduceSessionEvent(createInitialSessionState("error-session"), {
    type: "session.error",
    sessionId: "error-session",
    attemptId: "error-attempt",
    sequence: 1,
    timestamp: 1,
    source: "server",
    message: "failed",
    recoverable: true
  });

  assert.throws(
    () => reduceSessionEvent(failed, {
      type: "reading.started",
      sessionId: "error-session",
      attemptId: "error-attempt",
      sequence: 2,
      timestamp: 2,
      source: "server"
    }),
    /invalid_transition/
  );
  assert.throws(
    () => reduceSessionEvent(failed, {
      type: "session.error",
      sessionId: "error-session",
      attemptId: "error-attempt",
      sequence: 2,
      timestamp: 2,
      source: "server",
      message: "duplicate failure",
      recoverable: true
    }),
    /invalid_transition/
  );

  const reset = reduceSessionEvent(failed, {
    type: "session.reset",
    sessionId: "error-session",
    attemptId: "error-attempt",
    sequence: 2,
    timestamp: 2,
    source: "operator"
  });
  assert.equal(reset.phase, "reset");
});
