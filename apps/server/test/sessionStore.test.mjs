import test from "node:test";
import assert from "node:assert/strict";

import {
  SessionCapacityError,
  SessionIdentityLedgerCapacityError,
  SessionIdentityRetiredError,
  SessionStore,
  sanitizeSessionId
} from "../dist/sessionStore.js";

test("session identifiers are safe for receipt paths", () => {
  assert.equal(sanitizeSessionId(" pi:demo-01 "), "pi:demo-01");
  assert.equal(sanitizeSessionId("../../escape"), undefined);
  assert.equal(sanitizeSessionId("contains space"), undefined);
  assert.equal(sanitizeSessionId("."), undefined);
  assert.equal(sanitizeSessionId(".."), undefined);
});

test("explicit invalid session identifiers are rejected instead of replaced", () => {
  const store = new SessionStore();

  for (const sessionId of [".", "..", "", "contains space"]) {
    assert.throws(
      () => store.createSession({ sessionId, source: "server" }),
      /Invalid explicit sessionId/
    );
  }
  assert.throws(
    () => store.createSession({ sessionId: undefined, source: "server" }),
    /Invalid explicit sessionId/
  );
  assert.equal(store.listSessions().length, 0);

  const generated = store.createSession({ source: "server" });
  assert.match(generated.id, /^[0-9a-f-]{36}$/);
});

test("events update session status without a second runtime path", () => {
  const store = new SessionStore();
  const session = store.createSession({ sessionId: "device-001", source: "device" });
  store.addEvent({
    type: "input.recording.started",
    sessionId: "device-001",
    attemptId: session.attemptId,
    sequence: 1,
    timestamp: 1,
    source: "device"
  });
  store.addEvent({
    type: "input.recording.stopped",
    sessionId: "device-001",
    attemptId: session.attemptId,
    sequence: 2,
    timestamp: 2,
    source: "device",
    durationMs: 3_200
  });
  store.addEvent({
    type: "reading.started",
    sessionId: "device-001",
    attemptId: session.attemptId,
    sequence: 3,
    timestamp: 3,
    source: "server"
  });
  store.addEvent({
    type: "session.result",
    sessionId: "device-001",
    attemptId: session.attemptId,
    sequence: 4,
    timestamp: 4,
    source: "server",
    result: emptyResult(session.id)
  });
  store.addEvent({
    type: "session.silence",
    sessionId: "device-001",
    attemptId: session.attemptId,
    sequence: 5,
    timestamp: 5,
    source: "server",
    durationMs: 3_200
  });

  assert.equal(store.getSession("device-001")?.status, "silence");
  assert.equal(store.getSession("device-001")?.events.length, 5);
  assert.equal(store.getSession("device-001")?.lastSequence, 5);
});

test("store rejects foreign attempts and non-contiguous sequences", () => {
  const store = new SessionStore();
  const session = store.createSession({ sessionId: "sequenced", source: "browser" });
  const baseEvent = {
    type: "session.created",
    sessionId: session.id,
    attemptId: session.attemptId,
    timestamp: 1,
    source: "browser"
  };

  assert.throws(
    () => store.addEvent({ ...baseEvent, attemptId: "foreign", sequence: 1 }),
    /Attempt mismatch/
  );
  assert.throws(
    () => store.addEvent({ ...baseEvent, sequence: 2 }),
    /expected 1, got 2/
  );

  store.addEvent({ ...baseEvent, sequence: 1 });
  assert.equal(store.getSession(session.id)?.lastSequence, 1);
});

test("one attempt has one input owner", () => {
  const store = new SessionStore();
  const session = store.createSession({ sessionId: "claim-one", source: "browser" });

  assert.equal(
    store.claimAttemptInput(session.id, session.attemptId, "manual"),
    true
  );
  assert.equal(
    store.claimAttemptInput(session.id, session.attemptId, "audio"),
    false
  );
  assert.equal(
    store.claimAttemptInput(session.id, "foreign-attempt", "manual"),
    false
  );
});

test("a sealed attempt rejects a second result and late work", () => {
  const store = new SessionStore();
  const session = store.createSession({ sessionId: "sealed-one", source: "browser" });
  const result = emptyResult(session.id);

  advanceToReading(store, session);

  store.addEvent({
    type: "session.result",
    sessionId: session.id,
    attemptId: session.attemptId,
    sequence: 4,
    timestamp: Date.now(),
    source: "server",
    result
  });

  assert.throws(
    () => store.addEvent({
      type: "session.result",
      sessionId: session.id,
      attemptId: session.attemptId,
      sequence: 5,
      timestamp: Date.now(),
      source: "server",
      result
    }),
    /final result|after final result/
  );
  assert.throws(
    () => store.addEvent({
      type: "reading.started",
      sessionId: session.id,
      attemptId: session.attemptId,
      sequence: 5,
      timestamp: Date.now(),
      source: "server"
    }),
    /from state result/
  );
  assert.equal(store.getSession(session.id)?.lastSequence, 4);
});

test("reset absorbs every later event and error only permits reset", () => {
  const store = new SessionStore();
  const resetSession = store.createSession({ sessionId: "reset-terminal", source: "browser" });

  store.addEvent({
    type: "session.reset",
    sessionId: resetSession.id,
    attemptId: resetSession.attemptId,
    sequence: 1,
    timestamp: 1,
    source: "operator"
  });
  assert.throws(
    () => store.addEvent({
      type: "session.error",
      sessionId: resetSession.id,
      attemptId: resetSession.attemptId,
      sequence: 2,
      timestamp: 2,
      source: "server",
      message: "late failure",
      recoverable: true
    }),
    /from state reset/
  );

  const errorSession = store.createSession({ sessionId: "error-terminal", source: "browser" });
  store.addEvent({
    type: "session.error",
    sessionId: errorSession.id,
    attemptId: errorSession.attemptId,
    sequence: 1,
    timestamp: 1,
    source: "server",
    message: "failed",
    recoverable: true
  });
  assert.throws(
    () => store.addEvent({
      type: "session.error",
      sessionId: errorSession.id,
      attemptId: errorSession.attemptId,
      sequence: 2,
      timestamp: 2,
      source: "server",
      message: "duplicate failure",
      recoverable: true
    }),
    /from state error/
  );
  store.addEvent({
    type: "session.reset",
    sessionId: errorSession.id,
    attemptId: errorSession.attemptId,
    sequence: 2,
    timestamp: 2,
    source: "operator"
  });

  assert.equal(store.getSession(resetSession.id)?.status, "reset");
  assert.equal(store.getSession(resetSession.id)?.lastSequence, 1);
  assert.equal(store.getSession(errorSession.id)?.status, "reset");
  assert.equal(store.getSession(errorSession.id)?.lastSequence, 2);
});

test("TTS output is ordered after one final result", () => {
  const store = new SessionStore();
  const session = store.createSession({ sessionId: "tts-order", source: "browser" });
  const event = (type, sequence, extra = {}) => ({
    type,
    sessionId: session.id,
    attemptId: session.attemptId,
    sequence,
    timestamp: Date.now(),
    source: "server",
    ...extra
  });

  assert.throws(
    () => store.addEvent(event("tts.started", 1, {
      tts: { text: "hello", language: "en", clipKey: "insufficient-signal" }
    })),
    /from state created/
  );

  advanceToReading(store, session);
  store.addEvent(event("session.result", 4, {
    result: emptyResult(session.id)
  }));
  store.addEvent(event("tts.started", 5, {
    tts: { text: "hello", language: "en", clipKey: "insufficient-signal" }
  }));
  store.addEvent(event("tts.finished", 6));

  assert.throws(
    () => store.addEvent(event("tts.finished", 7)),
    /Invalid TTS event order/
  );
  assert.equal(store.getSession(session.id)?.lastSequence, 6);
});

test("session retention expires idle state and evicts oldest terminal state", () => {
  let nowMs = 0;
  const store = new SessionStore({
    maxSessions: 2,
    terminalRetentionMs: 1_000,
    idleSessionTtlMs: 100,
    now: () => nowMs
  });

  store.createSession({ sessionId: "idle-expired", source: "browser" });
  nowMs = 101;
  store.createSession({ sessionId: "terminal-old", source: "browser" });
  const terminal = store.getSession("terminal-old");
  store.addEvent({
    type: "session.error",
    sessionId: terminal.id,
    attemptId: terminal.attemptId,
    sequence: 1,
    timestamp: nowMs,
    source: "server",
    message: "synthetic terminal",
    recoverable: true
  });
  nowMs = 102;
  store.createSession({ sessionId: "active-one", source: "browser" });
  nowMs = 103;
  store.createSession({ sessionId: "active-two", source: "browser" });

  assert.equal(store.getSession("idle-expired"), undefined);
  assert.equal(store.getSession("terminal-old"), undefined);
  assert.deepEqual(
    store.listSessions().map((session) => session.id),
    ["active-one", "active-two"]
  );
  assert.deepEqual(store.capacity, { current: 2, max: 2 });
});

test("session capacity rejects instead of evicting live attempts", () => {
  const store = new SessionStore({
    maxSessions: 1,
    terminalRetentionMs: 1_000,
    idleSessionTtlMs: 1_000
  });
  store.createSession({ sessionId: "live-owner", source: "browser" });

  assert.throws(
    () => store.createSession({ sessionId: "live-rejected", source: "browser" }),
    (error) =>
      error instanceof SessionCapacityError &&
      error.code === "session_capacity_exceeded"
  );
});

test("expired session identities remain retired for the retry horizon", () => {
  let nowMs = 0;
  const store = new SessionStore({
    idleSessionTtlMs: 100,
    terminalRetentionMs: 100,
    receiptRetentionMs: 1_000,
    identityRetryHorizonMs: 1_000,
    now: () => nowMs
  });

  store.createSession({ sessionId: "stable-retry-id", source: "browser" });
  nowMs = 100;

  assert.equal(store.getSession("stable-retry-id"), undefined);
  assert.deepEqual(store.getSessionIdentityState("stable-retry-id"), {
    status: "retired",
    retiredAt: new Date(100).toISOString(),
    retryAfterMs: 1_000
  });
  assert.throws(
    () => store.createSession({ sessionId: "stable-retry-id", source: "browser" }),
    (error) =>
      error instanceof SessionIdentityRetiredError &&
      error.code === "session_identity_retired" &&
      error.sessionId === "stable-retry-id" &&
      error.retryAfterMs === 1_000
  );

  nowMs = 1_100;
  assert.deepEqual(store.getSessionIdentityState("stable-retry-id"), {
    status: "available"
  });
  assert.equal(
    store.createSession({ sessionId: "stable-retry-id", source: "browser" }).id,
    "stable-retry-id"
  );
});

test("capacity eviction retires the evicted terminal identity", () => {
  let nowMs = 0;
  const store = new SessionStore({
    maxSessions: 1,
    terminalRetentionMs: 1_000,
    idleSessionTtlMs: 1_000,
    receiptRetentionMs: 10_000,
    identityRetryHorizonMs: 10_000,
    now: () => nowMs
  });
  const terminal = store.createSession({
    sessionId: "terminal-to-evict",
    source: "browser"
  });
  store.addEvent({
    type: "session.error",
    sessionId: terminal.id,
    attemptId: terminal.attemptId,
    sequence: 1,
    timestamp: nowMs,
    source: "server",
    message: "synthetic terminal",
    recoverable: true
  });

  nowMs = 1;
  store.createSession({ sessionId: "replacement", source: "browser" });

  assert.equal(store.getSession("terminal-to-evict"), undefined);
  assert.equal(
    store.getSessionIdentityState("terminal-to-evict").status,
    "retired"
  );
  assert.throws(
    () => store.createSession({
      sessionId: "terminal-to-evict",
      source: "browser"
    }),
    SessionIdentityRetiredError
  );
});

test("a full identity ledger fails closed without dropping retry protection", () => {
  let nowMs = 0;
  const store = new SessionStore({
    maxSessions: 2,
    terminalRetentionMs: 10,
    idleSessionTtlMs: 10,
    receiptRetentionMs: 1_000,
    identityRetryHorizonMs: 1_000,
    maxIdentityTombstones: 1,
    now: () => nowMs
  });

  store.createSession({ sessionId: "retired-first", source: "browser" });
  nowMs = 10;
  store.createSession({ sessionId: "protected-second", source: "browser" });
  assert.deepEqual(store.identityLedgerCapacity, {
    current: 1,
    max: 1,
    saturated: true,
    rejectedRetirements: 0
  });

  nowMs = 20;
  assert.throws(
    () => store.createSession({ sessionId: "must-not-start", source: "browser" }),
    (error) =>
      error instanceof SessionIdentityLedgerCapacityError &&
      error.code === "session_identity_ledger_capacity_exceeded" &&
      error.maxTombstones === 1
  );
  assert.equal(store.getSessionIdentityState("protected-second").status, "active");
  assert.equal(store.getSession("must-not-start"), undefined);
  assert.equal(store.getSessionIdentityState("retired-first").status, "retired");
  assert.ok(store.identityLedgerCapacity.rejectedRetirements >= 1);

  nowMs = 1_010;
  assert.equal(
    store.createSession({ sessionId: "allowed-after-expiry", source: "browser" }).id,
    "allowed-after-expiry"
  );
  assert.equal(store.getSessionIdentityState("protected-second").status, "retired");
});

test("identity retention rejects unsafe receipt and timestamp configurations", () => {
  assert.throws(
    () => new SessionStore({
      receiptRetentionMs: 1_001,
      identityRetryHorizonMs: 1_000
    }),
    /at least receiptRetentionMs/
  );
  assert.throws(
    () => new SessionStore({
      receiptRetentionMs: 1,
      identityRetryHorizonMs: Number.MAX_SAFE_INTEGER,
      now: () => 1
    }),
    /safe JavaScript timestamp/
  );
});

function advanceToReading(store, session) {
  store.addEvent({
    type: "input.recording.started",
    sessionId: session.id,
    attemptId: session.attemptId,
    sequence: 1,
    timestamp: 1,
    source: session.source
  });
  store.addEvent({
    type: "input.recording.stopped",
    sessionId: session.id,
    attemptId: session.attemptId,
    sequence: 2,
    timestamp: 2,
    source: session.source
  });
  store.addEvent({
    type: "reading.started",
    sessionId: session.id,
    attemptId: session.attemptId,
    sequence: 3,
    timestamp: 3,
    source: "server"
  });
}

function emptyResult(sessionId) {
  return {
    sessionId,
    readings: [],
    minorityStates: [],
    topWindow: {
      status: "insufficient_signal",
      lineEn: "TRY AGAIN",
      lineZh: "请再试一次"
    }
  };
}
