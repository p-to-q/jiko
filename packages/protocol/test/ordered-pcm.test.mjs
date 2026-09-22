import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ORDERED_PCM_BINARY_METADATA_BYTES,
  MAX_ORDERED_PCM_CHUNK_BYTES,
  ORDERED_PCM_BINARY_ENVELOPE_VERSION,
  ORDERED_PCM_BINARY_FIXED_HEADER_BYTES,
  ORDERED_PCM_PROTOCOL_VERSION,
  OrderedPcmAckSchema,
  OrderedPcmBinaryEnvelopeError,
  OrderedPcmChunkSchema,
  OrderedPcmErrorSchema,
  OrderedPcmIngressReceiptSchema,
  OrderedPcmStartSchema,
  applyOrderedPcmIngressMessage,
  canonicalizeOrderedPcmProfile,
  createOrderedPcmIngressState,
  decodeOrderedPcmBinaryEnvelope,
  encodeOrderedPcmBinaryEnvelope,
  orderedPcmIngressReceiptFromState
} from "../dist/index.js";

const profile = {
  sampleFormat: "s16le",
  sampleRateHz: 16_000,
  channelCount: 1
};
const audioProfileHash = "a".repeat(64);
const noLoss = {
  captureGapCount: 0,
  droppedFrameCount: 0,
  droppedByteCount: 0,
  overflowCount: 0
};

function start(overrides = {}) {
  return {
    protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
    type: "audio.start",
    sessionId: "session-1",
    attemptId: "attempt-1",
    sourceId: "source-1",
    audioProfileHash,
    sourceMonotonicMs: 100.25,
    pcmProfile: profile,
    ...overrides
  };
}

function chunk(sequence, overrides = {}) {
  const frameCount = overrides.frameCount ?? 320;
  const pcmBytes = overrides.pcmBytes ?? new Uint8Array(frameCount * 2);
  return {
    protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
    type: "audio.chunk",
    sessionId: "session-1",
    attemptId: "attempt-1",
    sourceId: "source-1",
    audioProfileHash,
    sequence,
    sourceMonotonicMs: 100.25 + sequence * 20,
    frameCount,
    byteCount: pcmBytes.byteLength,
    lossEvidence: noLoss,
    pcmBytes,
    ...overrides
  };
}

function stop(finalSequence, emittedFrameCount, overrides = {}) {
  return {
    protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
    type: "audio.stop",
    sessionId: "session-1",
    attemptId: "attempt-1",
    sourceId: "source-1",
    audioProfileHash,
    sourceMonotonicMs: 200,
    finalSequence,
    emittedFrameCount,
    emittedByteCount: emittedFrameCount * 2,
    lossEvidence: noLoss,
    ...overrides
  };
}

function accepted(state, message) {
  const transition = applyOrderedPcmIngressMessage(state, message);
  assert.equal(
    transition.accepted,
    true,
    transition.accepted ? undefined : `${transition.code}: ${transition.message}`
  );
  return transition.state;
}

function assertEnvelopeError(action, expectedCode) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof OrderedPcmBinaryEnvelopeError, true);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function rawEnvelope(kind, metadata, payload = new Uint8Array(0)) {
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

test("ordered PCM schemas are versioned, strict, and reject unsafe counters", () => {
  assert.equal(OrderedPcmStartSchema.safeParse(start()).success, true);
  assert.equal(
    OrderedPcmStartSchema.safeParse({ ...start(), device: "alsa" }).success,
    false
  );
  assert.equal(
    OrderedPcmStartSchema.safeParse({
      ...start(),
      pcmProfile: { ...profile, codec: "raw" }
    }).success,
    false
  );
  for (const sampleRateHz of [1, 8_000, 32_000, 96_000, 384_000]) {
    assert.equal(
      OrderedPcmStartSchema.safeParse({
        ...start(),
        pcmProfile: { ...profile, sampleRateHz }
      }).success,
      false,
      `unexpected sample rate ${sampleRateHz} should be rejected`
    );
  }
  for (const sampleRateHz of [16_000, 44_100, 48_000]) {
    assert.equal(
      OrderedPcmStartSchema.safeParse({
        ...start(),
        pcmProfile: { ...profile, sampleRateHz }
      }).success,
      true,
      `supported sample rate ${sampleRateHz} should be accepted`
    );
  }
  assert.equal(
    OrderedPcmStartSchema.safeParse({
      ...start(),
      pcmProfile: { ...profile, channelCount: 2 }
    }).success,
    false
  );
  assert.equal(
    OrderedPcmChunkSchema.safeParse({
      ...chunk(1),
      sequence: Number.MAX_SAFE_INTEGER + 1
    }).success,
    false
  );
  assert.equal(
    OrderedPcmChunkSchema.safeParse({ ...chunk(1), byteCount: 2 }).success,
    false
  );
  assert.equal(
    canonicalizeOrderedPcmProfile(profile),
    '{"channelCount":1,"sampleFormat":"s16le","sampleRateHz":16000}'
  );
});

test("happy path produces a payload-free ordered PCM receipt", () => {
  let state = createOrderedPcmIngressState();
  state = accepted(state, start());
  state = accepted(state, chunk(1));
  state = accepted(state, chunk(2));
  state = accepted(state, stop(2, 640));

  assert.equal(state.phase, "stopped");
  assert.equal(state.coverageComplete, true);
  assert.equal("pcmBytes" in state, false);

  const receipt = orderedPcmIngressReceiptFromState(state);
  assert.equal(receipt.receivedChunkCount, 2);
  assert.equal(receipt.receivedByteCount, 1_280);
  assert.equal(receipt.coverageComplete, true);
  assert.equal("pcmBytes" in receipt, false);
  assert.equal(
    OrderedPcmIngressReceiptSchema.safeParse({
      ...receipt,
      pcmBytes: new Uint8Array(1_280)
    }).success,
    false
  );
});

test("duplicate and out-of-order chunks are rejected without state mutation", () => {
  let state = accepted(createOrderedPcmIngressState(), start());
  state = accepted(state, chunk(1));
  state = accepted(state, chunk(2));

  const duplicate = applyOrderedPcmIngressMessage(state, chunk(2));
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.code, "duplicate_sequence");
  assert.equal(duplicate.state, state);

  const outOfOrder = applyOrderedPcmIngressMessage(state, chunk(1));
  assert.equal(outOfOrder.accepted, false);
  assert.equal(outOfOrder.code, "out_of_order_sequence");
  assert.equal(outOfOrder.state, state);
});

test("a sequence gap remains explicit and makes coverage incomplete", () => {
  let state = accepted(createOrderedPcmIngressState(), start());
  state = accepted(state, chunk(1));
  state = accepted(state, chunk(3));

  assert.equal(state.phase, "open");
  assert.equal(state.sequenceGapCount, 1);
  assert.equal(state.missingChunkCount, 1);
  assert.equal(state.coverageComplete, false);

  state = accepted(state, stop(3, 960));
  const receipt = orderedPcmIngressReceiptFromState(state);
  assert.equal(receipt.receivedFrameCount, 640);
  assert.equal(receipt.emittedFrameCount, 960);
  assert.equal(receipt.missingChunkCount, 1);
  assert.equal(receipt.coverageComplete, false);
  assert.equal(
    OrderedPcmIngressReceiptSchema.safeParse({
      ...receipt,
      coverageComplete: true
    }).success,
    false
  );
});

test("drop and overflow evidence is cumulative and prevents complete coverage", () => {
  let state = accepted(createOrderedPcmIngressState(), start());
  state = accepted(
    state,
    chunk(1, {
      lossEvidence: {
        captureGapCount: 1,
        droppedFrameCount: 160,
        droppedByteCount: 320,
        overflowCount: 1
      }
    })
  );
  assert.equal(state.coverageComplete, false);

  const regression = applyOrderedPcmIngressMessage(state, chunk(2));
  assert.equal(regression.accepted, false);
  assert.equal(regression.code, "loss_evidence_regression");
});

test("stop-before-start and profile mismatch are rejected", () => {
  const stopBeforeStart = applyOrderedPcmIngressMessage(
    createOrderedPcmIngressState(),
    stop(0, 0)
  );
  assert.equal(stopBeforeStart.accepted, false);
  assert.equal(stopBeforeStart.code, "stop_before_start");

  const open = accepted(createOrderedPcmIngressState(), start());
  const profileMismatch = applyOrderedPcmIngressMessage(
    open,
    chunk(1, { audioProfileHash: "b".repeat(64) })
  );
  assert.equal(profileMismatch.accepted, false);
  assert.equal(profileMismatch.code, "profile_mismatch");
});

test("messages arriving after an accepted stop are rejected as late", () => {
  let state = accepted(createOrderedPcmIngressState(), start());
  state = accepted(state, chunk(1));
  state = accepted(state, stop(1, 320));

  const late = applyOrderedPcmIngressMessage(state, chunk(2));
  assert.equal(late.accepted, false);
  assert.equal(late.code, "late_after_stop");
  assert.equal(late.state, state);
});

test("binary envelopes round-trip start, PCM chunk, and stop messages", () => {
  const messages = [
    start(),
    chunk(1, {
      frameCount: 4,
      pcmBytes: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7)
    }),
    stop(1, 4)
  ];

  for (const message of messages) {
    const encoded = encodeOrderedPcmBinaryEnvelope(message);
    assert.equal(encoded instanceof Uint8Array, true);
    assert.deepEqual([...encoded.subarray(0, 4)], [0x4a, 0x50, 0x43, 0x4d]);
    assert.equal(encoded[4], ORDERED_PCM_BINARY_ENVELOPE_VERSION);
    assert.ok(
      new DataView(
        encoded.buffer,
        encoded.byteOffset,
        encoded.byteLength
      ).getUint32(6, false) > 0
    );

    const padded = new Uint8Array(encoded.byteLength + 8);
    padded.set(encoded, 4);
    const decoded = decodeOrderedPcmBinaryEnvelope(
      padded.subarray(4, 4 + encoded.byteLength)
    );
    assert.deepEqual(decoded, message);
    if (decoded.type === "audio.chunk") {
      assert.equal(decoded.pcmBytes instanceof Uint8Array, true);
    }
  }
});

test("binary envelope decoder rejects non-Uint8Array and truncated data", () => {
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(new ArrayBuffer(10)),
    "invalid_input"
  );
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(new Uint8Array(9)),
    "truncated_envelope"
  );

  const encodedStart = encodeOrderedPcmBinaryEnvelope(start());
  assertEnvelopeError(
    () =>
      decodeOrderedPcmBinaryEnvelope(
        encodedStart.subarray(0, encodedStart.byteLength - 1)
      ),
    "truncated_envelope"
  );

  const encodedChunk = encodeOrderedPcmBinaryEnvelope(
    chunk(1, { frameCount: 2, pcmBytes: Uint8Array.of(1, 2, 3, 4) })
  );
  assertEnvelopeError(
    () =>
      decodeOrderedPcmBinaryEnvelope(
        encodedChunk.subarray(0, encodedChunk.byteLength - 1)
      ),
    "truncated_envelope"
  );
});

test("binary envelope decoder rejects invalid magic, version, and kind", () => {
  const encoded = encodeOrderedPcmBinaryEnvelope(start());

  const invalidMagic = encoded.slice();
  invalidMagic[0] = 0;
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(invalidMagic),
    "invalid_magic"
  );

  const invalidVersion = encoded.slice();
  invalidVersion[4] = ORDERED_PCM_BINARY_ENVELOPE_VERSION + 1;
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(invalidVersion),
    "unsupported_version"
  );

  const invalidKind = encoded.slice();
  invalidKind[5] = 255;
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(invalidKind),
    "unknown_kind"
  );
});

test("binary envelope decoder enforces metadata and payload limits", () => {
  const oversizedHeader = encodeOrderedPcmBinaryEnvelope(start()).slice();
  new DataView(
    oversizedHeader.buffer,
    oversizedHeader.byteOffset,
    oversizedHeader.byteLength
  ).setUint32(6, MAX_ORDERED_PCM_BINARY_METADATA_BYTES + 1, false);
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(oversizedHeader),
    "header_too_large"
  );

  const encodedChunk = encodeOrderedPcmBinaryEnvelope(
    chunk(1, { frameCount: 2, pcmBytes: Uint8Array.of(1, 2, 3, 4) })
  );
  const oversizedPayload = new Uint8Array(
    encodedChunk.byteLength + MAX_ORDERED_PCM_CHUNK_BYTES
  );
  oversizedPayload.set(encodedChunk);
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(oversizedPayload),
    "payload_too_large"
  );
});

test("binary envelope kind, metadata, and payload remain mutually consistent", () => {
  const startWithPayload = rawEnvelope(1, start(), Uint8Array.of(1, 2));
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(startWithPayload),
    "unexpected_payload"
  );

  const mismatchedKind = encodeOrderedPcmBinaryEnvelope(start()).slice();
  mismatchedKind[5] = 3;
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(mismatchedKind),
    "kind_mismatch"
  );

  const { pcmBytes: omittedPcmBytes, ...chunkMetadata } = chunk(1, {
    frameCount: 2,
    pcmBytes: Uint8Array.of(1, 2, 3, 4)
  });
  assert.equal(omittedPcmBytes.byteLength, 4);
  const metadataWithPcmBytes = rawEnvelope(
    2,
    { ...chunkMetadata, pcmBytes: [1, 2, 3, 4] },
    Uint8Array.of(1, 2, 3, 4)
  );
  assertEnvelopeError(
    () => decodeOrderedPcmBinaryEnvelope(metadataWithPcmBytes),
    "invalid_header"
  );
});

test("audio acknowledgements express cumulative spool and finalize commits", () => {
  const identity = {
    sessionId: "session-1",
    attemptId: "attempt-1",
    sourceId: "source-1",
    audioProfileHash
  };
  const startAck = {
    protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
    type: "audio.ack",
    ...identity,
    acknowledgedType: "audio.start",
    acknowledgedSequence: 0,
    commitState: "spooled"
  };
  const chunkAck = {
    ...startAck,
    acknowledgedType: "audio.chunk",
    acknowledgedSequence: 3
  };
  assert.equal(OrderedPcmAckSchema.safeParse(startAck).success, true);
  assert.equal(OrderedPcmAckSchema.safeParse(chunkAck).success, true);
  assert.equal(
    OrderedPcmAckSchema.safeParse({ ...chunkAck, commitState: "finalized" })
      .success,
    false
  );
  assert.equal(
    OrderedPcmAckSchema.safeParse({ ...startAck, acknowledgedSequence: 1 })
      .success,
    false
  );

  let state = accepted(createOrderedPcmIngressState(), start());
  state = accepted(state, chunk(1));
  state = accepted(state, stop(1, 320));
  const stopAck = {
    ...startAck,
    acknowledgedType: "audio.stop",
    acknowledgedSequence: 1,
    commitState: "finalized",
    receipt: orderedPcmIngressReceiptFromState(state)
  };
  assert.equal(OrderedPcmAckSchema.safeParse(stopAck).success, true);
  assert.equal(
    OrderedPcmAckSchema.safeParse({
      ...stopAck,
      acknowledgedSequence: 2
    }).success,
    false
  );
});

test("audio errors allow wire failures without identity and strict identified failures", () => {
  const wireError = {
    protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
    type: "audio.error",
    code: "wire_error",
    message: "Malformed envelope",
    recoverable: false
  };
  assert.equal(OrderedPcmErrorSchema.safeParse(wireError).success, true);

  for (const code of [
    "profile_hash_mismatch",
    "source_hash_mismatch",
    "coverage_incomplete",
    "transport_closed",
    "capture_timeout"
  ]) {
    assert.equal(
      OrderedPcmErrorSchema.safeParse({ ...wireError, code }).success,
      true,
      code
    );
  }

  const identifiedError = {
    ...wireError,
    code: "duplicate_sequence",
    recoverable: true,
    sessionId: "session-1",
    attemptId: "attempt-1",
    sourceId: "source-1",
    audioProfileHash,
    rejectedType: "audio.chunk",
    rejectedSequence: 2
  };
  assert.equal(OrderedPcmErrorSchema.safeParse(identifiedError).success, true);
  assert.equal(
    OrderedPcmErrorSchema.safeParse({ ...wireError, sessionId: "session-1" })
      .success,
    false
  );
  assert.equal(
    OrderedPcmErrorSchema.safeParse({ ...identifiedError, debug: true }).success,
    false
  );
});
