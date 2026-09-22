import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { SessionReceiptSchema } from "../../../packages/protocol/dist/index.js";
import { AttemptDeadlineRegistry } from "../dist/attemptDeadline.js";
import { audioPipelineReservationBytes } from "../dist/audioPipeline.js";
import { AudioResourceAdmission } from "../dist/audioResourceAdmission.js";
import { EventBus } from "../dist/eventBus.js";
import { OutputScheduler } from "../dist/outputScheduler.js";
import { ReceiptWriter } from "../dist/receipts.js";
import { createRequestHandler, emitSessionEvent } from "../dist/routes.js";
import { SessionStore } from "../dist/sessionStore.js";

test("client-generated session creation is idempotent and validates ownership", async () => {
  const store = new SessionStore();
  const outputs = {
    cancelCalls: 0,
    activeKey: undefined,
    idle: true,
    cancelActive() {
      this.cancelCalls += 1;
    },
    cancel() {
      this.cancelCalls += 1;
      return true;
    },
    schedule() {
      throw new Error("output scheduling is not expected in this test");
    }
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    outputs,
    receipts: new ReceiptWriter(false),
    store
  });

  const first = await invokeJson(handler, "/sessions", {
    sessionId: "browser-local-001",
    source: "browser"
  });
  const replay = await invokeJson(handler, "/sessions", {
    sessionId: "browser-local-001",
    source: "browser"
  });
  const foreignSource = await invokeJson(handler, "/sessions", {
    sessionId: "browser-local-001",
    source: "device"
  });
  const invalid = await invokeJson(handler, "/sessions", {
    sessionId: "../../not-safe",
    source: "browser"
  });
  const dotOnly = await invokeJson(handler, "/sessions", {
    sessionId: ".",
    source: "browser"
  });
  const parentDotOnly = await invokeJson(handler, "/sessions", {
    sessionId: "..",
    source: "browser"
  });

  assert.equal(first.statusCode, 201);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.session.id, first.body.session.id);
  assert.equal(replay.body.session.attemptId, first.body.session.attemptId);
  assert.equal(foreignSource.statusCode, 409);
  assert.equal(invalid.statusCode, 400);
  assert.equal(dotOnly.statusCode, 400);
  assert.equal(parentDotOnly.statusCode, 400);
  assert.equal(store.listSessions().length, 1);
  assert.equal(store.getSession("browser-local-001")?.events.length, 1);
  assert.equal(outputs.cancelCalls, 1);
});

test("a missing session id stays omitted so the store can generate one", async () => {
  const store = new SessionStore();
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  const created = await invokeJson(handler, "/sessions", {
    source: "browser"
  });

  assert.equal(created.statusCode, 201);
  assert.match(created.body.session.id, /^[0-9a-f-]{36}$/);
  assert.equal(created.body.session.source, "browser");
  assert.equal(created.body.event.sessionId, created.body.session.id);
  assert.equal(store.listSessions().length, 1);
});

test("retired identities and a full tombstone ledger fail closed with typed responses", async () => {
  let nowMs = 0;
  const store = new SessionStore({
    maxSessions: 2,
    idleSessionTtlMs: 10,
    terminalRetentionMs: 10,
    receiptRetentionMs: 100,
    identityRetryHorizonMs: 100,
    maxIdentityTombstones: 1,
    now: () => nowMs
  });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  assert.equal((await invokeJson(handler, "/sessions", {
    sessionId: "retired-route-id",
    source: "browser"
  })).statusCode, 201);

  nowMs = 10;
  const retired = await invokeJson(handler, "/sessions", {
    sessionId: "retired-route-id",
    source: "browser"
  });
  assert.equal(retired.statusCode, 410);
  assert.equal(retired.body.code, "session_identity_retired");
  assert.equal(retired.body.retryAfterMs, 100);
  assert.equal(retired.headers.get("retry-after"), "1");

  assert.equal((await invokeJson(handler, "/sessions", {
    sessionId: "protected-route-id",
    source: "browser"
  })).statusCode, 201);
  nowMs = 20;
  const saturated = await invokeJson(handler, "/sessions", {
    sessionId: "must-not-start-route-id",
    source: "browser"
  });
  const health = await invokeGet(handler, "/health");

  assert.equal(saturated.statusCode, 503);
  assert.equal(
    saturated.body.code,
    "session_identity_ledger_capacity_exceeded"
  );
  assert.equal(saturated.body.maxTombstones, 1);
  assert.equal(store.getSession("must-not-start-route-id"), undefined);
  assert.equal(health.body.sessionIdentityProtection.mode, "process_only");
  assert.equal(health.body.sessionIdentityProtection.restartProtected, false);
  assert.equal(
    health.body.sessionIdentityProtection.ledgerCapacity.current,
    1
  );
  assert.equal(health.body.sessionIdentityProtection.ledgerCapacity.max, 1);
  assert.equal(
    health.body.sessionIdentityProtection.ledgerCapacity.saturated,
    true
  );
  assert.ok(
    health.body.sessionIdentityProtection.ledgerCapacity
      .rejectedRetirements >= 1
  );
});

test("a retained creation receipt prevents session identity reuse after restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-route-restart-id-"));
  const sessionId = "restart-stable-id";

  try {
    const firstStore = new SessionStore();
    const firstHandler = createRequestHandler({
      bus: new EventBus(),
      receipts: new ReceiptWriter(true, { directory }),
      store: firstStore
    });
    const first = await invokeJson(firstHandler, "/sessions", {
      sessionId,
      source: "browser"
    });
    assert.equal(first.statusCode, 201);
    const receiptPath = path.join(directory, `${sessionId}.json`);
    const originalReceipt = await readFile(receiptPath, "utf8");

    const restartedStore = new SessionStore();
    const restartedHandler = createRequestHandler({
      bus: new EventBus(),
      receipts: new ReceiptWriter(true, { directory }),
      store: restartedStore
    });
    const replay = await invokeJson(restartedHandler, "/sessions", {
      sessionId,
      source: "browser"
    });

    assert.equal(replay.statusCode, 410);
    assert.equal(replay.body.code, "session_identity_retired");
    assert.equal(replay.body.persistedAttemptId, first.body.session.attemptId);
    assert.equal(replay.body.restartRecovered, true);
    assert.equal(restartedStore.listSessions().length, 0);
    assert.equal(await readFile(receiptPath, "utf8"), originalReceipt);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("an unreadable persisted identity rejects creation without side effects", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-route-invalid-id-"));
  const sessionId = "invalid-persisted-id";

  try {
    await writeFile(path.join(directory, `${sessionId}.json`), "not-json", "utf8");
    const store = new SessionStore();
    const handler = createRequestHandler({
      bus: new EventBus(),
      receipts: new ReceiptWriter(true, { directory }),
      store
    });
    const rejected = await invokeJson(handler, "/sessions", {
      sessionId,
      source: "browser"
    });

    assert.equal(rejected.statusCode, 503);
    assert.equal(rejected.body.code, "session_identity_check_failed");
    assert.equal(rejected.body.sessionId, sessionId);
    assert.equal(store.listSessions().length, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("JSON bodies preserve UTF-8 code points split across transport chunks", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "utf8-split", source: "browser" });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });
  const payload = Buffer.from(JSON.stringify({
    type: "session.error",
    source: "browser",
    message: "你"
  }));
  const multibyteStart = payload.indexOf(Buffer.from("你"));
  assert.ok(multibyteStart >= 0);

  const response = await invokeJsonChunks(
    handler,
    "/sessions/utf8-split/input-event",
    [
      payload.subarray(0, multibyteStart + 1),
      payload.subarray(multibyteStart + 1, multibyteStart + 2),
      payload.subarray(multibyteStart + 2)
    ]
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.event.message, "你");
});

test("JSON bodies enforce the byte limit and reject malformed UTF-8", async () => {
  const store = new SessionStore();
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });
  const oversized = Buffer.from(JSON.stringify({
    sessionId: "raw-byte-overflow",
    source: "browser",
    padding: "界".repeat(22_000)
  }));
  assert.ok(oversized.byteLength > 64 * 1024);

  const oversizedResponse = await invokeJsonChunks(
    handler,
    "/sessions",
    [oversized]
  );
  const malformedResponse = await invokeJsonChunks(
    handler,
    "/sessions",
    [
      Buffer.from('{"sessionId":"invalid-utf8","note":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('","source":"browser"}')
    ]
  );

  assert.equal(oversizedResponse.statusCode, 413);
  assert.equal(oversizedResponse.body.code, "json_body_too_large");
  assert.equal(malformedResponse.statusCode, 400);
  assert.equal(malformedResponse.body.code, "invalid_json_utf8");
  assert.equal(store.listSessions().length, 0);
});

test("HTTP session paths decode one segment exactly once before validation", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "pi:demo-01", source: "device" });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  const encoded = await invokeGet(handler, "/sessions/pi%3Ademo-01");
  const doubleEncoded = await invokeGet(handler, "/sessions/pi%253Ademo-01");
  const malformed = await invokeGet(handler, "/sessions/%E0%A4%A");
  const encodedCurrentDirectory = await invokeGet(
    handler,
    "/sessions/%2e/pi%3Ademo-01"
  );
  const encodedParentDirectory = await invokeJson(
    handler,
    "/sessions/.%2E/sessions",
    { sessionId: "must-not-create", source: "browser" }
  );
  const decodedSlashInvocations = [
    () => invokeGet(handler, "/sessions/pi%2Fdemo"),
    () => invokeGet(handler, "/sessions/pi%2Fdemo/receipt"),
    () => invokeJson(handler, "/sessions/pi%2Fdemo/manual-transcript", {
      transcript: "must not be accepted"
    }),
    () => invokeAudio(handler, "/sessions/pi%2Fdemo/audio"),
    () => invokeJson(handler, "/sessions/pi%2Fdemo/input-event", {
      type: "input.recording.started",
      source: "browser"
    }),
    () => invokeJson(handler, "/sessions/pi%2Fdemo/demo-event", {
      type: "session.reset"
    })
  ];
  const decodedSlashResponses = [];
  for (const invoke of decodedSlashInvocations) {
    decodedSlashResponses.push(await invoke());
  }

  assert.equal(encoded.statusCode, 200);
  assert.equal(encoded.body.session.id, "pi:demo-01");
  assert.equal(doubleEncoded.statusCode, 400);
  assert.equal(doubleEncoded.body.code, "invalid_session_id");
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.body.code, "invalid_session_id");
  assert.equal(encodedCurrentDirectory.statusCode, 400);
  assert.equal(encodedCurrentDirectory.body.code, "invalid_session_id");
  assert.equal(encodedParentDirectory.statusCode, 400);
  assert.equal(encodedParentDirectory.body.code, "invalid_session_id");
  assert.deepEqual(
    decodedSlashResponses.map((response) => response.statusCode),
    [400, 400, 400, 400, 400, 400]
  );
  assert.equal(store.listSessions().length, 1);
});

test("session admission rejects with a typed 503 without cancelling active output", async () => {
  const store = new SessionStore({
    maxSessions: 1,
    idleSessionTtlMs: 60_000,
    terminalRetentionMs: 60_000
  });
  store.createSession({ sessionId: "capacity-owner", source: "browser" });
  const outputs = {
    activeKey: "capacity-owner:attempt",
    idle: false,
    cancelCalls: 0,
    cancelActive() {
      this.cancelCalls += 1;
    },
    cancel() {
      return false;
    },
    schedule() {
      throw new Error("output scheduling is not expected in this test");
    }
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    outputs,
    receipts: new ReceiptWriter(false),
    store
  });

  const rejected = await invokeJson(handler, "/sessions", {
    sessionId: "capacity-rejected",
    source: "browser"
  });
  const health = await invokeGet(handler, "/health");

  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.body.code, "session_capacity_exceeded");
  assert.equal(rejected.body.maxSessions, 1);
  assert.equal(outputs.cancelCalls, 0);
  assert.deepEqual(health.body.sessionCapacity, { current: 1, max: 1 });
  assert.deepEqual(health.body.sessionIdentityProtection, {
    mode: "process_only",
    restartProtected: false,
    ledgerCapacity: {
      current: 0,
      max: 4_096,
      saturated: false,
      rejectedRetirements: 0
    }
  });
});

test("demo event payloads reject authority fields and the emitter owns event identity", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "demo-authority-boundary",
    source: "browser"
  });
  const bus = new EventBus();
  const receipts = new ReceiptWriter(false);
  const handler = createRequestHandler({ bus, receipts, store });

  const rejected = await invokeJson(
    handler,
    `/sessions/${session.id}/demo-event`,
    {
      type: "input.recording.started",
      payload: {
        monotonicMs: 12,
        sessionId: "foreign-session",
        attemptId: "foreign-attempt",
        sequence: 900,
        timestamp: 1,
        type: "session.reset",
        source: "device"
      }
    }
  );

  assert.equal(rejected.statusCode, 400);
  assert.deepEqual(rejected.body.unexpectedFields, [
    "sessionId",
    "attemptId",
    "sequence",
    "timestamp",
    "type",
    "source"
  ]);
  assert.equal(store.getSession(session.id).events.length, 0);

  const accepted = await invokeJson(
    handler,
    `/sessions/${session.id}/demo-event`,
    {
      type: "input.recording.started",
      payload: { monotonicMs: 12 }
    }
  );
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.event.sessionId, session.id);
  assert.equal(accepted.body.event.attemptId, session.attemptId);
  assert.equal(accepted.body.event.sequence, 1);
  assert.equal(accepted.body.event.source, "operator");

  const directSession = store.createSession({
    sessionId: "emitter-authority-boundary",
    source: "browser"
  });
  const emitted = await emitSessionEvent(
    { bus, receipts, store },
    directSession,
    {
      type: "input.recording.started",
      source: "operator",
      sessionId: "foreign-session",
      attemptId: "foreign-attempt",
      sequence: 700,
      timestamp: 1,
      monotonicMs: 14
    }
  );
  assert.equal(emitted.sessionId, directSession.id);
  assert.equal(emitted.attemptId, directSession.attemptId);
  assert.equal(emitted.sequence, 1);
  assert.notEqual(emitted.timestamp, 1);
  assert.equal(emitted.type, "input.recording.started");
  assert.equal(emitted.source, "operator");
});

test("browser HTTP writes require an exact allowed Origin before side effects", async () => {
  const store = new SessionStore();
  const handler = createRequestHandler({
    allowedOrigins: ["http://trusted.local"],
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  const rejected = await invokeJson(
    handler,
    "/sessions",
    { sessionId: "cors-rejected", source: "browser" },
    { origin: "http://untrusted.local" }
  );
  assert.equal(rejected.statusCode, 403);
  assert.equal(store.listSessions().length, 0);
  assert.equal(rejected.headers.get("access-control-allow-origin"), undefined);

  const accepted = await invokeJson(
    handler,
    "/sessions",
    { sessionId: "cors-accepted", source: "browser" },
    { origin: "http://trusted.local" }
  );
  assert.equal(accepted.statusCode, 201);
  assert.equal(
    accepted.headers.get("access-control-allow-origin"),
    "http://trusted.local"
  );
  assert.equal(accepted.headers.get("vary"), "Origin");
});

test("HTTP allowed origins do not inherit the ordered PCM WebSocket allowlist", async () => {
  const previousHttpOrigins = process.env.JIKO_HTTP_ALLOWED_ORIGINS;
  const previousOrderedOrigins = process.env.JIKO_ORDERED_PCM_ALLOWED_ORIGINS;

  try {
    delete process.env.JIKO_HTTP_ALLOWED_ORIGINS;
    process.env.JIKO_ORDERED_PCM_ALLOWED_ORIGINS = "http://ws-only.local";

    const store = new SessionStore();
    const handler = createRequestHandler({
      bus: new EventBus(),
      receipts: new ReceiptWriter(false),
      store
    });
    const wsOnlyOrigin = await invokeJson(
      handler,
      "/sessions",
      { sessionId: "origin-config-ws-only", source: "browser" },
      { origin: "http://ws-only.local" }
    );
    const defaultHttpOrigin = await invokeJson(
      handler,
      "/sessions",
      { sessionId: "origin-config-http-default", source: "browser" },
      { origin: "http://localhost:5173" }
    );

    assert.equal(wsOnlyOrigin.statusCode, 403);
    assert.equal(defaultHttpOrigin.statusCode, 201);
    assert.equal(store.getSession("origin-config-ws-only"), undefined);
  } finally {
    restoreEnvironmentVariable(
      "JIKO_HTTP_ALLOWED_ORIGINS",
      previousHttpOrigins
    );
    restoreEnvironmentVariable(
      "JIKO_ORDERED_PCM_ALLOWED_ORIGINS",
      previousOrderedOrigins
    );
  }
});

test("receipt endpoint returns the canonical versioned receipt", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "canonical-receipt",
    source: "browser"
  });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  const response = await invokeGet(
    handler,
    `/sessions/${session.id}/receipt`
  );
  const receipt = SessionReceiptSchema.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(receipt.schemaVersion, "session_receipt_v1");
  assert.equal(receipt.sessionId, session.id);
  assert.equal(receipt.input.audioStored, false);
  assert.deepEqual(receipt.events, []);
});

test("receipt endpoint preserves the STT execution identity committed by the pipeline", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "identified-receipt",
    source: "browser"
  });
  const pipeline = fakeAudioPipelineResult(session.id);
  pipeline.transcript = {
    text: "fixture transcript",
    provider: "local:sherpa-onnx-sensevoice",
    latencyMs: 7
  };
  pipeline.sttProviderReceipt = {
    id: "local:sherpa-onnx-sensevoice",
    latencyMs: 7,
    remote: false,
    outcome: "completed",
    execution: fakeSttExecutionIdentity()
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    pipelineRunner: async () => pipeline,
    receipts: new ReceiptWriter(false),
    store
  });

  const upload = await invokeAudio(
    handler,
    `/sessions/${session.id}/audio?source=browser`
  );
  const response = await invokeGet(
    handler,
    `/sessions/${session.id}/receipt`
  );
  const receipt = SessionReceiptSchema.parse(response.body);

  assert.equal(upload.statusCode, 202);
  assert.equal(response.statusCode, 200);
  assert.equal(receipt.providers.stt?.outcome, "completed");
  assert.equal(
    receipt.providers.stt?.execution?.runtime.version,
    "1.0.0-test"
  );
  assert.equal(
    receipt.providers.stt?.execution?.artifacts.model.sha256,
    "a".repeat(64)
  );
  assert.equal(
    receipt.providers.stt?.execution?.artifacts.tokens.bytes,
    45
  );
});

test("audio route forwards remote consent only when the caller names Deepgram explicitly", async () => {
  const store = new SessionStore();
  for (const sessionId of [
    "consent-default",
    "consent-query",
    "consent-header",
    "consent-invalid"
  ]) {
    store.createSession({ sessionId, source: "browser" });
  }
  const pipelineInputs = [];
  const handler = createRequestHandler({
    bus: new EventBus(),
    pipelineRunner: async (input) => {
      pipelineInputs.push(input);
      return fakeAudioPipelineResult(input.sessionId);
    },
    receipts: new ReceiptWriter(false),
    store
  });

  const defaultUpload = await invokeAudio(
    handler,
    "/sessions/consent-default/audio?source=browser"
  );
  const queryUpload = await invokeAudio(
    handler,
    "/sessions/consent-query/audio?source=browser&remoteAudioConsent=deepgram"
  );
  const headerUpload = await invokeAudio(
    handler,
    "/sessions/consent-header/audio?source=browser",
    { "x-jiko-remote-audio-consent": "deepgram" }
  );
  const invalidUpload = await invokeAudio(
    handler,
    "/sessions/consent-invalid/audio?source=browser&remoteAudioConsent=true"
  );

  assert.equal(defaultUpload.statusCode, 202);
  assert.equal(queryUpload.statusCode, 202);
  assert.equal(headerUpload.statusCode, 202);
  assert.equal(invalidUpload.statusCode, 400);
  assert.deepEqual(
    pipelineInputs.map((input) => input.remoteAudioConsent),
    [undefined, "deepgram", "deepgram"]
  );
});

test("audio uploads reject excess pipeline work with a typed terminal receipt and release capacity", async () => {
  const store = new SessionStore();
  for (const sessionId of ["pipeline-first", "pipeline-rejected", "pipeline-reused"]) {
    store.createSession({ sessionId, source: "browser" });
  }
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 64,
    maxPipelineBytes: audioPipelineReservationBytes(4),
    maxPipelines: 1
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(30_000);
  const firstStarted = deferred();
  const finishFirst = deferred();
  let pipelineCalls = 0;
  const handler = createRequestHandler({
    audioAdmission,
    attemptDeadlines,
    bus: new EventBus(),
    pipelineRunner: async (input) => {
      pipelineCalls += 1;
      if (input.sessionId === "pipeline-first") {
        firstStarted.resolve();
        return finishFirst.promise;
      }
      return fakeAudioPipelineResult(input.sessionId);
    },
    receipts: new ReceiptWriter(false),
    store
  });

  const firstUpload = invokeAudio(
    handler,
    "/sessions/pipeline-first/audio?source=browser"
  );
  await firstStarted.promise;
  const rejected = await invokeAudio(
    handler,
    "/sessions/pipeline-rejected/audio?source=browser"
  );

  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.body.code, "audio_pipeline_capacity_exceeded");
  assert.equal(store.getSession("pipeline-rejected")?.status, "error");
  assert.equal(
    store.getSession("pipeline-rejected")?.events.at(-1)?.code,
    "audio_pipeline_capacity_exceeded"
  );
  assert.equal(
    store.getSession("pipeline-rejected")?.pipeline?.stages.at(-1)?.provider,
    "jiko:audio-admission-v1"
  );
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 1);
  assert.equal(pipelineCalls, 1);

  finishFirst.resolve(fakeAudioPipelineResult("pipeline-first"));
  const first = await firstUpload;
  assert.equal(first.statusCode, 202);
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 0);

  const reused = await invokeAudio(
    handler,
    "/sessions/pipeline-reused/audio?source=browser"
  );
  assert.equal(reused.statusCode, 202);
  assert.equal(store.getSession("pipeline-reused")?.status, "result");
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 0);
  assert.equal(audioAdmission.snapshot().ingress.reservedBytes, 0);
  assert.equal(pipelineCalls, 2);
});

test("audio upload ingress rejects before retaining bytes and releases the request lease", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "http-ingress-capacity",
    source: "browser"
  });
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 3,
    maxPipelineBytes: 64,
    maxPipelines: 1
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(1_000);
  let pipelineCalls = 0;
  const handler = createRequestHandler({
    audioAdmission,
    attemptDeadlines,
    bus: new EventBus(),
    pipelineRunner: async (input) => {
      pipelineCalls += 1;
      return fakeAudioPipelineResult(input.sessionId);
    },
    receipts: new ReceiptWriter(false),
    store
  });

  const rejected = await invokeAudio(
    handler,
    `/sessions/${session.id}/audio?source=browser`
  );

  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.body.code, "audio_ingress_capacity_exceeded");
  assert.equal(rejected.body.resource, "ingress_bytes");
  assert.equal(store.getSession(session.id)?.status, "created");
  assert.equal(store.getSession(session.id)?.events.length, 0);
  assert.equal(pipelineCalls, 0);
  assert.equal(attemptDeadlines.activeCount, 0);
  assert.deepEqual(audioAdmission.snapshot().ingress, {
    reservedBytes: 0,
    maxBytes: 3,
    activeLeases: 0,
    maxLeases: 16,
    rejectedReservations: 1,
    rejectedSlotReservations: 0
  });
});

test("pipeline admission remains held after cancellation until noncooperative work actually settles", async () => {
  const store = new SessionStore();
  for (const sessionId of ["detached-work", "detached-rejected", "detached-reused"]) {
    store.createSession({ sessionId, source: "browser" });
  }
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 64,
    maxPipelineBytes: audioPipelineReservationBytes(4),
    maxPipelines: 1
  });
  const started = deferred();
  const completion = deferred();
  const attemptDeadlines = new AttemptDeadlineRegistry(30_000);
  const handler = createRequestHandler({
    audioAdmission,
    attemptDeadlines,
    bus: new EventBus(),
    pipelineRunner: async (input) => {
      if (input.sessionId === "detached-work") {
        started.resolve();
        return completion.promise;
      }
      return fakeAudioPipelineResult(input.sessionId);
    },
    receipts: new ReceiptWriter(false),
    store
  });

  const detachedUpload = invokeAudio(
    handler,
    "/sessions/detached-work/audio?source=browser"
  );
  await started.promise;
  await invokeJson(handler, "/sessions/detached-work/demo-event", {
    type: "session.reset",
    payload: {}
  });
  const detached = await detachedUpload;
  assert.equal(detached.statusCode, 409);
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 1);

  const rejected = await invokeAudio(
    handler,
    "/sessions/detached-rejected/audio?source=browser"
  );
  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.body.code, "audio_pipeline_capacity_exceeded");

  completion.resolve(fakeAudioPipelineResult("detached-work"));
  await waitForCondition(
    () => audioAdmission.snapshot().pipeline.activeLeases === 0,
    30_000
  );
  const reused = await invokeAudio(
    handler,
    "/sessions/detached-reused/audio?source=browser"
  );
  assert.equal(reused.statusCode, 202);
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 0);
});

test("pipeline admission remains held until a successful provider resource settlement", async () => {
  const store = new SessionStore();
  for (const sessionId of [
    "provider-settlement",
    "provider-settlement-rejected",
    "provider-settlement-reused"
  ]) {
    store.createSession({ sessionId, source: "browser" });
  }
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 64,
    maxPipelineBytes: audioPipelineReservationBytes(4),
    maxPipelines: 1
  });
  const settlement = deferred();
  const handler = createRequestHandler({
    audioAdmission,
    bus: new EventBus(),
    pipelineRunner: async (input) => ({
      ...fakeAudioPipelineResult(input.sessionId),
      resourceSettlement: input.sessionId === "provider-settlement"
        ? settlement.promise
        : Promise.resolve()
    }),
    receipts: new ReceiptWriter(false),
    store
  });

  const completed = await invokeAudio(
    handler,
    "/sessions/provider-settlement/audio?source=browser"
  );
  assert.equal(completed.statusCode, 202);
  assert.equal(store.getSession("provider-settlement")?.status, "result");
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 1);

  const rejected = await invokeAudio(
    handler,
    "/sessions/provider-settlement-rejected/audio?source=browser"
  );
  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.body.code, "audio_pipeline_capacity_exceeded");

  settlement.resolve();
  await waitForCondition(
    () => audioAdmission.snapshot().pipeline.activeLeases === 0,
    30_000
  );
  const reused = await invokeAudio(
    handler,
    "/sessions/provider-settlement-reused/audio?source=browser"
  );
  assert.equal(reused.statusCode, 202);
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 0);
});

test("pipeline admission releases after provider exceptions", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "pipeline-throws", source: "browser" });
  store.createSession({ sessionId: "pipeline-after-throw", source: "browser" });
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 64,
    maxPipelineBytes: audioPipelineReservationBytes(4),
    maxPipelines: 1
  });
  const handler = createRequestHandler({
    audioAdmission,
    bus: new EventBus(),
    pipelineRunner: async (input) => {
      if (input.sessionId === "pipeline-throws") {
        throw new Error("fixture provider failure");
      }
      return fakeAudioPipelineResult(input.sessionId);
    },
    receipts: new ReceiptWriter(false),
    store
  });

  const failed = await invokeAudio(
    handler,
    "/sessions/pipeline-throws/audio?source=browser"
  );
  assert.equal(failed.statusCode, 202);
  assert.equal(store.getSession("pipeline-throws")?.status, "error");
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 0);

  const reused = await invokeAudio(
    handler,
    "/sessions/pipeline-after-throw/audio?source=browser"
  );
  assert.equal(reused.statusCode, 202);
  assert.equal(store.getSession("pipeline-after-throw")?.status, "result");
  assert.equal(audioAdmission.snapshot().pipeline.activeLeases, 0);
});

test("browser/device input route rejects duplicate recording starts", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "browser-001", source: "browser" });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  const first = await invokeJson(handler, "/sessions/browser-001/input-event", {
    type: "input.recording.started",
    source: "browser"
  });
  const duplicate = await invokeJson(handler, "/sessions/browser-001/input-event", {
    type: "input.recording.started",
    source: "browser"
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.session.status, "recording");
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.body.status, "recording");
  assert.equal(store.getSession("browser-001")?.events.length, 1);
});

test("recording input retries replay only when their local timing identity is exact", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "browser-replay", source: "browser" });
  const outputs = {
    cancelCalls: 0,
    activeKey: undefined,
    idle: true,
    cancelActive() {
      this.cancelCalls += 1;
    },
    cancel() {
      this.cancelCalls += 1;
      return true;
    },
    schedule() {
      throw new Error("output scheduling is not expected in this test");
    }
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    outputs,
    receipts: new ReceiptWriter(false),
    store
  });

  const startBody = {
    type: "input.recording.started",
    source: "browser",
    monotonicMs: 2_000.25
  };
  const started = await invokeJson(
    handler,
    "/sessions/browser-replay/input-event",
    startBody
  );
  const replayedStart = await invokeJson(
    handler,
    "/sessions/browser-replay/input-event",
    startBody
  );
  const changedStart = await invokeJson(
    handler,
    "/sessions/browser-replay/input-event",
    { ...startBody, monotonicMs: 2_001.25 }
  );

  const stopBody = {
    type: "input.recording.stopped",
    source: "browser",
    monotonicMs: 2_820.25,
    durationMs: 820
  };
  const stopped = await invokeJson(
    handler,
    "/sessions/browser-replay/input-event",
    stopBody
  );
  const replayedStop = await invokeJson(
    handler,
    "/sessions/browser-replay/input-event",
    stopBody
  );
  const changedStop = await invokeJson(
    handler,
    "/sessions/browser-replay/input-event",
    { ...stopBody, durationMs: 821 }
  );

  assert.equal(started.statusCode, 200);
  assert.equal(replayedStart.statusCode, 200);
  assert.equal(replayedStart.body.replayed, true);
  assert.equal(replayedStart.body.event.sequence, started.body.event.sequence);
  assert.equal(changedStart.statusCode, 409);
  assert.equal(stopped.statusCode, 200);
  assert.equal(replayedStop.statusCode, 200);
  assert.equal(replayedStop.body.replayed, true);
  assert.equal(replayedStop.body.event.sequence, stopped.body.event.sequence);
  assert.equal(changedStop.statusCode, 409);
  assert.equal(store.getSession("browser-replay")?.events.length, 2);
  assert.equal(outputs.cancelCalls, 1);
});

test("browser/device input route validates and terminates session.error", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "browser-empty-audio", source: "browser" });
  const outputs = {
    cancelCalls: 0,
    activeKey: undefined,
    idle: true,
    cancelActive() {
      this.cancelCalls += 1;
    },
    cancel() {
      this.cancelCalls += 1;
      return true;
    },
    schedule() {
      throw new Error("output scheduling is not expected in this test");
    }
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    outputs,
    receipts: new ReceiptWriter(false),
    store
  });

  const missingMessage = await invokeJson(
    handler,
    "/sessions/browser-empty-audio/input-event",
    { type: "session.error", source: "browser", message: "   " }
  );
  const invalidCode = await invokeJson(
    handler,
    "/sessions/browser-empty-audio/input-event",
    { type: "session.error", source: "browser", message: "No audio", code: 123 }
  );
  const invalidRecoverable = await invokeJson(
    handler,
    "/sessions/browser-empty-audio/input-event",
    {
      type: "session.error",
      source: "browser",
      message: "No audio",
      recoverable: "yes"
    }
  );
  const accepted = await invokeJson(
    handler,
    "/sessions/browser-empty-audio/input-event",
    {
      type: "session.error",
      source: "browser",
      message: "  No audio was captured.  ",
      code: "empty_recording"
    }
  );
  store.createSession({ sessionId: "device-empty-audio", source: "device" });
  const acceptedDeviceError = await invokeJson(
    handler,
    "/sessions/device-empty-audio/input-event",
    {
      type: "session.error",
      source: "device",
      message: "Audio capture failed.",
      recoverable: false
    }
  );

  assert.equal(missingMessage.statusCode, 400);
  assert.equal(invalidCode.statusCode, 400);
  assert.equal(invalidRecoverable.statusCode, 400);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.session.status, "error");
  assert.equal(accepted.body.event.message, "No audio was captured.");
  assert.equal(accepted.body.event.code, "empty_recording");
  assert.equal(accepted.body.event.recoverable, true);
  assert.equal(acceptedDeviceError.statusCode, 200);
  assert.equal(acceptedDeviceError.body.event.source, "device");
  assert.equal(acceptedDeviceError.body.event.recoverable, false);
  assert.equal(store.getSession("browser-empty-audio")?.events.length, 1);
  assert.equal(store.getSession("device-empty-audio")?.status, "error");
  assert.equal(outputs.cancelCalls, 2);
});

test("device session.error retry replays only with an exact monotonic identity", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "device-interrupted", source: "device" });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });
  const body = {
    type: "session.error",
    source: "device",
    monotonicMs: 9_001.5,
    message: "Device adapter restarted before button release",
    code: "device_input_interrupted",
    recoverable: true
  };

  const accepted = await invokeJson(
    handler,
    "/sessions/device-interrupted/input-event",
    body
  );
  const replayed = await invokeJson(
    handler,
    "/sessions/device-interrupted/input-event",
    body
  );
  const changed = await invokeJson(
    handler,
    "/sessions/device-interrupted/input-event",
    { ...body, message: "A different failure" }
  );

  assert.equal(accepted.statusCode, 200);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.event.sequence, accepted.body.event.sequence);
  assert.equal(changed.statusCode, 409);
  assert.equal(store.getSession("device-interrupted")?.events.length, 1);
});

test("input route accepts a device stop only after a device start", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "device-001", source: "device" });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  const earlyStop = await invokeJson(handler, "/sessions/device-001/input-event", {
    type: "input.recording.stopped",
    source: "device",
    durationMs: 20
  });
  await invokeJson(handler, "/sessions/device-001/input-event", {
    type: "input.recording.started",
    source: "device",
    monotonicMs: 10_000.25
  });
  const stop = await invokeJson(handler, "/sessions/device-001/input-event", {
    type: "input.recording.stopped",
    source: "device",
    durationMs: 820,
    monotonicMs: 10_820.25
  });

  assert.equal(earlyStop.statusCode, 409);
  assert.equal(stop.statusCode, 200);
  assert.equal(stop.body.event.durationMs, 820);
  assert.equal(stop.body.event.monotonicMs, 10_820.25);
  assert.equal(stop.body.session.status, "processing");
});

test("recording stop reaches one typed terminal error when no upload arrives", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-no-upload",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(30);
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  await invokeJson(handler, `/sessions/${session.id}/input-event`, {
    type: "input.recording.started",
    source: "browser",
    monotonicMs: 100
  });
  await invokeJson(handler, `/sessions/${session.id}/input-event`, {
    type: "input.recording.stopped",
    source: "browser",
    monotonicMs: 200,
    durationMs: 100
  });
  await waitForCondition(() => store.getSession(session.id)?.status === "error");

  const current = store.getSession(session.id);
  assert.equal(current.status, "error");
  assert.equal(
    current.events.filter((event) => event.type === "session.error").length,
    1
  );
  assert.equal(current.events.at(-1).code, "analysis_deadline_exceeded");
  assert.equal(attemptDeadlines.activeCount, 0);
});

test("an exact duplicate stop cannot extend the original attempt deadline", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-duplicate-stop",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(200);
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  await invokeJson(handler, `/sessions/${session.id}/input-event`, {
    type: "input.recording.started",
    source: "browser",
    monotonicMs: 500
  });
  const stopBody = {
    type: "input.recording.stopped",
    source: "browser",
    monotonicMs: 800,
    durationMs: 300
  };
  const stopped = await invokeJson(
    handler,
    `/sessions/${session.id}/input-event`,
    stopBody
  );
  const originalDeadline = attemptDeadlines.get(session.id, session.attemptId);

  await new Promise((resolve) => setTimeout(resolve, 30));
  const replayed = await invokeJson(
    handler,
    `/sessions/${session.id}/input-event`,
    stopBody
  );
  const replayDeadline = attemptDeadlines.get(session.id, session.attemptId);

  assert.equal(stopped.statusCode, 200);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.body.replayed, true);
  assert.ok(originalDeadline);
  assert.ok(replayDeadline);
  assert.equal(replayDeadline.startedAtMs, originalDeadline.startedAtMs);
  assert.equal(replayDeadline.expiresAtMs, originalDeadline.expiresAtMs);
  assert.equal(
    store.getSession(session.id)?.events.filter(
      (event) => event.type === "input.recording.stopped"
    ).length,
    1
  );

  await invokeJson(handler, `/sessions/${session.id}/demo-event`, {
    type: "session.reset"
  });
  assert.equal(attemptDeadlines.activeCount, 0);
});

test("reset committed before expiry disarms the attempt deadline", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-reset-wins",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(80);
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  await invokeJson(handler, `/sessions/${session.id}/input-event`, {
    type: "input.recording.started",
    source: "browser",
    monotonicMs: 1_000
  });
  await invokeJson(handler, `/sessions/${session.id}/input-event`, {
    type: "input.recording.stopped",
    source: "browser",
    monotonicMs: 1_250,
    durationMs: 250
  });
  const reset = await invokeJson(handler, `/sessions/${session.id}/demo-event`, {
    type: "session.reset"
  });

  assert.equal(reset.statusCode, 200);
  assert.equal(attemptDeadlines.activeCount, 0);
  await new Promise((resolve) => setTimeout(resolve, 110));
  assert.equal(store.getSession(session.id)?.status, "reset");
  assert.deepEqual(
    store.getSession(session.id)?.events.map((event) => event.type),
    [
      "input.recording.started",
      "input.recording.stopped",
      "session.reset"
    ]
  );
});

test("reset remains valid after expiry has already sealed the attempt", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-expiry-before-reset",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(30);
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  await invokeJson(handler, `/sessions/${session.id}/input-event`, {
    type: "input.recording.started",
    source: "browser",
    monotonicMs: 1_500
  });
  await invokeJson(handler, `/sessions/${session.id}/input-event`, {
    type: "input.recording.stopped",
    source: "browser",
    monotonicMs: 1_800,
    durationMs: 300
  });
  await waitForCondition(() => store.getSession(session.id)?.status === "error");
  const reset = await invokeJson(handler, `/sessions/${session.id}/demo-event`, {
    type: "session.reset"
  });

  assert.equal(reset.statusCode, 200);
  assert.equal(store.getSession(session.id)?.status, "reset");
  assert.deepEqual(
    store.getSession(session.id)?.events.map((event) => event.type),
    [
      "input.recording.started",
      "input.recording.stopped",
      "session.error",
      "session.reset"
    ]
  );
  assert.equal(attemptDeadlines.activeCount, 0);
});

test("cancelling one attempt deadline does not affect another session", async () => {
  const store = new SessionStore();
  const sessionA = store.createSession({
    sessionId: "deadline-isolation-a",
    source: "browser"
  });
  const sessionB = store.createSession({
    sessionId: "deadline-isolation-b",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(100);
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  for (const [index, current] of [sessionA, sessionB].entries()) {
    await invokeJson(handler, `/sessions/${current.id}/input-event`, {
      type: "input.recording.started",
      source: "browser",
      monotonicMs: 2_000 + index * 1_000
    });
    await invokeJson(handler, `/sessions/${current.id}/input-event`, {
      type: "input.recording.stopped",
      source: "browser",
      monotonicMs: 2_300 + index * 1_000,
      durationMs: 300
    });
  }

  await invokeJson(handler, `/sessions/${sessionA.id}/demo-event`, {
    type: "session.reset"
  });
  await waitForCondition(() => store.getSession(sessionB.id)?.status === "error");

  assert.equal(store.getSession(sessionA.id)?.status, "reset");
  assert.equal(
    store.getSession(sessionA.id)?.events.some(
      (event) => event.type === "session.error"
    ),
    false
  );
  assert.equal(store.getSession(sessionB.id)?.status, "error");
  assert.equal(
    store.getSession(sessionB.id)?.events.at(-1)?.code,
    "analysis_deadline_exceeded"
  );
  assert.equal(attemptDeadlines.activeCount, 0);
});

test("hard deadline detaches a noncooperative pipeline and seals late completion", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-noncooperative",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(1_000);
  const started = deferred();
  const completion = deferred();
  let statusObservedAtAbort;
  const pipelineRunner = ({ signal }) => {
    signal.addEventListener("abort", () => {
      statusObservedAtAbort = store.getSession(session.id)?.status;
    }, { once: true });
    started.resolve();
    return completion.promise;
  };
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    pipelineRunner,
    receipts: new ReceiptWriter(false),
    store
  });

  const uploadPromise = invokeAudio(
    handler,
    `/sessions/${session.id}/audio?source=browser`
  );
  await within(started.promise, 5_000);
  const upload = await within(uploadPromise, 10_000);

  assert.equal(upload.statusCode, 409);
  assert.equal(statusObservedAtAbort, "error");
  assert.equal(store.getSession(session.id)?.status, "error");
  assert.deepEqual(
    store.getSession(session.id)?.events.map((event) => event.type),
    ["audio.uploaded", "session.error"]
  );

  completion.resolve(fakeAudioPipelineResult(session.id));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(store.getSession(session.id)?.result, undefined);
  assert.equal(
    store.getSession(session.id)?.events.filter(
      (event) => event.type === "session.error"
    ).length,
    1
  );
});

test("a result commit disarms the hard deadline before receipt work", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-result-wins",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(150);
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    pipelineRunner: async () => fakeAudioPipelineResult(session.id),
    receipts: new ReceiptWriter(false),
    store
  });

  const upload = await invokeAudio(
    handler,
    `/sessions/${session.id}/audio?source=browser`
  );
  assert.equal(upload.statusCode, 202);
  assert.equal(store.getSession(session.id)?.status, "result");
  assert.equal(attemptDeadlines.activeCount, 0);

  await new Promise((resolve) => setTimeout(resolve, 190));
  assert.equal(store.getSession(session.id)?.status, "result");
  assert.equal(
    store.getSession(session.id)?.events.some(
      (event) => event.type === "session.error"
    ),
    false
  );
});

test("a terminal receipt write failure preserves the result acknowledgement and is observable", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "terminal-receipt-failure",
    source: "browser"
  });
  const receipts = {
    enabled: true,
    async write(current) {
      if (current.events.at(-1)?.type === "session.result") {
        throw new Error("simulated terminal receipt failure");
      }
    }
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    pipelineRunner: async () => fakeAudioPipelineResult(session.id),
    receipts,
    store
  });
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));

  try {
    const upload = await invokeAudio(
      handler,
      `/sessions/${session.id}/audio?source=browser`
    );

    assert.equal(upload.statusCode, 202);
    assert.equal(upload.body.session.status, "result");
    assert.deepEqual(upload.body.receiptPersistenceFailure, {
      status: "failed",
      code: "receipt_persistence_failed",
      eventType: "session.result",
      sequence: upload.body.session.lastSequence,
      message: "The terminal event committed, but its receipt snapshot was not persisted."
    });
    assert.equal(
      store.getSession(session.id).events.filter(
        (event) => event.type === "session.result"
      ).length,
      1
    );
    assert.equal(
      store.getSession(session.id).events.some(
        (event) => event.type === "session.error"
      ),
      false
    );

    const observed = await invokeGet(handler, `/sessions/${session.id}`);
    assert.equal(observed.statusCode, 200);
    assert.deepEqual(
      observed.body.receiptPersistenceFailure,
      upload.body.receiptPersistenceFailure
    );
    assert.equal(logged.length, 1);
    assert.match(logged[0], /terminal snapshot write failed/);
  } finally {
    console.error = originalConsoleError;
  }
});

test("an overdue synchronous pipeline result is rejected at the commit boundary", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-sync-boundary",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(20);
  const handler = createRequestHandler({
    attemptDeadlines,
    bus: new EventBus(),
    pipelineRunner: async () => {
      const blockedUntil = performance.now() + 45;
      while (performance.now() < blockedUntil) {
        // This models the current synchronous DSP boundary.
      }
      return fakeAudioPipelineResult(session.id);
    },
    receipts: new ReceiptWriter(false),
    store
  });

  const upload = await invokeAudio(
    handler,
    `/sessions/${session.id}/audio?source=browser`
  );

  assert.equal(upload.statusCode, 409);
  assert.equal(store.getSession(session.id)?.status, "error");
  assert.equal(store.getSession(session.id)?.result, undefined);
  assert.deepEqual(
    store.getSession(session.id)?.events.map((event) => event.type),
    ["audio.uploaded", "session.error"]
  );
});

test("attempt deadlines abort slow request bodies and release ingress capacity", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "deadline-slow-body",
    source: "browser"
  });
  const attemptDeadlines = new AttemptDeadlineRegistry(30);
  const releaseBody = deferred();
  const request = Readable.from((async function* slowBody() {
    yield Uint8Array.from([1, 2, 3, 4]);
    await releaseBody.promise;
  })());
  request.method = "POST";
  request.url = `/sessions/${session.id}/audio?source=browser`;
  request.headers = { "content-type": "audio/wav" };
  const response = new MockResponse();
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 64,
    maxPipelineBytes: audioPipelineReservationBytes(4),
    maxPipelines: 1
  });
  const handler = createRequestHandler({
    audioAdmission,
    attemptDeadlines,
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });
  let requestSettled = false;
  const handling = handler(request, response).then(() => {
    requestSettled = true;
  });

  await waitForCondition(() => store.getSession(session.id)?.status === "error");
  assert.equal(store.getSession(session.id)?.events.at(-1)?.code, "analysis_deadline_exceeded");
  await within(handling, 1_000);
  assert.equal(requestSettled, true);
  assert.equal(response.statusCode, 409);
  assert.equal(attemptDeadlines.activeCount, 0);
  assert.equal(audioAdmission.snapshot().ingress.reservedBytes, 0);
  assert.equal(audioAdmission.snapshot().ingress.activeLeases, 0);
  releaseBody.resolve();
});

test("reset commits before it cancels a deferred audio pipeline", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "audio-reset-cooperative",
    source: "browser"
  });
  const started = deferred();
  let statusObservedAtAbort;
  const pipelineRunner = ({ signal }) => {
    started.resolve(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        statusObservedAtAbort = store.getSession(session.id)?.status;
        reject(signal.reason);
      }, { once: true });
    });
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    pipelineRunner,
    receipts: new ReceiptWriter(false),
    store
  });

  const uploadPromise = invokeAudio(
    handler,
    `/sessions/${session.id}/audio?source=browser`
  );
  const signal = await started.promise;
  const reset = await invokeJson(handler, `/sessions/${session.id}/demo-event`, {
    type: "session.reset",
    payload: {}
  });
  const upload = await uploadPromise;

  assert.equal(reset.statusCode, 200);
  assert.equal(statusObservedAtAbort, "reset");
  assert.equal(signal.aborted, true);
  assert.equal(upload.statusCode, 409);
  assert.equal(store.getSession(session.id)?.status, "reset");
  assert.deepEqual(
    store.getSession(session.id)?.events.map((event) => event.type),
    ["audio.uploaded", "session.reset"]
  );
});

test("reset wins even when an audio pipeline ignores cancellation", async () => {
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "audio-reset-noncooperative",
    source: "browser"
  });
  const started = deferred();
  const completion = deferred();
  const pipelineRunner = ({ signal }) => {
    started.resolve(signal);
    return completion.promise;
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    pipelineRunner,
    receipts: new ReceiptWriter(false),
    store
  });

  const uploadPromise = invokeAudio(
    handler,
    `/sessions/${session.id}/audio?source=browser`
  );
  const signal = await started.promise;
  const reset = await invokeJson(handler, `/sessions/${session.id}/demo-event`, {
    type: "session.reset",
    payload: {}
  });
  completion.resolve({});
  const upload = await uploadPromise;

  assert.equal(reset.statusCode, 200);
  assert.equal(signal.aborted, true);
  assert.equal(upload.statusCode, 409);
  assert.equal(store.getSession(session.id)?.status, "reset");
  assert.deepEqual(
    store.getSession(session.id)?.events.map((event) => event.type),
    ["audio.uploaded", "session.reset"]
  );
});

test("manual input cannot overwrite a recording or sealed session", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "manual-guard", source: "browser" });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  await invokeJson(handler, "/sessions/manual-guard/input-event", {
    type: "input.recording.started",
    source: "browser"
  });
  const whileRecording = await invokeJson(
    handler,
    "/sessions/manual-guard/manual-transcript",
    { transcript: "这一轮不应该覆盖录音。", language: "zh" }
  );

  assert.equal(whileRecording.statusCode, 409);
  assert.equal(store.getSession("manual-guard")?.status, "recording");

  const sealedStore = new SessionStore();
  sealedStore.createSession({ sessionId: "manual-sealed", source: "browser" });
  const sealedHandler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store: sealedStore
  });
  const first = await invokeJson(
    sealedHandler,
    "/sessions/manual-sealed/manual-transcript",
    { transcript: "我想先完成这一轮。", language: "zh" }
  );
  const second = await invokeJson(
    sealedHandler,
    "/sessions/manual-sealed/manual-transcript",
    { transcript: "这不应该成为第二个结果。", language: "zh" }
  );

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 409);
  assert.equal(
    sealedStore.getSession("manual-sealed")?.events.filter(
      (event) => event.type === "session.result"
    ).length,
    1
  );
});

test("concurrent manual requests have exactly one input owner and result", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "manual-race", source: "browser" });
  const handler = createRequestHandler({
    bus: new EventBus(),
    receipts: new ReceiptWriter(false),
    store
  });

  const responses = await Promise.all([
    invokeJson(handler, "/sessions/manual-race/manual-transcript", {
      transcript: "第一条输入应该成为唯一结果。",
      language: "zh"
    }),
    invokeJson(handler, "/sessions/manual-race/manual-transcript", {
      transcript: "第二条并发输入不能覆盖它。",
      language: "zh"
    })
  ]);

  assert.deepEqual(
    responses.map((response) => response.statusCode).sort(),
    [200, 409]
  );
  assert.equal(
    store.getSession("manual-race")?.events.filter(
      (event) => event.type === "session.result"
    ).length,
    1
  );
});

test("manual snapshots become visible in the same order as their events", async () => {
  const store = new SessionStore();
  store.createSession({ sessionId: "manual-order", source: "browser" });
  const bus = new EventBus();
  const observations = [];
  bus.subscribe((event) => {
    const session = store.getSession(event.sessionId);
    observations.push({
      type: event.type,
      sequence: event.sequence,
      readingCount: session?.readings?.length ?? 0,
      hasResult: Boolean(session?.result)
    });
  });
  const handler = createRequestHandler({
    bus,
    receipts: new ReceiptWriter(false),
    store
  });

  const response = await invokeJson(
    handler,
    "/sessions/manual-order/manual-transcript",
    { transcript: "我不想放弃，但我也需要停下来想一想。", language: "zh" }
  );

  assert.equal(response.statusCode, 200);
  const resultIndex = observations.findIndex((entry) => entry.type === "session.result");
  assert.ok(resultIndex > 0);
  assert.equal(observations.slice(0, resultIndex).some((entry) => entry.hasResult), false);
  assert.deepEqual(
    observations
      .filter((entry) => entry.type === "reading.channel.resolved")
      .map((entry) => entry.readingCount),
    [1, 2, 3]
  );
  assert.equal(observations[resultIndex].hasResult, true);
  assert.deepEqual(
    observations.map((entry) => entry.sequence),
    observations.map((_, index) => index + 1)
  );
});

test("manual result response does not wait for delayed TTS output", async () => {
  const previousDelay = process.env.TTS_AFTER_RESULT_DELAY_MS;
  const previousLegacyDelay = process.env.RESULT_REVEAL_MS;
  const previousProvider = process.env.TTS_PROVIDER;
  process.env.TTS_AFTER_RESULT_DELAY_MS = "5000";
  delete process.env.RESULT_REVEAL_MS;
  delete process.env.TTS_PROVIDER;

  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "manual-delayed-tts",
    source: "browser"
  });
  const bus = new EventBus();
  const publishedTypes = [];
  bus.subscribe((event) => publishedTypes.push(event.type));
  const outputs = new OutputScheduler();
  const handler = createRequestHandler({
    bus,
    outputs,
    receipts: new ReceiptWriter(false),
    store
  });

  try {
    const startedAt = Date.now();
    const response = await invokeJson(
      handler,
      "/sessions/manual-delayed-tts/manual-transcript",
      { transcript: "我想先完成这一轮。", language: "zh" }
    );
    const responseMs = Date.now() - startedAt;

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.session.status, "result");
    assert.ok(response.body.session.result.tts);
    assert.ok(
      responseMs < 1000,
      `manual result response took ${responseMs} ms with a 5000 ms TTS delay`
    );
    assert.ok(publishedTypes.includes("session.result"));
    assert.equal(publishedTypes.includes("tts.started"), false);
    assert.equal(outputs.activeKey, `${session.id}:${session.attemptId}`);
    assert.equal(outputs.idle, false);
  } finally {
    outputs.cancelActive(new Error("test cleanup"));
    await outputs.waitForIdle();
    restoreEnvironmentVariable("TTS_AFTER_RESULT_DELAY_MS", previousDelay);
    restoreEnvironmentVariable("RESULT_REVEAL_MS", previousLegacyDelay);
    restoreEnvironmentVariable("TTS_PROVIDER", previousProvider);
  }
});

test("resetting one session does not cancel another session's active output", async () => {
  const store = new SessionStore();
  const sessionA = store.createSession({
    sessionId: "reset-session-a",
    source: "browser"
  });
  const sessionB = store.createSession({
    sessionId: "speaking-session-b",
    source: "browser"
  });
  const outputs = new OutputScheduler();
  const outputStarted = deferred();
  let outputSignal;
  const outputCompletion = outputs.schedule(
    `${sessionB.id}:${sessionB.attemptId}`,
    async (signal) => {
      outputSignal = signal;
      outputStarted.resolve();
      await waitForAbort(signal);
    }
  );
  const handler = createRequestHandler({
    bus: new EventBus(),
    outputs,
    receipts: new ReceiptWriter(false),
    store
  });

  await outputStarted.promise;
  const response = await invokeJson(
    handler,
    `/sessions/${sessionA.id}/demo-event`,
    { type: "session.reset" }
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.session.status, "reset");
  assert.equal(outputSignal.aborted, false);
  assert.equal(outputs.activeKey, `${sessionB.id}:${sessionB.attemptId}`);

  outputs.cancel(`${sessionB.id}:${sessionB.attemptId}`, new Error("test cleanup"));
  assert.equal((await outputCompletion).status, "cancelled");
  await outputs.waitForIdle();
});

test("a started TTS lifecycle is sealed when output work fails", async () => {
  const previousDelay = process.env.TTS_AFTER_RESULT_DELAY_MS;
  const previousLegacyDelay = process.env.RESULT_REVEAL_MS;
  process.env.TTS_AFTER_RESULT_DELAY_MS = "0";
  delete process.env.RESULT_REVEAL_MS;

  const store = new SessionStore();
  store.createSession({ sessionId: "tts-failure-lifecycle", source: "browser" });
  const outputs = new OutputScheduler();
  let failedOnce = false;
  const receipts = {
    enabled: true,
    async write(session) {
      if (!failedOnce && session.events.at(-1)?.type === "tts.started") {
        failedOnce = true;
        throw new Error("simulated receipt failure");
      }
    }
  };
  const handler = createRequestHandler({
    bus: new EventBus(),
    outputs,
    receipts,
    store
  });
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    const response = await invokeJson(
      handler,
      "/sessions/tts-failure-lifecycle/manual-transcript",
      { transcript: "我需要一个可以收口的输出生命周期。", language: "zh" }
    );
    await outputs.waitForIdle();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(response.statusCode, 200);
    assert.equal(failedOnce, true);
    const current = store.getSession("tts-failure-lifecycle");
    assert.deepEqual(
      current.events.slice(-2).map((event) => event.type),
      ["tts.started", "tts.finished"]
    );
    assert.equal(current.events.at(-1).provider.id, "local:tts:failed");
    assert.deepEqual(
      current.events.map((event) => event.sequence),
      current.events.map((_, index) => index + 1)
    );
  } finally {
    console.error = originalConsoleError;
    restoreEnvironmentVariable("TTS_AFTER_RESULT_DELAY_MS", previousDelay);
    restoreEnvironmentVariable("RESULT_REVEAL_MS", previousLegacyDelay);
  }
});

async function invokeJson(handler, url, body, headers = {}) {
  const request = Readable.from([JSON.stringify(body)]);
  request.method = "POST";
  request.url = url;
  request.headers = { "content-type": "application/json", ...headers };

  const response = new MockResponse();
  await handler(request, response);

  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.output),
    headers: response.headers
  };
}

async function invokeJsonChunks(handler, url, chunks, headers = {}) {
  const request = Readable.from(chunks);
  request.method = "POST";
  request.url = url;
  request.headers = { "content-type": "application/json", ...headers };

  const response = new MockResponse();
  await handler(request, response);

  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.output),
    headers: response.headers
  };
}

async function invokeGet(handler, url) {
  const request = Readable.from([]);
  request.method = "GET";
  request.url = url;
  request.headers = {};

  const response = new MockResponse();
  await handler(request, response);

  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.output)
  };
}

async function invokeAudio(handler, url, headers = {}) {
  const request = Readable.from([Uint8Array.from([1, 2, 3, 4])]);
  request.method = "POST";
  request.url = url;
  request.headers = { "content-type": "audio/wav", ...headers };

  const response = new MockResponse();
  await handler(request, response);

  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.output)
  };
}

function fakeAudioPipelineResult(sessionId) {
  const features = {
    durationMs: 400,
    speechMs: 300,
    silenceMs: 100,
    pauseCount: 0,
    longestPauseMs: 0,
    rmsMean: 0.08,
    rmsStd: 0.01,
    rmsPeak: 0.2
  };
  const readings = ["text", "voice", "timing"].map((channel) => ({
    channel,
    state: "static",
    confidence: 0.5,
    availability: "measured",
    features: { fixture: true }
  }));
  return {
    uploadedAudio: {
      source: "browser",
      mediaType: "audio/wav",
      byteSize: 4,
      durationMs: 400
    },
    normalizedAudio: {
      mediaType: "audio/wav",
      sampleRateHz: 16000,
      channelCount: 1,
      durationMs: 400,
      latencyMs: 1
    },
    pipeline: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      totalLatencyMs: 1,
      stages: [
        {
          stage: "total",
          status: "ready",
          latencyMs: 1,
          provider: "test:pipeline"
        }
      ]
    },
    transcript: {
      text: "fixture",
      semanticText: "fixture",
      language: "en",
      provider: "test:stt",
      latencyMs: 1
    },
    features,
    readings,
    result: {
      sessionId,
      readings,
      majorityState: "static",
      minorityStates: [],
      topWindow: {
        status: "consensus_static",
        lineEn: "Fixture result.",
        lineZh: "测试结果。"
      },
      coverage: {
        total: 3,
        measured: 3,
        simulated: 0,
        unavailable: 0,
        unavailableChannels: []
      },
      colors: {}
    }
  };
}

function fakeSttExecutionIdentity() {
  return {
    runtime: {
      name: "fake-stt",
      version: "1.0.0-test"
    },
    configuration: {
      language: "auto",
      threads: 1,
      executionProvider: "cpu",
      useItn: false
    },
    artifacts: {
      model: {
        name: "fake-model.onnx",
        sha256: "a".repeat(64),
        bytes: 123
      },
      tokens: {
        name: "fake-tokens.txt",
        sha256: "b".repeat(64),
        bytes: 45
      }
    }
  };
}

async function waitForCondition(predicate, timeoutMs = 1_000) {
  const expiresAt = performance.now() + timeoutMs;
  while (performance.now() < expiresAt) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true before timeout");
}

async function within(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("operation timed out")),
          timeoutMs
        );
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function waitForAbort(signal) {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", resolve, { once: true });
  });
}

class MockResponse {
  statusCode = 0;
  output = "";
  headers = new Map();

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), String(value));
  }

  writeHead(statusCode) {
    this.statusCode = statusCode;
  }

  end(value = "") {
    this.output += String(value);
  }
}

function restoreEnvironmentVariable(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
