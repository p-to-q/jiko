import { z } from "zod";

export const ORDERED_PCM_PROTOCOL_VERSION = "ordered_pcm_v1" as const;
export const ORDERED_PCM_RECEIPT_VERSION = "ordered_pcm_receipt_v1" as const;
export const ORDERED_PCM_BINARY_ENVELOPE_MAGIC = "JPCM" as const;
export const ORDERED_PCM_BINARY_ENVELOPE_VERSION = 1 as const;
export const ORDERED_PCM_BINARY_FIXED_HEADER_BYTES = 10;
export const MAX_ORDERED_PCM_BINARY_METADATA_BYTES = 16_384;

// This is a transport guard, not a recommended aggregation size. Current
// experiments target much smaller chunks; the cap prevents one message from
// becoming an unbounded allocation at a runtime boundary.
export const MAX_ORDERED_PCM_CHUNK_BYTES = 1_048_576;
export const SUPPORTED_ORDERED_PCM_SAMPLE_RATES_HZ = [
  16_000,
  44_100,
  48_000
] as const;

const SafeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const SafePositiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const SourceMonotonicMsSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const OrderedPcmIdentifierSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9._:-]+$/)
  .refine((value) => value !== "." && value !== "..", {
    message: "dot-only path segments are not valid identifiers"
  });

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const OrderedPcmProfileSchema = z
  .object({
    sampleFormat: z.literal("s16le"),
    // The current capture edges emit mono PCM at the native browser rate or
    // the 16 kHz hardware/STT rate. Keeping this an explicit allowlist avoids
    // treating an attacker-declared 1 Hz stream as hours of audio in ffmpeg.
    sampleRateHz: z.union([
      z.literal(16_000),
      z.literal(44_100),
      z.literal(48_000)
    ]),
    channelCount: z.literal(1)
  })
  .strict();
export type OrderedPcmProfile = z.infer<typeof OrderedPcmProfileSchema>;

/**
 * Canonical UTF-8 input for `audioProfileHash` (SHA-256, lowercase hex).
 * Hashing stays at the runtime edge so this shared contract has no Node or
 * browser crypto dependency.
 */
export function canonicalizeOrderedPcmProfile(input: unknown): string {
  const profile = OrderedPcmProfileSchema.parse(input);
  return JSON.stringify({
    channelCount: profile.channelCount,
    sampleFormat: profile.sampleFormat,
    sampleRateHz: profile.sampleRateHz
  });
}

export const OrderedPcmLossEvidenceSchema = z
  .object({
    captureGapCount: SafeNonNegativeIntegerSchema,
    droppedFrameCount: SafeNonNegativeIntegerSchema,
    droppedByteCount: SafeNonNegativeIntegerSchema,
    overflowCount: SafeNonNegativeIntegerSchema
  })
  .strict();
export type OrderedPcmLossEvidence = z.infer<
  typeof OrderedPcmLossEvidenceSchema
>;

const OrderedPcmIdentityShape = {
  sessionId: OrderedPcmIdentifierSchema,
  attemptId: OrderedPcmIdentifierSchema,
  sourceId: OrderedPcmIdentifierSchema,
  audioProfileHash: Sha256Schema
};

export const OrderedPcmIdentitySchema = z
  .object(OrderedPcmIdentityShape)
  .strict();
export type OrderedPcmIdentity = z.infer<typeof OrderedPcmIdentitySchema>;

export const OrderedPcmIngressTypeSchema = z.enum([
  "audio.start",
  "audio.chunk",
  "audio.stop"
]);
export type OrderedPcmIngressType = z.infer<
  typeof OrderedPcmIngressTypeSchema
>;

export const OrderedPcmStartSchema = z
  .object({
    protocolVersion: z.literal(ORDERED_PCM_PROTOCOL_VERSION),
    type: z.literal("audio.start"),
    ...OrderedPcmIdentityShape,
    sourceMonotonicMs: SourceMonotonicMsSchema,
    pcmProfile: OrderedPcmProfileSchema
  })
  .strict();
export type OrderedPcmStart = z.infer<typeof OrderedPcmStartSchema>;

const PcmBytesSchema = z
  .instanceof(Uint8Array)
  .refine((value) => value.byteLength > 0, "PCM chunks must not be empty")
  .refine(
    (value) => value.byteLength <= MAX_ORDERED_PCM_CHUNK_BYTES,
    `PCM chunks must not exceed ${MAX_ORDERED_PCM_CHUNK_BYTES} bytes`
  );

export const OrderedPcmChunkSchema = z
  .object({
    protocolVersion: z.literal(ORDERED_PCM_PROTOCOL_VERSION),
    type: z.literal("audio.chunk"),
    ...OrderedPcmIdentityShape,
    sequence: SafePositiveIntegerSchema,
    sourceMonotonicMs: SourceMonotonicMsSchema,
    frameCount: SafePositiveIntegerSchema.max(
      MAX_ORDERED_PCM_CHUNK_BYTES / 2
    ),
    byteCount: SafePositiveIntegerSchema.max(MAX_ORDERED_PCM_CHUNK_BYTES),
    lossEvidence: OrderedPcmLossEvidenceSchema,
    pcmBytes: PcmBytesSchema
  })
  .strict()
  .superRefine((message, context) => {
    if (message.byteCount !== message.pcmBytes.byteLength) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "byteCount must equal the PCM payload byte length",
        path: ["byteCount"]
      });
    }
  });
export type OrderedPcmChunk = z.infer<typeof OrderedPcmChunkSchema>;

export const OrderedPcmStopSchema = z
  .object({
    protocolVersion: z.literal(ORDERED_PCM_PROTOCOL_VERSION),
    type: z.literal("audio.stop"),
    ...OrderedPcmIdentityShape,
    sourceMonotonicMs: SourceMonotonicMsSchema,
    finalSequence: SafeNonNegativeIntegerSchema,
    emittedFrameCount: SafeNonNegativeIntegerSchema,
    emittedByteCount: SafeNonNegativeIntegerSchema,
    lossEvidence: OrderedPcmLossEvidenceSchema,
    sourcePcmSha256: Sha256Schema.optional()
  })
  .strict();
export type OrderedPcmStop = z.infer<typeof OrderedPcmStopSchema>;

export const OrderedPcmIngressMessageSchema = z.union([
  OrderedPcmStartSchema,
  OrderedPcmChunkSchema,
  OrderedPcmStopSchema
]);
export type OrderedPcmIngressMessage = z.infer<
  typeof OrderedPcmIngressMessageSchema
>;

export const OrderedPcmBinaryEnvelopeErrorCodeSchema = z.enum([
  "invalid_input",
  "truncated_envelope",
  "invalid_magic",
  "unsupported_version",
  "unknown_kind",
  "header_too_large",
  "payload_too_large",
  "invalid_header",
  "kind_mismatch",
  "unexpected_payload"
]);
export type OrderedPcmBinaryEnvelopeErrorCode = z.infer<
  typeof OrderedPcmBinaryEnvelopeErrorCodeSchema
>;

export class OrderedPcmBinaryEnvelopeError extends Error {
  readonly code: OrderedPcmBinaryEnvelopeErrorCode;

  constructor(code: OrderedPcmBinaryEnvelopeErrorCode, message: string) {
    super(message);
    this.name = "OrderedPcmBinaryEnvelopeError";
    this.code = code;
  }
}

/**
 * Wire layout (network byte order):
 *
 * - bytes 0..3: ASCII magic `JPCM`
 * - byte 4: binary envelope version
 * - byte 5: message kind (1=start, 2=chunk, 3=stop)
 * - bytes 6..9: UTF-8 JSON metadata byte length (uint32)
 * - remaining bytes: metadata followed by raw PCM for `audio.chunk` only
 */
export function encodeOrderedPcmBinaryEnvelope(
  input: unknown
): Uint8Array {
  const message = OrderedPcmIngressMessageSchema.parse(input);
  const kind = orderedPcmKindFromType(message.type);
  let metadata: Omit<OrderedPcmChunk, "pcmBytes"> | OrderedPcmStart | OrderedPcmStop;
  let payload = EMPTY_PCM_BYTES;

  if (message.type === "audio.chunk") {
    const { pcmBytes, ...chunkMetadata } = message;
    metadata = chunkMetadata;
    payload = pcmBytes;
  } else {
    metadata = message;
  }

  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  if (metadataBytes.byteLength === 0) {
    throw new OrderedPcmBinaryEnvelopeError(
      "invalid_header",
      "Ordered PCM metadata must not be empty"
    );
  }
  if (metadataBytes.byteLength > MAX_ORDERED_PCM_BINARY_METADATA_BYTES) {
    throw new OrderedPcmBinaryEnvelopeError(
      "header_too_large",
      `Ordered PCM metadata exceeds ${MAX_ORDERED_PCM_BINARY_METADATA_BYTES} bytes`
    );
  }
  if (payload.byteLength > MAX_ORDERED_PCM_CHUNK_BYTES) {
    throw new OrderedPcmBinaryEnvelopeError(
      "payload_too_large",
      `Ordered PCM payload exceeds ${MAX_ORDERED_PCM_CHUNK_BYTES} bytes`
    );
  }

  const envelope = new Uint8Array(
    ORDERED_PCM_BINARY_FIXED_HEADER_BYTES +
      metadataBytes.byteLength +
      payload.byteLength
  );
  envelope.set(ORDERED_PCM_BINARY_MAGIC_BYTES, 0);
  envelope[4] = ORDERED_PCM_BINARY_ENVELOPE_VERSION;
  envelope[5] = kind;
  new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).setUint32(
    6,
    metadataBytes.byteLength,
    false
  );
  envelope.set(metadataBytes, ORDERED_PCM_BINARY_FIXED_HEADER_BYTES);
  envelope.set(
    payload,
    ORDERED_PCM_BINARY_FIXED_HEADER_BYTES + metadataBytes.byteLength
  );
  return envelope;
}

export function decodeOrderedPcmBinaryEnvelope(
  input: Uint8Array
): OrderedPcmIngressMessage {
  if (!(input instanceof Uint8Array)) {
    throw new OrderedPcmBinaryEnvelopeError(
      "invalid_input",
      "Ordered PCM binary envelopes must be Uint8Array values"
    );
  }
  if (input.byteLength < ORDERED_PCM_BINARY_FIXED_HEADER_BYTES) {
    throw new OrderedPcmBinaryEnvelopeError(
      "truncated_envelope",
      "Ordered PCM envelope is shorter than its fixed header"
    );
  }
  for (let index = 0; index < ORDERED_PCM_BINARY_MAGIC_BYTES.byteLength; index += 1) {
    if (input[index] !== ORDERED_PCM_BINARY_MAGIC_BYTES[index]) {
      throw new OrderedPcmBinaryEnvelopeError(
        "invalid_magic",
        "Ordered PCM envelope magic is invalid"
      );
    }
  }
  if (input[4] !== ORDERED_PCM_BINARY_ENVELOPE_VERSION) {
    throw new OrderedPcmBinaryEnvelopeError(
      "unsupported_version",
      `Unsupported ordered PCM binary envelope version ${input[4]}`
    );
  }

  const expectedType = orderedPcmTypeFromKind(input[5]);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const metadataByteLength = view.getUint32(6, false);
  if (metadataByteLength === 0) {
    throw new OrderedPcmBinaryEnvelopeError(
      "invalid_header",
      "Ordered PCM metadata must not be empty"
    );
  }
  if (metadataByteLength > MAX_ORDERED_PCM_BINARY_METADATA_BYTES) {
    throw new OrderedPcmBinaryEnvelopeError(
      "header_too_large",
      `Ordered PCM metadata exceeds ${MAX_ORDERED_PCM_BINARY_METADATA_BYTES} bytes`
    );
  }

  const metadataEnd =
    ORDERED_PCM_BINARY_FIXED_HEADER_BYTES + metadataByteLength;
  if (metadataEnd > input.byteLength) {
    throw new OrderedPcmBinaryEnvelopeError(
      "truncated_envelope",
      "Ordered PCM envelope ended inside its metadata"
    );
  }
  const payloadByteLength = input.byteLength - metadataEnd;
  if (payloadByteLength > MAX_ORDERED_PCM_CHUNK_BYTES) {
    throw new OrderedPcmBinaryEnvelopeError(
      "payload_too_large",
      `Ordered PCM payload exceeds ${MAX_ORDERED_PCM_CHUNK_BYTES} bytes`
    );
  }
  if (expectedType !== "audio.chunk" && payloadByteLength !== 0) {
    throw new OrderedPcmBinaryEnvelopeError(
      "unexpected_payload",
      `${expectedType} must not carry a PCM payload`
    );
  }

  let metadata: unknown;
  try {
    const metadataJson = new TextDecoder("utf-8", { fatal: true }).decode(
      input.subarray(ORDERED_PCM_BINARY_FIXED_HEADER_BYTES, metadataEnd)
    );
    metadata = JSON.parse(metadataJson);
  } catch {
    throw new OrderedPcmBinaryEnvelopeError(
      "invalid_header",
      "Ordered PCM metadata must be valid UTF-8 JSON"
    );
  }
  if (!isRecord(metadata) || typeof metadata.type !== "string") {
    throw new OrderedPcmBinaryEnvelopeError(
      "invalid_header",
      "Ordered PCM metadata must contain a message type"
    );
  }
  if (metadata.type !== expectedType) {
    throw new OrderedPcmBinaryEnvelopeError(
      "kind_mismatch",
      `Envelope kind ${expectedType} does not match metadata type ${metadata.type}`
    );
  }

  if (expectedType === "audio.chunk") {
    if (Object.prototype.hasOwnProperty.call(metadata, "pcmBytes")) {
      throw new OrderedPcmBinaryEnvelopeError(
        "invalid_header",
        "audio.chunk metadata must not contain pcmBytes"
      );
    }
    if (
      typeof metadata.byteCount === "number" &&
      Number.isSafeInteger(metadata.byteCount) &&
      metadata.byteCount >= 0 &&
      payloadByteLength < metadata.byteCount
    ) {
      throw new OrderedPcmBinaryEnvelopeError(
        "truncated_envelope",
        "Ordered PCM envelope ended inside its declared PCM payload"
      );
    }

    const pcmBytes = new Uint8Array(payloadByteLength);
    pcmBytes.set(input.subarray(metadataEnd));
    return parseDecodedOrderedPcmMessage(OrderedPcmChunkSchema, {
      ...metadata,
      pcmBytes
    });
  }

  return expectedType === "audio.start"
    ? parseDecodedOrderedPcmMessage(OrderedPcmStartSchema, metadata)
    : parseDecodedOrderedPcmMessage(OrderedPcmStopSchema, metadata);
}

export const OrderedPcmIngressReceiptSchema = z
  .object({
    schemaVersion: z.literal(ORDERED_PCM_RECEIPT_VERSION),
    protocolVersion: z.literal(ORDERED_PCM_PROTOCOL_VERSION),
    sessionId: OrderedPcmIdentifierSchema,
    attemptId: OrderedPcmIdentifierSchema,
    sourceId: OrderedPcmIdentifierSchema,
    audioProfileHash: Sha256Schema,
    pcmProfile: OrderedPcmProfileSchema,
    sourceStartedMonotonicMs: SourceMonotonicMsSchema,
    sourceStoppedMonotonicMs: SourceMonotonicMsSchema,
    finalSequence: SafeNonNegativeIntegerSchema,
    receivedChunkCount: SafeNonNegativeIntegerSchema,
    receivedFrameCount: SafeNonNegativeIntegerSchema,
    receivedByteCount: SafeNonNegativeIntegerSchema,
    emittedFrameCount: SafeNonNegativeIntegerSchema,
    emittedByteCount: SafeNonNegativeIntegerSchema,
    sequenceGapCount: SafeNonNegativeIntegerSchema,
    missingChunkCount: SafeNonNegativeIntegerSchema,
    lossEvidence: OrderedPcmLossEvidenceSchema,
    coverageComplete: z.boolean(),
    sourcePcmSha256: Sha256Schema.optional()
  })
  .strict()
  .superRefine((receipt, context) => {
    const expectedReceivedBytes = pcmByteCount(
      receipt.receivedFrameCount,
      receipt.pcmProfile
    );
    const expectedEmittedBytes = pcmByteCount(
      receipt.emittedFrameCount,
      receipt.pcmProfile
    );
    const expectedDroppedBytes = pcmByteCount(
      receipt.lossEvidence.droppedFrameCount,
      receipt.pcmProfile
    );
    const sequenceAccountingMatches =
      receipt.finalSequence ===
      receipt.receivedChunkCount + receipt.missingChunkCount;
    const completeByEvidence =
      receipt.missingChunkCount === 0 &&
      receipt.sequenceGapCount === 0 &&
      hasNoLoss(receipt.lossEvidence);

    if (receipt.sourceStoppedMonotonicMs < receipt.sourceStartedMonotonicMs) {
      addReceiptIssue(
        context,
        "sourceStoppedMonotonicMs",
        "Receipt stop time must not precede start time"
      );
    }
    if (
      expectedReceivedBytes !== receipt.receivedByteCount ||
      expectedEmittedBytes !== receipt.emittedByteCount ||
      expectedDroppedBytes !== receipt.lossEvidence.droppedByteCount
    ) {
      addReceiptIssue(
        context,
        "receivedByteCount",
        "Receipt frame and byte counters must match the PCM profile"
      );
    }
    if (
      !sequenceAccountingMatches ||
      receipt.sequenceGapCount > receipt.missingChunkCount
    ) {
      addReceiptIssue(
        context,
        "missingChunkCount",
        "Receipt sequence totals contradict gap evidence"
      );
    }
    if (
      receipt.emittedFrameCount < receipt.receivedFrameCount ||
      receipt.emittedByteCount < receipt.receivedByteCount ||
      (receipt.missingChunkCount === 0 &&
        (receipt.emittedFrameCount !== receipt.receivedFrameCount ||
          receipt.emittedByteCount !== receipt.receivedByteCount)) ||
      (receipt.missingChunkCount > 0 &&
        (receipt.emittedFrameCount === receipt.receivedFrameCount ||
          receipt.emittedByteCount === receipt.receivedByteCount))
    ) {
      addReceiptIssue(
        context,
        "emittedFrameCount",
        "Receipt emitted totals contradict received and missing chunks"
      );
    }
    if (receipt.coverageComplete !== completeByEvidence) {
      addReceiptIssue(
        context,
        "coverageComplete",
        "Receipt coverage must match its gap, drop, and overflow evidence"
      );
    }
  });
export type OrderedPcmIngressReceipt = z.infer<
  typeof OrderedPcmIngressReceiptSchema
>;

export type OrderedPcmIngressIdleState = {
  phase: "idle";
};

export type OrderedPcmIngressOpenState = OrderedPcmIdentity & {
  phase: "open";
  protocolVersion: typeof ORDERED_PCM_PROTOCOL_VERSION;
  pcmProfile: OrderedPcmProfile;
  sourceStartedMonotonicMs: number;
  lastSourceMonotonicMs: number;
  lastSequence: number;
  receivedChunkCount: number;
  receivedFrameCount: number;
  receivedByteCount: number;
  sequenceGapCount: number;
  missingChunkCount: number;
  lossEvidence: OrderedPcmLossEvidence;
  coverageComplete: boolean;
};

export type OrderedPcmIngressStoppedState = Omit<
  OrderedPcmIngressOpenState,
  "phase"
> & {
  phase: "stopped";
  sourceStoppedMonotonicMs: number;
  finalSequence: number;
  emittedFrameCount: number;
  emittedByteCount: number;
  sourcePcmSha256?: string;
};

export type OrderedPcmIngressState =
  | OrderedPcmIngressIdleState
  | OrderedPcmIngressOpenState
  | OrderedPcmIngressStoppedState;

export const OrderedPcmIngressRejectionCodeSchema = z.enum([
  "invalid_message",
  "already_started",
  "chunk_before_start",
  "stop_before_start",
  "late_after_stop",
  "identity_mismatch",
  "profile_mismatch",
  "duplicate_sequence",
  "out_of_order_sequence",
  "timestamp_regression",
  "frame_byte_mismatch",
  "loss_evidence_mismatch",
  "loss_evidence_regression",
  "counter_overflow",
  "final_sequence_mismatch",
  "totals_mismatch"
]);
export type OrderedPcmIngressRejectionCode = z.infer<
  typeof OrderedPcmIngressRejectionCodeSchema
>;

export const OrderedPcmCommitStateSchema = z.enum(["spooled", "finalized"]);
export type OrderedPcmCommitState = z.infer<
  typeof OrderedPcmCommitStateSchema
>;

export const OrderedPcmAckSchema = z
  .object({
    protocolVersion: z.literal(ORDERED_PCM_PROTOCOL_VERSION),
    type: z.literal("audio.ack"),
    ...OrderedPcmIdentityShape,
    acknowledgedType: OrderedPcmIngressTypeSchema,
    acknowledgedSequence: SafeNonNegativeIntegerSchema,
    commitState: OrderedPcmCommitStateSchema,
    receipt: OrderedPcmIngressReceiptSchema.optional()
  })
  .strict()
  .superRefine((acknowledgement, context) => {
    if (
      acknowledgement.acknowledgedType === "audio.start" &&
      acknowledgement.acknowledgedSequence !== 0
    ) {
      addOutboundIssue(
        context,
        "acknowledgedSequence",
        "audio.start acknowledgement sequence must be zero"
      );
    }
    if (
      acknowledgement.acknowledgedType === "audio.chunk" &&
      acknowledgement.acknowledgedSequence === 0
    ) {
      addOutboundIssue(
        context,
        "acknowledgedSequence",
        "audio.chunk acknowledgement sequence must be positive"
      );
    }
    const expectedCommitState =
      acknowledgement.acknowledgedType === "audio.stop"
        ? "finalized"
        : "spooled";
    if (acknowledgement.commitState !== expectedCommitState) {
      addOutboundIssue(
        context,
        "commitState",
        `${acknowledgement.acknowledgedType} acknowledgement must be ${expectedCommitState}`
      );
    }
    if (
      acknowledgement.receipt &&
      acknowledgement.acknowledgedType !== "audio.stop"
    ) {
      addOutboundIssue(
        context,
        "receipt",
        "Only an audio.stop acknowledgement may include a receipt"
      );
    }
    if (acknowledgement.receipt) {
      const receipt = acknowledgement.receipt;
      const receiptMatchesAcknowledgement =
        receipt.sessionId === acknowledgement.sessionId &&
        receipt.attemptId === acknowledgement.attemptId &&
        receipt.sourceId === acknowledgement.sourceId &&
        receipt.audioProfileHash === acknowledgement.audioProfileHash &&
        receipt.finalSequence === acknowledgement.acknowledgedSequence;
      if (!receiptMatchesAcknowledgement) {
        addOutboundIssue(
          context,
          "receipt",
          "Receipt identity and final sequence must match the acknowledgement"
        );
      }
    }
  });
export type OrderedPcmAck = z.infer<typeof OrderedPcmAckSchema>;

export const OrderedPcmErrorCodeSchema = z.union([
  OrderedPcmIngressRejectionCodeSchema,
  z.enum([
    "wire_error",
    "session_not_found",
    "attempt_mismatch",
    "input_claim_conflict",
    "capacity_exceeded",
    "session_sealed",
    "profile_hash_mismatch",
    "source_hash_mismatch",
    "coverage_incomplete",
    "transport_closed",
    "capture_timeout",
    "internal_error"
  ])
]);
export type OrderedPcmErrorCode = z.infer<
  typeof OrderedPcmErrorCodeSchema
>;

export const OrderedPcmErrorSchema = z
  .object({
    protocolVersion: z.literal(ORDERED_PCM_PROTOCOL_VERSION),
    type: z.literal("audio.error"),
    code: OrderedPcmErrorCodeSchema,
    message: z.string().min(1).max(512),
    recoverable: z.boolean(),
    sessionId: OrderedPcmIdentifierSchema.optional(),
    attemptId: OrderedPcmIdentifierSchema.optional(),
    sourceId: OrderedPcmIdentifierSchema.optional(),
    audioProfileHash: Sha256Schema.optional(),
    rejectedType: OrderedPcmIngressTypeSchema.optional(),
    rejectedSequence: SafeNonNegativeIntegerSchema.optional()
  })
  .strict()
  .superRefine((error, context) => {
    const identityFieldCount = [
      error.sessionId,
      error.attemptId,
      error.sourceId,
      error.audioProfileHash
    ].filter((value) => value !== undefined).length;
    if (identityFieldCount !== 0 && identityFieldCount !== 4) {
      addOutboundIssue(
        context,
        "sessionId",
        "Error identity fields must be omitted or supplied together"
      );
    }
    if (error.rejectedSequence !== undefined && !error.rejectedType) {
      addOutboundIssue(
        context,
        "rejectedSequence",
        "rejectedSequence requires rejectedType"
      );
    }
    if (
      error.rejectedType === "audio.start" &&
      error.rejectedSequence !== undefined
    ) {
      addOutboundIssue(
        context,
        "rejectedSequence",
        "audio.start errors must not include rejectedSequence"
      );
    }
    if (
      error.rejectedType === "audio.chunk" &&
      error.rejectedSequence === 0
    ) {
      addOutboundIssue(
        context,
        "rejectedSequence",
        "audio.chunk rejectedSequence must be positive"
      );
    }
  });
export type OrderedPcmError = z.infer<typeof OrderedPcmErrorSchema>;

export const OrderedPcmOutboundMessageSchema = z.union([
  OrderedPcmAckSchema,
  OrderedPcmErrorSchema
]);
export type OrderedPcmOutboundMessage = z.infer<
  typeof OrderedPcmOutboundMessageSchema
>;

export type OrderedPcmIngressTransition =
  | {
      accepted: true;
      state: OrderedPcmIngressState;
    }
  | {
      accepted: false;
      state: OrderedPcmIngressState;
      code: OrderedPcmIngressRejectionCode;
      message: string;
    };

export function createOrderedPcmIngressState(): OrderedPcmIngressIdleState {
  return { phase: "idle" };
}

/**
 * Pure, framework-neutral ordering and coverage reducer. It deliberately does
 * not retain PCM payloads. A sequence gap is accepted but makes coverage
 * incomplete; duplicate/out-of-order input is rejected without mutating state.
 */
export function applyOrderedPcmIngressMessage(
  state: OrderedPcmIngressState,
  input: unknown
): OrderedPcmIngressTransition {
  const parsed = OrderedPcmIngressMessageSchema.safeParse(input);
  if (!parsed.success) {
    return rejected(
      state,
      "invalid_message",
      parsed.error.issues[0]?.message ?? "Invalid ordered PCM message"
    );
  }

  const message = parsed.data;
  if (state.phase === "stopped") {
    return rejected(
      state,
      "late_after_stop",
      `Cannot apply ${message.type} after audio.stop`
    );
  }

  if (message.type === "audio.start") {
    if (state.phase !== "idle") {
      return rejected(state, "already_started", "audio.start was already accepted");
    }

    return {
      accepted: true,
      state: {
        phase: "open",
        protocolVersion: message.protocolVersion,
        sessionId: message.sessionId,
        attemptId: message.attemptId,
        sourceId: message.sourceId,
        audioProfileHash: message.audioProfileHash,
        pcmProfile: message.pcmProfile,
        sourceStartedMonotonicMs: message.sourceMonotonicMs,
        lastSourceMonotonicMs: message.sourceMonotonicMs,
        lastSequence: 0,
        receivedChunkCount: 0,
        receivedFrameCount: 0,
        receivedByteCount: 0,
        sequenceGapCount: 0,
        missingChunkCount: 0,
        lossEvidence: emptyLossEvidence(),
        coverageComplete: true
      }
    };
  }

  if (state.phase === "idle") {
    return rejected(
      state,
      message.type === "audio.chunk"
        ? "chunk_before_start"
        : "stop_before_start",
      `${message.type} requires an accepted audio.start`
    );
  }

  const identityError = checkIdentity(state, message);
  if (identityError) {
    return identityError;
  }

  if (message.audioProfileHash !== state.audioProfileHash) {
    return rejected(
      state,
      "profile_mismatch",
      "audioProfileHash differs from audio.start"
    );
  }

  if (message.type === "audio.chunk") {
    if (message.sequence === state.lastSequence) {
      return rejected(
        state,
        "duplicate_sequence",
        `Chunk sequence ${message.sequence} was already accepted`
      );
    }
    if (message.sequence < state.lastSequence) {
      return rejected(
        state,
        "out_of_order_sequence",
        `Chunk sequence ${message.sequence} is older than ${state.lastSequence}`
      );
    }

    const evidenceError = checkTimestampAndLossEvidence(state, message);
    if (evidenceError) {
      return evidenceError;
    }

    const expectedBytes = pcmByteCount(
      message.frameCount,
      state.pcmProfile
    );
    if (expectedBytes === undefined || expectedBytes !== message.byteCount) {
      return rejected(
        state,
        "frame_byte_mismatch",
        "frameCount and byteCount do not match the PCM profile"
      );
    }

    const receivedChunkCount = safeAdd(state.receivedChunkCount, 1);
    const receivedFrameCount = safeAdd(
      state.receivedFrameCount,
      message.frameCount
    );
    const receivedByteCount = safeAdd(
      state.receivedByteCount,
      message.byteCount
    );
    if (
      receivedChunkCount === undefined ||
      receivedFrameCount === undefined ||
      receivedByteCount === undefined
    ) {
      return rejected(
        state,
        "counter_overflow",
        "Ordered PCM counters exceeded Number.MAX_SAFE_INTEGER"
      );
    }

    const missingChunkCountForMessage =
      message.sequence - state.lastSequence - 1;
    const missingChunkCount = safeAdd(
      state.missingChunkCount,
      missingChunkCountForMessage
    );
    const sequenceGapCount = safeAdd(
      state.sequenceGapCount,
      missingChunkCountForMessage > 0 ? 1 : 0
    );
    if (missingChunkCount === undefined || sequenceGapCount === undefined) {
      return rejected(
        state,
        "counter_overflow",
        "Ordered PCM gap counters exceeded Number.MAX_SAFE_INTEGER"
      );
    }

    const coverageComplete =
      state.coverageComplete &&
      missingChunkCountForMessage === 0 &&
      hasNoLoss(message.lossEvidence);

    return {
      accepted: true,
      state: {
        ...state,
        lastSourceMonotonicMs: message.sourceMonotonicMs,
        lastSequence: message.sequence,
        receivedChunkCount,
        receivedFrameCount,
        receivedByteCount,
        sequenceGapCount,
        missingChunkCount,
        lossEvidence: message.lossEvidence,
        coverageComplete
      }
    };
  }

  const evidenceError = checkTimestampAndLossEvidence(state, message);
  if (evidenceError) {
    return evidenceError;
  }

  if (message.finalSequence !== state.lastSequence) {
    return rejected(
      state,
      "final_sequence_mismatch",
      `finalSequence ${message.finalSequence} does not match ${state.lastSequence}`
    );
  }

  const expectedEmittedBytes = pcmByteCount(
    message.emittedFrameCount,
    state.pcmProfile
  );
  const hasSequenceGap = state.missingChunkCount > 0;
  const countsCoverReceived =
    message.emittedFrameCount >= state.receivedFrameCount &&
    message.emittedByteCount >= state.receivedByteCount;
  const countsMatchCoverage = hasSequenceGap
    ? message.emittedFrameCount > state.receivedFrameCount &&
      message.emittedByteCount > state.receivedByteCount
    : message.emittedFrameCount === state.receivedFrameCount &&
      message.emittedByteCount === state.receivedByteCount;
  if (
    expectedEmittedBytes === undefined ||
    expectedEmittedBytes !== message.emittedByteCount ||
    !countsCoverReceived ||
    !countsMatchCoverage
  ) {
    return rejected(
      state,
      "totals_mismatch",
      "audio.stop totals contradict the accepted chunks or sequence-gap evidence"
    );
  }

  const coverageComplete =
    state.coverageComplete && hasNoLoss(message.lossEvidence);
  return {
    accepted: true,
    state: {
      ...state,
      phase: "stopped",
      lastSourceMonotonicMs: message.sourceMonotonicMs,
      sourceStoppedMonotonicMs: message.sourceMonotonicMs,
      finalSequence: message.finalSequence,
      emittedFrameCount: message.emittedFrameCount,
      emittedByteCount: message.emittedByteCount,
      lossEvidence: message.lossEvidence,
      coverageComplete,
      ...(message.sourcePcmSha256
        ? { sourcePcmSha256: message.sourcePcmSha256 }
        : {})
    }
  };
}

export function orderedPcmIngressReceiptFromState(
  state: OrderedPcmIngressState
): OrderedPcmIngressReceipt {
  if (state.phase !== "stopped") {
    throw new Error("An ordered PCM receipt requires an accepted audio.stop");
  }

  return OrderedPcmIngressReceiptSchema.parse({
    schemaVersion: ORDERED_PCM_RECEIPT_VERSION,
    protocolVersion: state.protocolVersion,
    sessionId: state.sessionId,
    attemptId: state.attemptId,
    sourceId: state.sourceId,
    audioProfileHash: state.audioProfileHash,
    pcmProfile: state.pcmProfile,
    sourceStartedMonotonicMs: state.sourceStartedMonotonicMs,
    sourceStoppedMonotonicMs: state.sourceStoppedMonotonicMs,
    finalSequence: state.finalSequence,
    receivedChunkCount: state.receivedChunkCount,
    receivedFrameCount: state.receivedFrameCount,
    receivedByteCount: state.receivedByteCount,
    emittedFrameCount: state.emittedFrameCount,
    emittedByteCount: state.emittedByteCount,
    sequenceGapCount: state.sequenceGapCount,
    missingChunkCount: state.missingChunkCount,
    lossEvidence: state.lossEvidence,
    coverageComplete: state.coverageComplete,
    ...(state.sourcePcmSha256
      ? { sourcePcmSha256: state.sourcePcmSha256 }
      : {})
  });
}

function checkTimestampAndLossEvidence(
  state: OrderedPcmIngressOpenState,
  message: OrderedPcmChunk | OrderedPcmStop
): OrderedPcmIngressTransition | undefined {
  if (message.sourceMonotonicMs < state.lastSourceMonotonicMs) {
    return rejected(
      state,
      "timestamp_regression",
      "sourceMonotonicMs moved backwards"
    );
  }

  const lossError = checkLossEvidence(state, message.lossEvidence);
  if (lossError) {
    return lossError;
  }

  if (!lossBytesMatchFrames(message.lossEvidence, state.pcmProfile)) {
    return rejected(
      state,
      "loss_evidence_mismatch",
      "droppedByteCount does not match droppedFrameCount and the PCM profile"
    );
  }
  return undefined;
}

function checkIdentity(
  state: OrderedPcmIngressOpenState,
  message: OrderedPcmChunk | OrderedPcmStop
): OrderedPcmIngressTransition | undefined {
  if (
    state.sessionId !== message.sessionId ||
    state.attemptId !== message.attemptId ||
    state.sourceId !== message.sourceId
  ) {
    return rejected(
      state,
      "identity_mismatch",
      "sessionId, attemptId, and sourceId must match audio.start"
    );
  }
  return undefined;
}

function checkLossEvidence(
  state: OrderedPcmIngressOpenState,
  next: OrderedPcmLossEvidence
): OrderedPcmIngressTransition | undefined {
  const current = state.lossEvidence;
  if (
    next.captureGapCount < current.captureGapCount ||
    next.droppedFrameCount < current.droppedFrameCount ||
    next.droppedByteCount < current.droppedByteCount ||
    next.overflowCount < current.overflowCount
  ) {
    return rejected(
      state,
      "loss_evidence_regression",
      "Cumulative gap/drop/overflow evidence must not decrease"
    );
  }
  return undefined;
}

function lossBytesMatchFrames(
  evidence: OrderedPcmLossEvidence,
  profile: OrderedPcmProfile
): boolean {
  return (
    pcmByteCount(evidence.droppedFrameCount, profile) ===
    evidence.droppedByteCount
  );
}

function pcmByteCount(
  frameCount: number,
  profile: OrderedPcmProfile
): number | undefined {
  const bytes = frameCount * profile.channelCount * 2;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

function safeAdd(left: number, right: number): number | undefined {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : undefined;
}

function hasNoLoss(evidence: OrderedPcmLossEvidence): boolean {
  return (
    evidence.captureGapCount === 0 &&
    evidence.droppedFrameCount === 0 &&
    evidence.droppedByteCount === 0 &&
    evidence.overflowCount === 0
  );
}

function emptyLossEvidence(): OrderedPcmLossEvidence {
  return {
    captureGapCount: 0,
    droppedFrameCount: 0,
    droppedByteCount: 0,
    overflowCount: 0
  };
}

function rejected(
  state: OrderedPcmIngressState,
  code: OrderedPcmIngressRejectionCode,
  message: string
): OrderedPcmIngressTransition {
  return {
    accepted: false,
    state,
    code,
    message
  };
}

function addReceiptIssue(
  context: z.RefinementCtx,
  field: string,
  message: string
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path: [field]
  });
}

function addOutboundIssue(
  context: z.RefinementCtx,
  field: string,
  message: string
): void {
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    path: [field]
  });
}

const ORDERED_PCM_BINARY_MAGIC_BYTES = new Uint8Array([
  0x4a,
  0x50,
  0x43,
  0x4d
]);
const EMPTY_PCM_BYTES = new Uint8Array(0);

type OrderedPcmBinaryKind = 1 | 2 | 3;

function orderedPcmKindFromType(
  type: OrderedPcmIngressType
): OrderedPcmBinaryKind {
  switch (type) {
    case "audio.start":
      return 1;
    case "audio.chunk":
      return 2;
    case "audio.stop":
      return 3;
  }
}

function orderedPcmTypeFromKind(kind: number): OrderedPcmIngressType {
  switch (kind) {
    case 1:
      return "audio.start";
    case 2:
      return "audio.chunk";
    case 3:
      return "audio.stop";
    default:
      throw new OrderedPcmBinaryEnvelopeError(
        "unknown_kind",
        `Unknown ordered PCM binary message kind ${kind}`
      );
  }
}

function parseDecodedOrderedPcmMessage<T>(
  schema: z.ZodType<T>,
  input: unknown
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new OrderedPcmBinaryEnvelopeError(
      "invalid_header",
      parsed.error.issues[0]?.message ?? "Invalid ordered PCM metadata"
    );
  }
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
