import { z } from "zod";
import { OrderedPcmIngressReceiptSchema } from "./orderedPcm.js";

export * from "./orderedPcm.js";

export const SignalStateSchema = z.enum(["maintain", "deviate", "static"]);
export type SignalState = z.infer<typeof SignalStateSchema>;

export const ReadingChannelSchema = z.enum(["text", "voice", "timing"]);
export type ReadingChannel = z.infer<typeof ReadingChannelSchema>;

export const SessionPhaseSchema = z.enum([
  "idle",
  "armed",
  "recording",
  "processing",
  "reading",
  "result",
  "silence",
  "reset",
  "error"
]);
export type SessionPhase = z.infer<typeof SessionPhaseSchema>;

export const SessionStatusSchema = z.enum([
  "created",
  "recording",
  "processing",
  "reading",
  "result",
  "silence",
  "reset",
  "error"
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const RuntimeSourceSchema = z.enum([
  "browser",
  "device",
  "operator",
  "server",
  "manual"
]);
export type RuntimeSource = z.infer<typeof RuntimeSourceSchema>;

const SessionIdentifierSchema = z.string()
  .min(1)
  .max(96)
  .regex(/^[a-zA-Z0-9._:-]+$/)
  .refine((value) => value !== "." && value !== "..", {
    message: "dot-only path segments are not valid identifiers"
  });

export const ReadingFeatureValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean()
]);
export type ReadingFeatureValue = z.infer<typeof ReadingFeatureValueSchema>;

export const ReadingAvailabilitySchema = z.enum([
  "measured",
  "simulated",
  "unavailable"
]);
export type ReadingAvailability = z.infer<typeof ReadingAvailabilitySchema>;

export const ReadingSchema = z.object({
  channel: ReadingChannelSchema,
  state: SignalStateSchema,
  confidence: z.number().min(0).max(1),
  availability: ReadingAvailabilitySchema.optional(),
  features: z.record(z.string(), ReadingFeatureValueSchema).default({}),
  privateReason: z.string().optional()
});
export type Reading = z.infer<typeof ReadingSchema>;

export const TranscriptSegmentSchema = z.object({
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional()
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const TranscriptResultSchema = z.object({
  text: z.string(),
  semanticText: z.string().optional(),
  language: z.string().optional(),
  provider: z.string(),
  failureCode: z
    .enum(["provider_unavailable", "timed_out", "failed"])
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  latencyMs: z.number().nonnegative().optional(),
  enhancement: z
    .object({
      id: z.string(),
      transforms: z.array(z.string()).default([])
    })
    .optional(),
  segments: z.array(TranscriptSegmentSchema).optional()
});
export type TranscriptResult = z.infer<typeof TranscriptResultSchema>;

export const AudioFeaturesSchema = z.object({
  durationMs: z.number().nonnegative(),
  digitalSilenceDetected: z.boolean().optional(),
  speechMs: z.number().nonnegative().optional(),
  silenceMs: z.number().nonnegative().optional(),
  preSpeechDelayMs: z.number().nonnegative().optional(),
  pauseCount: z.number().int().nonnegative().optional(),
  longestPauseMs: z.number().nonnegative().optional(),
  rmsMean: z.number().nonnegative().optional(),
  rmsStd: z.number().nonnegative().optional(),
  rmsPeak: z.number().nonnegative().optional(),
  pitchMeanHz: z.number().nonnegative().optional(),
  pitchStdHz: z.number().nonnegative().optional(),
  speechRateCharsPerSecond: z.number().nonnegative().optional(),
  clippingDetected: z.boolean().optional(),
  noiseDetected: z.boolean().optional()
});
export type AudioFeatures = z.infer<typeof AudioFeaturesSchema>;

export const UploadedAudioSchema = z.object({
  source: RuntimeSourceSchema,
  mediaType: z.string(),
  byteSize: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().optional()
});
export type UploadedAudio = z.infer<typeof UploadedAudioSchema>;

export const NormalizedAudioSchema = z.object({
  mediaType: z.string().default("audio/wav"),
  sampleRateHz: z.number().int().positive().default(16000),
  channelCount: z.number().int().positive().default(1),
  durationMs: z.number().nonnegative().optional(),
  latencyMs: z.number().nonnegative().optional()
});
export type NormalizedAudio = z.infer<typeof NormalizedAudioSchema>;

export const TopWindowStatusSchema = z.enum([
  "empty",
  "partial",
  "insufficient",
  "consensus_maintain",
  "consensus_deviate",
  "consensus_static",
  "minority_exists",
  "mixed"
]);
export type TopWindowStatus = z.infer<typeof TopWindowStatusSchema>;

export const ReadingCoverageSchema = z.object({
  total: z.number().int().nonnegative(),
  measured: z.number().int().nonnegative(),
  simulated: z.number().int().nonnegative(),
  unavailable: z.number().int().nonnegative(),
  unavailableChannels: z.array(ReadingChannelSchema).default([])
});
export type ReadingCoverage = z.infer<typeof ReadingCoverageSchema>;

export const TopWindowSchema = z.object({
  status: TopWindowStatusSchema,
  lineEn: z.string(),
  lineZh: z.string()
});
export type TopWindow = z.infer<typeof TopWindowSchema>;

export const TtsRequestSchema = z.object({
  language: z.string(),
  text: z.string(),
  clipKey: z.string().optional()
});
export type TtsRequest = z.infer<typeof TtsRequestSchema>;

export const UiColorAssignmentSchema = z.record(z.string(), z.string());
export type UiColorAssignment = z.infer<typeof UiColorAssignmentSchema>;

const sessionResultChannels: readonly ReadingChannel[] = [
  "text",
  "voice",
  "timing"
];

const sessionResultStates: readonly SignalState[] = [
  "maintain",
  "deviate",
  "static"
];

function deriveSessionResultVerdict(readings: Reading[]): {
  majorityState: SignalState | undefined;
  minorityStates: SignalState[];
  topWindowStatus: TopWindowStatus;
} {
  if (readings.length === 0) {
    return {
      majorityState: undefined,
      minorityStates: [],
      topWindowStatus: "empty"
    };
  }

  const availableReadings = readings.filter(
    (reading) => reading.availability !== "unavailable"
  );
  const presentStates = new Set(
    availableReadings.map((reading) => reading.state)
  );
  const majorityState = sessionResultStates.find((state) => {
    const count = availableReadings.filter(
      (reading) => reading.state === state
    ).length;
    return count > availableReadings.length / 2;
  });
  const minorityStates = sessionResultStates.filter(
    (state) => presentStates.has(state) && state !== majorityState
  );

  if (readings.some((reading) => reading.availability === "unavailable")) {
    return {
      majorityState,
      minorityStates,
      topWindowStatus:
        availableReadings.length >= 2 && majorityState
          ? "partial"
          : "insufficient"
    };
  }

  if (!majorityState) {
    return { majorityState, minorityStates, topWindowStatus: "mixed" };
  }

  if (minorityStates.length > 0) {
    return { majorityState, minorityStates, topWindowStatus: "minority_exists" };
  }

  return {
    majorityState,
    minorityStates,
    topWindowStatus: `consensus_${majorityState}`
  };
}

export const SessionResultSchema = z
  .object({
    sessionId: SessionIdentifierSchema,
    readings: z.array(ReadingSchema),
    majorityState: SignalStateSchema.optional(),
    minorityStates: z.array(SignalStateSchema).default([]),
    topWindow: TopWindowSchema,
    coverage: ReadingCoverageSchema.optional(),
    tts: TtsRequestSchema.optional(),
    colors: UiColorAssignmentSchema.default({}),
    silenceMs: z.number().nonnegative().optional()
  })
  .superRefine((result, context) => {
    const channels = result.readings.map((reading) => reading.channel);
    const uniqueChannels = new Set(channels);
    const expectedVerdict = deriveSessionResultVerdict(result.readings);

    if (uniqueChannels.size !== channels.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readings"],
        message: "Result readings must contain each channel at most once"
      });
    }

    // An empty result is the explicit pre-signal state. Once a result contains
    // evidence, all three product lines must be represented; a failed line is
    // carried as availability=unavailable rather than silently omitted.
    if (
      channels.length !== 0 &&
      (
        channels.length !== sessionResultChannels.length ||
        sessionResultChannels.some((channel) => !uniqueChannels.has(channel))
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readings"],
        message: "Non-empty results must contain text, voice, and timing exactly once"
      });
    }

    if (channels.length === 0 && result.topWindow.status !== "empty") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topWindow", "status"],
        message: "A result without readings must use the empty top-window status"
      });
    }

    if (channels.length > 0 && result.topWindow.status === "empty") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topWindow", "status"],
        message: "A result with readings cannot use the empty top-window status"
      });
    }

    if (channels.length > 0 && !result.coverage) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage"],
        message: "A non-empty result must include derived reading coverage"
      });
    }

    if (
      channels.length === 0 &&
      (result.majorityState !== undefined ||
        result.minorityStates.length > 0 ||
        result.tts !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["readings"],
        message: "An empty result cannot claim a majority, minority, or TTS output"
      });
    }

    if (result.majorityState !== expectedVerdict.majorityState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["majorityState"],
        message: "Result majorityState must be derived from available readings"
      });
    }

    if (
      result.minorityStates.length !== expectedVerdict.minorityStates.length ||
      result.minorityStates.some(
        (state, index) => state !== expectedVerdict.minorityStates[index]
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minorityStates"],
        message:
          "Result minorityStates must be unique and match available readings in canonical order"
      });
    }

    if (result.topWindow.status !== expectedVerdict.topWindowStatus) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["topWindow", "status"],
        message: "Result top-window status must match the derived verdict class"
      });
    }

    if (!result.coverage) {
      return;
    }

    const unavailableChannels = sessionResultChannels.filter((channel) =>
      result.readings.some(
        (reading) =>
          reading.channel === channel && reading.availability === "unavailable"
      )
    );
    const expectedCoverage = {
      total: result.readings.length,
      measured: result.readings.filter(
        (reading) => !reading.availability || reading.availability === "measured"
      ).length,
      simulated: result.readings.filter(
        (reading) => reading.availability === "simulated"
      ).length,
      unavailable: unavailableChannels.length,
      unavailableChannels
    };

    for (const field of ["total", "measured", "simulated", "unavailable"] as const) {
      if (result.coverage[field] !== expectedCoverage[field]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coverage", field],
          message: `Coverage ${field} must match the result readings`
        });
      }
    }

    if (
      result.coverage.unavailableChannels.length !== unavailableChannels.length ||
      result.coverage.unavailableChannels.some(
        (channel, index) => channel !== unavailableChannels[index]
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverage", "unavailableChannels"],
        message: "Coverage unavailableChannels must match readings in canonical order"
      });
    }
  });
export type SessionResult = z.infer<typeof SessionResultSchema>;

export const ProviderReceiptSchema = z.object({
  id: z.string(),
  latencyMs: z.number().nonnegative().optional(),
  remote: z.boolean().default(false)
});
export type ProviderReceipt = z.infer<typeof ProviderReceiptSchema>;

export const SttArtifactIdentitySchema = z
  .object({
    name: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive()
  })
  .strict();
export type SttArtifactIdentity = z.infer<typeof SttArtifactIdentitySchema>;

export const SttExecutionIdentitySchema = z
  .object({
    runtime: z
      .object({
        name: z.string().min(1),
        version: z.string().min(1)
      })
      .strict(),
    configuration: z
      .object({
        language: z.string().min(1),
        threads: z.number().int().positive(),
        executionProvider: z.string().min(1),
        useItn: z.boolean()
      })
      .strict(),
    artifacts: z
      .object({
        model: SttArtifactIdentitySchema,
        tokens: SttArtifactIdentitySchema
      })
      .strict()
  })
  .strict();
export type SttExecutionIdentity = z.infer<typeof SttExecutionIdentitySchema>;

export const SttProviderOutcomeSchema = z.enum([
  "completed",
  "not_run",
  "provider_unavailable",
  "timed_out",
  "failed"
]);
export type SttProviderOutcome = z.infer<typeof SttProviderOutcomeSchema>;

/**
 * Auditable metadata for the optional Deepgram pre-recorded request boundary.
 * `model` and `version` are the requested selectors. The resolved fields and
 * request id are response evidence and therefore appear together or not at all.
 */
export const SttRemoteExecutionSchema = z
  .object({
    provider: z.literal("deepgram"),
    model: z.string().min(1).max(128),
    version: z.string().min(1).max(128),
    resolvedModel: z.string().min(1).max(128).optional(),
    resolvedVersion: z.string().min(1).max(128).optional(),
    region: z.enum(["global", "eu", "au", "in", "custom"]),
    mode: z.literal("batch"),
    trustBoundary: z.literal("deepgram_api"),
    endpointOrigin: z.string().url().max(512).regex(/^https:\/\/[^/?#]+$/),
    requestId: z.string().min(1).max(256).optional(),
    mipOptOut: z.literal(true)
  })
  .strict()
  .superRefine((execution, context) => {
    const responseIdentityCount = [
      execution.requestId,
      execution.resolvedModel,
      execution.resolvedVersion
    ].filter(Boolean).length;
    if (responseIdentityCount !== 0 && responseIdentityCount !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Remote STT response identity must include request id, model, and version together",
        path: ["requestId"]
      });
    }
  });
export type SttRemoteExecution = z.infer<typeof SttRemoteExecutionSchema>;

/**
 * STT execution provenance is optional so existing session_receipt_v1 files
 * remain readable. New server receipts always include outcome. Identity is
 * emitted only after a runtime reports loaded readiness for the actual call.
 */
export const SttProviderReceiptSchema = ProviderReceiptSchema.extend({
  outcome: SttProviderOutcomeSchema.optional(),
  execution: SttExecutionIdentitySchema.optional(),
  remoteExecution: SttRemoteExecutionSchema.optional()
})
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.execution && !receipt.outcome) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STT execution identity requires an explicit outcome",
        path: ["outcome"]
      });
    }

    if (
      receipt.execution &&
      (receipt.outcome === "not_run" ||
        receipt.outcome === "provider_unavailable")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `STT outcome ${receipt.outcome} cannot carry execution identity`,
        path: ["execution"]
      });
    }

    if (receipt.remoteExecution && !receipt.remote) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Remote STT execution metadata requires remote=true",
        path: ["remote"]
      });
    }

    if (receipt.remoteExecution && !receipt.outcome) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Remote STT execution metadata requires an explicit outcome",
        path: ["outcome"]
      });
    }

    if (
      receipt.remoteExecution &&
      (receipt.outcome === "not_run" ||
        receipt.outcome === "provider_unavailable")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `STT outcome ${receipt.outcome} cannot carry remote execution metadata`,
        path: ["remoteExecution"]
      });
    }

    if (
      receipt.remoteExecution?.provider === "deepgram" &&
      !receipt.id.startsWith("remote:deepgram-batch")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Deepgram execution metadata requires the Deepgram batch provider id",
        path: ["id"]
      });
    }

    if (receipt.execution && receipt.remoteExecution) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STT receipt cannot carry local and remote execution identity together",
        path: ["remoteExecution"]
      });
    }

    if (
      receipt.remoteExecution &&
      receipt.outcome === "completed" &&
      !receipt.remoteExecution.requestId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed remote STT requires response request, model, and version identity",
        path: ["remoteExecution", "requestId"]
      });
    }
  });
export type SttProviderReceipt = z.infer<typeof SttProviderReceiptSchema>;

export const PipelineStageNameSchema = z.enum([
  "normalize",
  "features",
  "stt",
  "enhance",
  "readings",
  "total"
]);
export type PipelineStageName = z.infer<typeof PipelineStageNameSchema>;

export const PipelineStageStatusSchema = z.enum([
  "ready",
  "degraded",
  "unavailable",
  "timed_out",
  "failed"
]);
export type PipelineStageStatus = z.infer<typeof PipelineStageStatusSchema>;

export const PipelineStageReceiptSchema = z.object({
  stage: PipelineStageNameSchema,
  status: PipelineStageStatusSchema,
  latencyMs: z.number().nonnegative(),
  provider: z.string().optional()
});
export type PipelineStageReceipt = z.infer<typeof PipelineStageReceiptSchema>;

export const PipelineReceiptSchema = z.object({
  startedAt: z.string(),
  finishedAt: z.string(),
  totalLatencyMs: z.number().nonnegative(),
  stages: z.array(PipelineStageReceiptSchema)
});
export type PipelineReceipt = z.infer<typeof PipelineReceiptSchema>;

const BaseSessionEventSchema = z.object({
  sessionId: SessionIdentifierSchema,
  attemptId: SessionIdentifierSchema,
  sequence: z.number().int().positive(),
  timestamp: z.number().int().nonnegative(),
  monotonicMs: z.number().nonnegative().optional(),
  source: RuntimeSourceSchema.optional()
});

export const SessionCreatedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("session.created")
});

export const InputRecordingStartedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("input.recording.started")
});

export const InputRecordingStoppedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("input.recording.stopped"),
  durationMs: z.number().nonnegative().optional()
});

export const AudioUploadedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("audio.uploaded"),
  audio: UploadedAudioSchema
});

export const AudioNormalizedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("audio.normalized"),
  audio: NormalizedAudioSchema
});

export const AudioTranscribedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("audio.transcribed"),
  transcript: TranscriptResultSchema
});

export const AudioFeaturesExtractedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("audio.features.extracted"),
  features: AudioFeaturesSchema
});

export const ReadingStartedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("reading.started")
});

export const ReadingChannelResolvedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("reading.channel.resolved"),
  reading: ReadingSchema
});

export const SessionResultEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("session.result"),
  result: SessionResultSchema
});

export const TtsStartedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("tts.started"),
  tts: TtsRequestSchema
});

export const TtsFinishedEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("tts.finished"),
  provider: ProviderReceiptSchema.optional()
});

export const SessionSilenceEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("session.silence"),
  durationMs: z.number().nonnegative().optional()
});

export const SessionResetEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("session.reset")
});

export const SessionErrorEventSchema = BaseSessionEventSchema.extend({
  type: z.literal("session.error"),
  message: z.string(),
  code: z.string().optional(),
  recoverable: z.boolean().default(true)
});

export const SessionEventSchema = z.discriminatedUnion("type", [
  SessionCreatedEventSchema,
  InputRecordingStartedEventSchema,
  InputRecordingStoppedEventSchema,
  AudioUploadedEventSchema,
  AudioNormalizedEventSchema,
  AudioTranscribedEventSchema,
  AudioFeaturesExtractedEventSchema,
  ReadingStartedEventSchema,
  ReadingChannelResolvedEventSchema,
  SessionResultEventSchema,
  TtsStartedEventSchema,
  TtsFinishedEventSchema,
  SessionSilenceEventSchema,
  SessionResetEventSchema,
  SessionErrorEventSchema
]).superRefine((event, context) => {
  if (event.type === "session.result" && event.result.sessionId !== event.sessionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Result sessionId must match the enclosing event sessionId",
      path: ["result", "sessionId"]
    });
  }
});
export type SessionEvent = z.infer<typeof SessionEventSchema>;

export const SessionReceiptInputSchema = z.object({
  audio: UploadedAudioSchema.optional(),
  normalizedAudio: NormalizedAudioSchema.optional(),
  orderedPcm: OrderedPcmIngressReceiptSchema.optional(),
  audioStored: z.boolean()
}).strict();
export type SessionReceiptInput = z.infer<typeof SessionReceiptInputSchema>;

export const SessionReceiptSchema = z.object({
  schemaVersion: z.literal("session_receipt_v1").default("session_receipt_v1"),
  sessionId: SessionIdentifierSchema,
  attemptId: SessionIdentifierSchema,
  lastSequence: z.number().int().nonnegative(),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
  status: SessionStatusSchema,
  source: RuntimeSourceSchema,
  input: SessionReceiptInputSchema,
  providers: z
    .object({
      stt: SttProviderReceiptSchema.optional(),
      tts: ProviderReceiptSchema.optional()
    })
    .strict()
    .default({}),
  transcript: TranscriptResultSchema.optional(),
  features: AudioFeaturesSchema.optional(),
  pipeline: PipelineReceiptSchema.optional(),
  readings: z.array(ReadingSchema).default([]),
  result: SessionResultSchema.optional(),
  events: z.array(SessionEventSchema).default([]),
  errors: z.array(z.string()).default([])
}).strict().superRefine((receipt, context) => {
  const stt = receipt.providers.stt;
  const transcript = receipt.transcript;
  if (!stt || !transcript) {
    return;
  }

  if (stt.id !== transcript.provider) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "STT receipt id must match transcript provider",
      path: ["providers", "stt", "id"]
    });
  }

  if (!stt.outcome) {
    return;
  }

  const expectedFailure = transcript.failureCode;
  if (
    (stt.outcome === "completed" || stt.outcome === "not_run") &&
    expectedFailure
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `STT outcome ${stt.outcome} cannot accompany transcript failure ${expectedFailure}`,
      path: ["providers", "stt", "outcome"]
    });
  }

  if (
    stt.outcome !== "completed" &&
    stt.outcome !== "not_run" &&
    stt.outcome !== expectedFailure
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "STT receipt outcome must match transcript failureCode",
      path: ["providers", "stt", "outcome"]
    });
  }
});
export type SessionReceipt = z.infer<typeof SessionReceiptSchema>;

export function parseSessionEvent(input: unknown): SessionEvent {
  return SessionEventSchema.parse(input);
}
