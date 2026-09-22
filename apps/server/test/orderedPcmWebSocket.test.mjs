import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";

import {
  ORDERED_PCM_BINARY_ENVELOPE_VERSION,
  ORDERED_PCM_BINARY_FIXED_HEADER_BYTES,
  OrderedPcmOutboundMessageSchema,
  SessionReceiptSchema,
  canonicalizeOrderedPcmProfile,
  encodeOrderedPcmBinaryEnvelope
} from "../../../packages/protocol/dist/index.js";
import { AttemptDeadlineRegistry } from "../dist/attemptDeadline.js";
import { AttemptWorkRegistry } from "../dist/attemptWork.js";
import { AudioResourceAdmission } from "../dist/audioResourceAdmission.js";
import { EventBus } from "../dist/eventBus.js";
import {
  ORDERED_PCM_WS_SUBPROTOCOL,
  attachOrderedPcmWebSocketServer
} from "../dist/orderedPcmWebSocket.js";
import { OutputScheduler } from "../dist/outputScheduler.js";
import { buildSessionReceipt, ReceiptWriter } from "../dist/receipts.js";
import { createRequestHandler } from "../dist/routes.js";
import { SessionStore } from "../dist/sessionStore.js";
import { StreamingSttScheduler } from "../dist/streamingStt.js";
import { createFakeStreamingSttAdapter } from "./fixtures/fake-streaming-stt-adapter.mjs";

const testOrigin = "http://test.local";
// These are correctness tests, not latency gates. Keep their harness ceiling
// comfortably above a heavily loaded development host; the dedicated timeout
// case below supplies a 30 ms start budget explicitly.
const testMessageTimeoutMs = 30_000;
const zeroLoss = {
  captureGapCount: 0,
  droppedFrameCount: 0,
  droppedByteCount: 0,
  overflowCount: 0
};
const profile = {
  sampleFormat: "s16le",
  sampleRateHz: 48_000,
  channelCount: 1
};

test("ordered PCM construction fails closed for every present invalid numeric policy", () => {
  const names = [
    "JIKO_ORDERED_PCM_CAPTURE_TIMEOUT_MS",
    "JIKO_ORDERED_PCM_START_TIMEOUT_MS",
    "JIKO_ORDERED_PCM_MAX_CONNECTIONS",
    "JIKO_ORDERED_PCM_MAX_CHUNKS",
    "JIKO_ORDERED_PCM_MAX_SPOOL_BYTES",
    "JIKO_ORDERED_PCM_MAX_WAL_BYTES"
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));

  try {
    for (const name of names) {
      delete process.env[name];
    }
    for (const name of names) {
      process.env[name] = "0";
      assert.throws(
        () => attachOrderedPcmWebSocketServer(http.createServer(), {}),
        new RegExp(`${name} must be a positive safe integer`)
      );
      delete process.env[name];
    }

    for (const value of ["", "1.5", "9007199254740992", "not-a-number"]) {
      process.env.JIKO_ORDERED_PCM_MAX_CHUNKS = value;
      assert.throws(
        () => attachOrderedPcmWebSocketServer(http.createServer(), {}),
        /JIKO_ORDERED_PCM_MAX_CHUNKS must be a positive safe integer/
      );
    }
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});

test("ordered PCM WebSocket spools input, runs the canonical pipeline once, and cleans raw spool", async () => {
  const pipelineBodies = [];
  const harness = await createHarness({
    pipelineRunner: async (input) => {
      pipelineBodies.push(input.body);
      return fakeAudioPipelineResult(input.sessionId);
    }
  });

  try {
    const session = await harness.createSession("ws-normal");
    const client = await harness.connect(session.id);
    const pcm = Uint8Array.from([0, 0, 1, 0, 255, 255, 2, 0]);
    const identity = orderedPcmIdentity(session);

    const startAck = await sendAndReceive(client, startMessage(identity));
    assert.equal(startAck.type, "audio.ack");
    assert.equal(startAck.acknowledgedType, "audio.start");
    assert.equal(startAck.acknowledgedSequence, 0);
    assert.equal(startAck.commitState, "spooled");
    assert.deepEqual(
      await readdir(harness.spoolRoot),
      [],
      "active raw PCM and WAL should already be unlinked"
    );

    const chunkAck = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_010,
      frameCount: 4,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    assert.equal(chunkAck.type, "audio.ack");
    assert.equal(chunkAck.acknowledgedSequence, 1);
    assert.equal(chunkAck.commitState, "spooled");

    const closePromise = once(client, "close");
    const stopAck = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_020,
      finalSequence: 1,
      emittedFrameCount: 4,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });
    assert.equal(stopAck.type, "audio.ack", JSON.stringify(stopAck));
    assert.equal(stopAck.acknowledgedType, "audio.stop");
    assert.equal(stopAck.commitState, "finalized");
    assert.equal(stopAck.receipt.coverageComplete, true);
    assert.equal(stopAck.receipt.pcmProfile.sampleRateHz, 48_000);
    assert.equal(pipelineBodies.length, 1);
    assert.equal(ascii(pipelineBodies[0], 0, 4), "RIFF");
    assert.equal(ascii(pipelineBodies[0], 8, 4), "WAVE");
    assert.equal(new DataView(pipelineBodies[0].buffer).getUint32(24, true), 48_000);
    assert.deepEqual(
      [...pipelineBodies[0].subarray(44)],
      [...pcm]
    );

    const stored = harness.store.getSession(session.id);
    assert.equal(stored.status, "result");
    assert.equal(
      stored.events.filter((event) => event.type === "session.result").length,
      1
    );
    const receipt = SessionReceiptSchema.parse(buildSessionReceipt(stored));
    assert.equal(receipt.input.orderedPcm.coverageComplete, true);
    assert.equal(receipt.input.audioStored, false);

    await closePromise;
    assert.deepEqual(await readdir(harness.spoolRoot), []);
  } finally {
    await harness.close();
  }
});

test("ordered PCM keeps the finalized ack when the committed result receipt write fails", async () => {
  const receipts = {
    enabled: true,
    async lookupSessionIdentity() {
      return undefined;
    },
    async write(session) {
      if (session.events.at(-1)?.type === "session.result") {
        throw new Error("simulated ordered PCM receipt failure");
      }
    }
  };
  const harness = await createHarness({ receipts });
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    const session = await harness.createSession("ws-terminal-receipt-failure");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    const pcm = Uint8Array.from([1, 0, 2, 0]);
    await sendAndReceive(client, startMessage(identity));
    await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_010,
      frameCount: 2,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    const finalized = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_020,
      finalSequence: 1,
      emittedFrameCount: 2,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });

    assert.equal(finalized.type, "audio.ack");
    assert.equal(finalized.acknowledgedType, "audio.stop");
    assert.equal(finalized.commitState, "finalized");
    const stored = harness.store.getSession(session.id);
    assert.equal(stored.status, "result");
    assert.equal(
      stored.events.filter((event) => event.type === "session.result").length,
      1
    );
    assert.equal(
      stored.events.some((event) => event.type === "session.error"),
      false
    );
  } finally {
    console.error = originalConsoleError;
    await harness.close();
  }
});

test("ordered PCM exposes streaming partials only to the observer and gives the pipeline only the final", async () => {
  const fake = createFakeStreamingSttAdapter({
    partialText: () => "replaceable observer text",
    finalText: "coverage checked final"
  });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const partials = [];
  const pipelineInputs = [];
  const harness = await createHarness({
    streamingStt: {
      scheduler,
      onPartial: (partial) => partials.push(partial)
    },
    pipelineRunner: async (input) => {
      pipelineInputs.push(input);
      return fakeAudioPipelineResult(input.sessionId);
    }
  });

  try {
    const session = await harness.createSession("ws-streaming-boundary");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    const pcm = Uint8Array.from([1, 0, 2, 0, 3, 0, 4, 0]);
    await sendAndReceive(client, startMessage(identity));
    await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_010,
      frameCount: 4,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    const finalized = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_020,
      finalSequence: 1,
      emittedFrameCount: 4,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });

    assert.equal(finalized.type, "audio.ack");
    assert.equal(finalized.commitState, "finalized");
    assert.deepEqual(partials.map((partial) => partial.text), [
      "replaceable observer text"
    ]);
    assert.equal(pipelineInputs.length, 1);
    assert.equal(
      pipelineInputs[0].acceptedStreamingFinal.transcript.text,
      "coverage checked final"
    );
    assert.equal(
      pipelineInputs[0].acceptedStreamingFinal.providerReceipt.outcome,
      "completed"
    );
    assert.equal(
      harness.store.getSession(session.id).events.some(
        (event) => event.type.includes("partial")
      ),
      false
    );
  } finally {
    scheduler.close(new Error("test complete"));
    await harness.close();
  }
});

test("ordered PCM rejects an older sequence, seals the session, skips STT, and cleans spool", async () => {
  let pipelineCalls = 0;
  const harness = await createHarness({
    pipelineRunner: async (input) => {
      pipelineCalls += 1;
      return fakeAudioPipelineResult(input.sessionId);
    }
  });

  try {
    const session = await harness.createSession("ws-out-of-order");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    const pcm = Uint8Array.from([0, 0]);
    await sendAndReceive(client, startMessage(identity));
    const gapAck = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 2,
      sourceMonotonicMs: 1_010,
      frameCount: 1,
      byteCount: 2,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    assert.equal(gapAck.type, "audio.ack");

    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_011,
      frameCount: 1,
      byteCount: 2,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "out_of_order_sequence");
    await closePromise;

    assert.equal(pipelineCalls, 0);
    assert.equal(harness.store.getSession(session.id).status, "error");
    assert.equal(
      harness.store.getSession(session.id).events.at(-1).code,
      "ordered_pcm_out_of_order_sequence"
    );
    assert.deepEqual(await readdir(harness.spoolRoot), []);
  } finally {
    await harness.close();
  }
});

test("ordered PCM duplicate start seals the claimed attempt instead of stranding recording", async () => {
  const harness = await createHarness();

  try {
    const session = await harness.createSession("ws-duplicate-start");
    const client = await harness.connect(session.id);
    const start = startMessage(orderedPcmIdentity(session));
    await sendAndReceive(client, start);

    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, start);
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "already_started");
    await closePromise;

    const stored = harness.store.getSession(session.id);
    assert.equal(stored.status, "error");
    assert.equal(stored.events.at(-1).code, "ordered_pcm_already_started");
    assert.equal(harness.pipelineCalls(), 0);
    assert.deepEqual(await readdir(harness.spoolRoot), []);
  } finally {
    await harness.close();
  }
});

test("external recording events cannot steal an attempt owned by ordered PCM", async () => {
  const harness = await createHarness({ maxSpoolBytes: 16 * 1_024 });

  try {
    const session = await harness.createSession("ws-external-stop-conflict");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    const pcm = new Uint8Array(4_800 * 2);
    await sendAndReceive(client, startMessage(identity));

    const stopResponse = await harness.postInputEvent(session.id, {
      type: "input.recording.stopped",
      source: "browser",
      monotonicMs: 1_100,
      durationMs: 100
    });
    assert.equal(stopResponse.status, 409);
    assert.equal(harness.store.getSession(session.id).status, "recording");

    await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_100,
      frameCount: 4_800,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    const finalized = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_100,
      finalSequence: 1,
      emittedFrameCount: 4_800,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });
    assert.equal(finalized.type, "audio.ack");
    assert.equal(finalized.commitState, "finalized");
    assert.equal(harness.store.getSession(session.id).status, "result");
  } finally {
    await harness.close();
  }
});

test("ordered PCM start cannot steal an attempt already claimed by another input", async () => {
  const harness = await createHarness();

  try {
    const session = await harness.createSession("ws-claim-conflict");
    assert.equal(
      harness.store.claimAttemptInput(session.id, session.attemptId, "manual"),
      true
    );
    const client = await harness.connect(session.id);
    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(
      client,
      startMessage(orderedPcmIdentity(session))
    );
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "input_claim_conflict");
    await closePromise;

    assert.equal(harness.pipelineCalls(), 0);
    assert.equal(harness.store.getSession(session.id).status, "created");
    assert.deepEqual(await readdir(harness.spoolRoot), []);
  } finally {
    await harness.close();
  }
});

test("ordered PCM spool cap fails closed before pipeline work and removes partial PCM", async () => {
  const harness = await createHarness({ maxSpoolBytes: 4 });

  try {
    const session = await harness.createSession("ws-cap");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    await sendAndReceive(client, startMessage(identity));
    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_010,
      frameCount: 4,
      byteCount: 8,
      lossEvidence: zeroLoss,
      pcmBytes: new Uint8Array(8)
    });
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "capacity_exceeded");
    await closePromise;

    assert.equal(harness.pipelineCalls(), 0);
    assert.equal(harness.store.getSession(session.id).status, "error");
    assert.deepEqual(await readdir(harness.spoolRoot), []);
    assert.equal(harness.audioAdmission.snapshot().ingress.reservedBytes, 0);
  } finally {
    await harness.close();
  }
});

test("ordered PCM enforces one process-wide spool budget and releases it after failures and disconnects", async () => {
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 4_000,
    maxPipelineBytes: 8_000,
    maxPipelines: 1
  });
  const harness = await createHarness({
    audioAdmission,
    maxSpoolBytes: 4_096
  });

  try {
    const firstSession = await harness.createSession("ws-global-cap-first");
    const secondSession = await harness.createSession("ws-global-cap-second");
    const first = await harness.connect(firstSession.id);
    const second = await harness.connect(secondSession.id);
    const firstIdentity = orderedPcmIdentity(firstSession);
    const secondIdentity = orderedPcmIdentity(secondSession);
    await sendAndReceive(first, startMessage(firstIdentity));
    await sendAndReceive(second, startMessage(secondIdentity));

    const pcm = new Uint8Array(1_800);
    const firstChunk = await sendAndReceive(first, {
      ...firstIdentity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_020,
      frameCount: pcm.byteLength / 2,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    assert.equal(firstChunk.type, "audio.ack");

    const secondClose = once(second, "close");
    const rejected = await sendAndReceive(second, {
      ...secondIdentity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_020,
      frameCount: pcm.byteLength / 2,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    assert.equal(rejected.type, "audio.error");
    assert.equal(rejected.code, "capacity_exceeded");
    await secondClose;
    assert.equal(
      harness.store.getSession(secondSession.id).events.at(-1).code,
      "ordered_pcm_capacity_exceeded"
    );
    assert.ok(audioAdmission.snapshot().ingress.reservedBytes > 0);

    const firstClose = once(first, "close");
    first.close(1000, "release first spool");
    await firstClose;
    await waitForCondition(
      () => audioAdmission.snapshot().ingress.reservedBytes === 0
    );
    assert.deepEqual(audioAdmission.snapshot().ingress, {
      reservedBytes: 0,
      maxBytes: 4_000,
      activeLeases: 0,
      maxLeases: 16,
      rejectedReservations: 1,
      rejectedSlotReservations: 0
    });

    const reusedSession = await harness.createSession("ws-global-cap-reused");
    const reused = await harness.connect(reusedSession.id);
    await sendAndReceive(reused, startMessage(orderedPcmIdentity(reusedSession)));
    assert.ok(audioAdmission.snapshot().ingress.reservedBytes > 0);
    const reusedClose = once(reused, "close");
    reused.close(1000, "release reused spool");
    await reusedClose;
    await waitForCondition(
      () => audioAdmission.snapshot().ingress.reservedBytes === 0
    );
  } finally {
    await harness.close();
  }
});

test("ordered PCM reserves each WAV allocation before concurrent finalization", async () => {
  let releaseFirstPipeline;
  let markFirstPipelineEntered;
  const firstPipelineEntered = new Promise((resolve) => {
    markFirstPipelineEntered = resolve;
  });
  const firstPipelineGate = new Promise((resolve) => {
    releaseFirstPipeline = resolve;
  });
  const audioAdmission = new AudioResourceAdmission({
    maxIngressBytes: 7_000,
    maxPipelineBytes: 32 * 1024 * 1024,
    maxPipelines: 2
  });
  const harness = await createHarness({
    audioAdmission,
    maxSpoolBytes: 4_096,
    pipelineRunner: async (input) => {
      if (input.sessionId === "ws-finalize-first") {
        markFirstPipelineEntered();
        await firstPipelineGate;
      }
      return fakeAudioPipelineResult(input.sessionId);
    }
  });

  try {
    const firstSession = await harness.createSession("ws-finalize-first");
    const secondSession = await harness.createSession("ws-finalize-second");
    const first = await harness.connect(firstSession.id);
    const second = await harness.connect(secondSession.id);
    const firstIdentity = orderedPcmIdentity(firstSession);
    const secondIdentity = orderedPcmIdentity(secondSession);
    await sendAndReceive(first, startMessage(firstIdentity));
    await sendAndReceive(second, startMessage(secondIdentity));

    const pcm = new Uint8Array(1_600);
    for (const [client, identity] of [
      [first, firstIdentity],
      [second, secondIdentity]
    ]) {
      const acknowledgement = await sendAndReceive(client, {
        ...identity,
        protocolVersion: "ordered_pcm_v1",
        type: "audio.chunk",
        sequence: 1,
        sourceMonotonicMs: 1_010,
        frameCount: pcm.byteLength / 2,
        byteCount: pcm.byteLength,
        lossEvidence: zeroLoss,
        pcmBytes: pcm
      });
      assert.equal(acknowledgement.type, "audio.ack");
    }

    const beforeFinalization = audioAdmission.snapshot().ingress.reservedBytes;
    const firstFinalized = sendAndReceive(first, {
      ...firstIdentity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_017,
      finalSequence: 1,
      emittedFrameCount: pcm.byteLength / 2,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });
    await firstPipelineEntered;
    assert.ok(
      audioAdmission.snapshot().ingress.reservedBytes >=
        beforeFinalization + pcm.byteLength + 44
    );

    const secondClose = once(second, "close");
    const rejected = await sendAndReceive(second, {
      ...secondIdentity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_017,
      finalSequence: 1,
      emittedFrameCount: pcm.byteLength / 2,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });
    assert.equal(rejected.type, "audio.error");
    assert.equal(rejected.code, "capacity_exceeded");
    await secondClose;
    assert.equal(harness.pipelineCalls(), 1);

    releaseFirstPipeline();
    const finalized = await firstFinalized;
    assert.equal(finalized.type, "audio.ack");
    assert.equal(finalized.commitState, "finalized");
    await waitForCondition(
      () => audioAdmission.snapshot().ingress.reservedBytes === 0
    );
  } finally {
    releaseFirstPipeline?.();
    await harness.close();
  }
});

test("ordered PCM accepts the exact sample-rate capture-duration boundary", async () => {
  const captureTimeoutMs = 5_000;
  const maximumFrameCount = profile.sampleRateHz * captureTimeoutMs / 1_000;
  const pcm = new Uint8Array(maximumFrameCount * 2);
  const harness = await createHarness({
    captureTimeoutMs,
    maxSpoolBytes: pcm.byteLength
  });

  try {
    const session = await harness.createSession("ws-duration-boundary");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    await sendAndReceive(client, startMessage(identity));
    await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_000 + captureTimeoutMs,
      frameCount: maximumFrameCount,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });

    const finalized = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_000 + captureTimeoutMs,
      finalSequence: 1,
      emittedFrameCount: maximumFrameCount,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });

    assert.equal(finalized.type, "audio.ack");
    assert.equal(finalized.commitState, "finalized");
    assert.equal(harness.pipelineCalls(), 1);
  } finally {
    await harness.close();
  }
});

test("ordered PCM rejects a fast frame flood beyond the capture-duration budget", async () => {
  const captureTimeoutMs = 5_000;
  const maximumFrameCount = profile.sampleRateHz * captureTimeoutMs / 1_000;
  const pcm = new Uint8Array((maximumFrameCount + 1) * 2);
  const harness = await createHarness({
    captureTimeoutMs,
    maxSpoolBytes: 12 * 1024 * 1024
  });

  try {
    const session = await harness.createSession("ws-fast-frame-flood");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    await sendAndReceive(client, startMessage(identity));

    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_000 + captureTimeoutMs,
      frameCount: maximumFrameCount + 1,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "capture_timeout");
    await closePromise;

    assert.equal(harness.pipelineCalls(), 0);
    assert.equal(harness.store.getSession(session.id).status, "error");
    assert.equal(harness.audioAdmission.snapshot().ingress.reservedBytes, 0);
    assert.deepEqual(await readdir(harness.spoolRoot), []);
  } finally {
    await harness.close();
  }
});

test("ordered PCM rejects a source clock beyond the capture timeout", async () => {
  const captureTimeoutMs = 5_000;
  const harness = await createHarness({ captureTimeoutMs });

  try {
    const session = await harness.createSession("ws-future-source-clock");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    await sendAndReceive(client, startMessage(identity));

    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_000 + captureTimeoutMs + 1,
      finalSequence: 0,
      emittedFrameCount: 0,
      emittedByteCount: 0,
      lossEvidence: zeroLoss
    });
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "capture_timeout");
    await closePromise;

    assert.equal(harness.pipelineCalls(), 0);
    assert.equal(harness.store.getSession(session.id).status, "error");
    assert.equal(harness.audioAdmission.snapshot().ingress.reservedBytes, 0);
  } finally {
    await harness.close();
  }
});

test("ordered PCM stop with sequence coverage loss records a receipt and never runs STT", async () => {
  const harness = await createHarness();

  try {
    const session = await harness.createSession("ws-incomplete");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    const pcm = Uint8Array.from([1, 0]);
    await sendAndReceive(client, startMessage(identity));
    await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 2,
      sourceMonotonicMs: 1_010,
      frameCount: 1,
      byteCount: 2,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });

    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_020,
      finalSequence: 2,
      emittedFrameCount: 2,
      emittedByteCount: 4,
      lossEvidence: zeroLoss
    });
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "coverage_incomplete");
    await closePromise;

    assert.equal(harness.pipelineCalls(), 0);
    const stored = harness.store.getSession(session.id);
    assert.equal(stored.status, "error");
    assert.equal(stored.orderedPcm.coverageComplete, false);
    assert.equal(stored.orderedPcm.missingChunkCount, 1);
    assert.deepEqual(
      stored.events.map((event) => event.type),
      [
        "session.created",
        "input.recording.started",
        "input.recording.stopped",
        "session.error"
      ]
    );
  } finally {
    await harness.close();
  }
});

test("ordered PCM disconnect before stop emits a canonical session.error", async () => {
  const harness = await createHarness();

  try {
    const session = await harness.createSession("ws-disconnect");
    const client = await harness.connect(session.id);
    await sendAndReceive(client, startMessage(orderedPcmIdentity(session)));
    const closePromise = once(client, "close");
    client.close(1000, "test disconnect");
    await closePromise;
    await waitForCondition(
      () => harness.store.getSession(session.id).status === "error"
    );

    assert.equal(harness.pipelineCalls(), 0);
    assert.equal(
      harness.store.getSession(session.id).events.at(-1).code,
      "ordered_pcm_transport_closed"
    );
    assert.deepEqual(await readdir(harness.spoolRoot), []);
  } finally {
    await harness.close();
  }
});

test("ordered PCM rejects source-clock coverage that omits wall-clock audio", async () => {
  const harness = await createHarness({ maxSpoolBytes: 16 * 1_024 });

  try {
    const session = await harness.createSession("ws-source-clock-gap");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    const pcm = new Uint8Array(4_800 * 2);
    await sendAndReceive(client, startMessage(identity));
    await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_100,
      frameCount: 4_800,
      byteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });

    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 2_000,
      finalSequence: 1,
      emittedFrameCount: 4_800,
      emittedByteCount: pcm.byteLength,
      lossEvidence: zeroLoss,
      sourcePcmSha256: sha256(pcm)
    });
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "coverage_incomplete");
    await closePromise;

    assert.equal(harness.store.getSession(session.id).status, "error");
    assert.equal(harness.pipelineCalls(), 0);
  } finally {
    await harness.close();
  }
});

test("ordered PCM upgrade requires an exact allowed Origin and fixed subprotocol", async () => {
  const harness = await createHarness();

  try {
    const session = await harness.createSession("ws-handshake-policy");
    await assert.rejects(
      harness.connect(session.id, "http://untrusted.test"),
      /Unexpected server response: 403/
    );
    await assert.rejects(
      harness.connect(session.id, testOrigin, "wrong.protocol"),
      /Unexpected server response: 426/
    );
    assert.equal(harness.store.getSession(session.id).status, "created");
    assert.equal(harness.pipelineCalls(), 0);
  } finally {
    await harness.close();
  }
});

test("ordered PCM rejects unsupported source profiles before claiming the attempt", async () => {
  const harness = await createHarness();

  try {
    const session = await harness.createSession("ws-unsupported-profile");
    const client = await harness.connect(session.id);
    const invalidProfile = {
      sampleFormat: "s16le",
      sampleRateHz: 1,
      channelCount: 1
    };
    const invalidStart = {
      protocolVersion: "ordered_pcm_v1",
      type: "audio.start",
      sessionId: session.id,
      attemptId: session.attemptId,
      sourceId: "malicious-profile-test",
      audioProfileHash: sha256(
        new TextEncoder().encode(JSON.stringify({
          channelCount: 1,
          sampleFormat: "s16le",
          sampleRateHz: 1
        }))
      ),
      sourceMonotonicMs: 1_000,
      pcmProfile: invalidProfile
    };

    const nextMessage = once(client, "message", {
      signal: AbortSignal.timeout(testMessageTimeoutMs)
    });
    const closePromise = once(client, "close");
    client.send(rawOrderedPcmEnvelope(1, invalidStart));
    const [raw, isBinary] = await nextMessage;
    assert.equal(isBinary, false);
    const rejection = OrderedPcmOutboundMessageSchema.parse(
      JSON.parse(raw.toString("utf8"))
    );
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "wire_error");
    await closePromise;

    assert.equal(harness.store.getSession(session.id).status, "created");
    assert.equal(
      harness.store.getAttemptInputClaim(session.id, session.attemptId),
      undefined
    );
    assert.equal(harness.pipelineCalls(), 0);
  } finally {
    await harness.close();
  }
});

test("malformed absolute-form upgrade target is rejected without crashing the server", async () => {
  const harness = await createHarness();

  try {
    const response = await harness.rawUpgrade("http://[");
    assert.match(response, /^HTTP\/1\.1 (?:400|404) /);

    const session = await harness.createSession("ws-after-malformed-target");
    assert.equal(session.status, "created");
  } finally {
    await harness.close();
  }
});

test("percent-encoded dot segments cannot normalize into the ordered PCM endpoint", async () => {
  const harness = await createHarness();

  try {
    const currentDirectory = await harness.rawUpgrade(
      "/sessions/%2e/ws-dot-target/audio-stream"
    );
    const parentDirectory = await harness.rawUpgrade(
      "/sessions/.%2E/sessions/ws-dot-target/audio-stream"
    );
    const literalCurrentDirectory = await harness.rawUpgrade(
      "/sessions/./audio-stream"
    );
    const literalParentDirectory = await harness.rawUpgrade(
      "/sessions/../audio-stream"
    );

    assert.match(currentDirectory, /^HTTP\/1\.1 404 /);
    assert.match(parentDirectory, /^HTTP\/1\.1 404 /);
    assert.match(literalCurrentDirectory, /^HTTP\/1\.1 404 /);
    assert.match(literalParentDirectory, /^HTTP\/1\.1 404 /);
    assert.equal(harness.store.listSessions().length, 0);
  } finally {
    await harness.close();
  }
});

test("ordered PCM bounds idle pre-start sockets and total connections", async () => {
  const harness = await createHarness({
    maxConnections: 1,
    startTimeoutMs: 30
  });

  try {
    const firstSession = await harness.createSession("ws-idle-first");
    const firstClient = await harness.connect(firstSession.id);
    const secondSession = await harness.createSession("ws-idle-second");
    await assert.rejects(
      harness.connect(secondSession.id),
      /Unexpected server response: 503/
    );

    const messagePromise = once(firstClient, "message");
    const closePromise = once(firstClient, "close");
    const [raw, isBinary] = await messagePromise;
    assert.equal(isBinary, false);
    const rejection = OrderedPcmOutboundMessageSchema.parse(
      JSON.parse(raw.toString("utf8"))
    );
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "capture_timeout");
    await closePromise;
    assert.equal(harness.store.getSession(firstSession.id).status, "created");
  } finally {
    await harness.close();
  }
});

test("ordered PCM stop rejects a source hash mismatch before STT", async () => {
  const harness = await createHarness();

  try {
    const session = await harness.createSession("ws-source-hash");
    const client = await harness.connect(session.id);
    const identity = orderedPcmIdentity(session);
    const pcm = Uint8Array.from([3, 0]);
    await sendAndReceive(client, startMessage(identity));
    await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.chunk",
      sequence: 1,
      sourceMonotonicMs: 1_010,
      frameCount: 1,
      byteCount: 2,
      lossEvidence: zeroLoss,
      pcmBytes: pcm
    });

    const closePromise = once(client, "close");
    const rejection = await sendAndReceive(client, {
      ...identity,
      protocolVersion: "ordered_pcm_v1",
      type: "audio.stop",
      sourceMonotonicMs: 1_020,
      finalSequence: 1,
      emittedFrameCount: 1,
      emittedByteCount: 2,
      lossEvidence: zeroLoss,
      sourcePcmSha256: "0".repeat(64)
    });
    assert.equal(rejection.type, "audio.error");
    assert.equal(rejection.code, "source_hash_mismatch");
    await closePromise;

    assert.equal(harness.pipelineCalls(), 0);
    assert.equal(harness.store.getSession(session.id).status, "error");
    assert.equal(
      harness.store.getSession(session.id).events.at(-1).code,
      "ordered_pcm_source_hash_mismatch"
    );
  } finally {
    await harness.close();
  }
});

async function createHarness(options = {}) {
  const spoolRoot = await mkdtemp(path.join(tmpdir(), "jiko-ws-test-"));
  const store = new SessionStore();
  const bus = new EventBus();
  const attemptDeadlines = new AttemptDeadlineRegistry(2_000);
  const attemptWork = new AttemptWorkRegistry();
  const outputs = new OutputScheduler();
  const receipts = options.receipts ?? new ReceiptWriter(false);
  const audioAdmission = options.audioAdmission ?? new AudioResourceAdmission({
    maxIngressBytes: 32 * 1024 * 1024,
    maxPipelineBytes: 32 * 1024 * 1024,
    maxPipelines: 2
  });
  let pipelineCallCount = 0;
  const pipelineRunner = options.pipelineRunner ?? (async (input) => {
    pipelineCallCount += 1;
    return fakeAudioPipelineResult(input.sessionId);
  });
  const wrappedPipelineRunner = async (input) => {
    if (options.pipelineRunner) {
      pipelineCallCount += 1;
    }
    return pipelineRunner(input);
  };
  const dependencies = {
    audioAdmission,
    attemptDeadlines,
    attemptWork,
    bus,
    outputs,
    pipelineRunner: wrappedPipelineRunner,
    receipts,
    store
  };
  const server = http.createServer(createRequestHandler(dependencies));
  const orderedPcm = attachOrderedPcmWebSocketServer(server, dependencies, {
    allowedOrigins: [testOrigin],
    captureTimeoutMs: options.captureTimeoutMs ?? 30_000,
    startTimeoutMs: options.startTimeoutMs ?? 30_000,
    maxConnections: options.maxConnections ?? 8,
    maxChunks: 32,
    maxSpoolBytes: options.maxSpoolBytes ?? 1_024,
    maxWalBytes: 32 * 1_024,
    spoolRoot,
    streamingStt: options.streamingStt
  });
  const baseUrl = await listen(server);

  return {
    spoolRoot,
    audioAdmission,
    store,
    pipelineCalls: () => pipelineCallCount,
    async createSession(sessionId) {
      const response = await fetch(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, source: "browser" })
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      return body.session;
    },
    connect(
      sessionId,
      origin = testOrigin,
      protocol = ORDERED_PCM_WS_SUBPROTOCOL
    ) {
      return openWebSocket(
        `${baseUrl.replace("http://", "ws://")}/sessions/${sessionId}/audio-stream`,
        origin,
        protocol
      );
    },
    rawUpgrade(requestTarget) {
      return sendRawUpgrade(baseUrl, requestTarget);
    },
    postInputEvent(sessionId, body) {
      return fetch(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/input-event`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        }
      );
    },
    async close() {
      await orderedPcm.close();
      outputs.close(new Error("test complete"));
      attemptDeadlines.close(new Error("test complete"));
      attemptWork.close(new Error("test complete"));
      await closeServer(server);
      await rm(spoolRoot, { force: true, recursive: true });
    }
  };
}

async function sendRawUpgrade(baseUrl, requestTarget) {
  const url = new URL(baseUrl);
  const socket = net.createConnection({
    host: url.hostname,
    port: Number(url.port)
  });
  await once(socket, "connect");
  socket.end(
    `GET ${requestTarget} HTTP/1.1\r\n` +
    `Host: ${url.host}\r\n` +
    "Connection: Upgrade\r\n" +
    "Upgrade: websocket\r\n" +
    `Origin: ${testOrigin}\r\n` +
    "Sec-WebSocket-Version: 13\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
    `Sec-WebSocket-Protocol: ${ORDERED_PCM_WS_SUBPROTOCOL}\r\n` +
    "\r\n"
  );
  let response = "";
  for await (const chunk of socket) {
    response += chunk.toString("utf8");
  }
  return response;
}

function orderedPcmIdentity(session) {
  return {
    sessionId: session.id,
    attemptId: session.attemptId,
    sourceId: "browser-worklet-test",
    audioProfileHash: sha256(
      new TextEncoder().encode(canonicalizeOrderedPcmProfile(profile))
    )
  };
}

function startMessage(identity) {
  return {
    ...identity,
    protocolVersion: "ordered_pcm_v1",
    type: "audio.start",
    sourceMonotonicMs: 1_000,
    pcmProfile: profile
  };
}

async function sendAndReceive(client, message) {
  const nextMessage = once(client, "message", {
    signal: AbortSignal.timeout(testMessageTimeoutMs)
  });
  client.send(encodeOrderedPcmBinaryEnvelope(message));
  const [raw, isBinary] = await nextMessage;
  assert.equal(isBinary, false);
  return OrderedPcmOutboundMessageSchema.parse(
    JSON.parse(raw.toString("utf8"))
  );
}

function rawOrderedPcmEnvelope(kind, metadata, payload = new Uint8Array(0)) {
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const envelope = new Uint8Array(
    ORDERED_PCM_BINARY_FIXED_HEADER_BYTES +
      metadataBytes.byteLength +
      payload.byteLength
  );
  envelope.set([0x4a, 0x50, 0x43, 0x4d], 0);
  envelope[4] = ORDERED_PCM_BINARY_ENVELOPE_VERSION;
  envelope[5] = kind;
  new DataView(envelope.buffer).setUint32(6, metadataBytes.byteLength, false);
  envelope.set(metadataBytes, ORDERED_PCM_BINARY_FIXED_HEADER_BYTES);
  envelope.set(
    payload,
    ORDERED_PCM_BINARY_FIXED_HEADER_BYTES + metadataBytes.byteLength
  );
  return envelope;
}

async function openWebSocket(url, origin, protocol) {
  const client = new WebSocket(url, protocol, {
    origin
  });
  await once(client, "open");
  return client;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}

function fakeAudioPipelineResult(sessionId) {
  const features = {
    durationMs: 1,
    speechMs: 1,
    silenceMs: 0,
    pauseCount: 0,
    longestPauseMs: 0,
    rmsMean: 0.1,
    rmsStd: 0,
    rmsPeak: 0.1
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
      byteSize: 52,
      durationMs: 1
    },
    normalizedAudio: {
      mediaType: "audio/wav",
      sampleRateHz: 16_000,
      channelCount: 1,
      durationMs: 1,
      latencyMs: 1
    },
    pipeline: {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      totalLatencyMs: 1,
      stages: [{
        stage: "total",
        status: "ready",
        latencyMs: 1,
        provider: "test:pipeline"
      }]
    },
    sttProviderReceipt: {
      id: "test:stt",
      latencyMs: 1,
      remote: false,
      outcome: "completed"
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

async function waitForCondition(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true before timeout");
}
