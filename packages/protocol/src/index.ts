import { z } from "zod";

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

export const RuntimeSourceSchema = z.enum([
  "browser",
  "device",
  "operator",
  "server",
  "manual"
]);
export type RuntimeSource = z.infer<typeof RuntimeSourceSchema>;

export const ReadingFeatureValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean()
]);
export type ReadingFeatureValue = z.infer<typeof ReadingFeatureValueSchema>;

export const ReadingSchema = z.object({
  channel: ReadingChannelSchema,
  state: SignalStateSchema,
  confidence: z.number().min(0).max(1),
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
  language: z.string().optional(),
  provider: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  latencyMs: z.number().nonnegative().optional(),
  segments: z.array(TranscriptSegmentSchema).optional()
});
export type TranscriptResult = z.infer<typeof TranscriptResultSchema>;

export const AudioFeaturesSchema = z.object({
  durationMs: z.number().nonnegative(),
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
  "consensus_maintain",
  "consensus_deviate",
  "consensus_static",
  "minority_exists",
  "mixed"
]);
export type TopWindowStatus = z.infer<typeof TopWindowStatusSchema>;

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

export const SessionResultSchema = z.object({
  sessionId: z.string(),
  readings: z.array(ReadingSchema),
  majorityState: SignalStateSchema.optional(),
  minorityStates: z.array(SignalStateSchema).default([]),
  topWindow: TopWindowSchema,
  tts: TtsRequestSchema.optional(),
  colors: UiColorAssignmentSchema.default({}),
  silenceMs: z.number().nonnegative().optional()
});
export type SessionResult = z.infer<typeof SessionResultSchema>;

export const ProviderReceiptSchema = z.object({
  id: z.string(),
  latencyMs: z.number().nonnegative().optional(),
  remote: z.boolean().default(false)
});
export type ProviderReceipt = z.infer<typeof ProviderReceiptSchema>;

export const SessionReceiptSchema = z.object({
  sessionId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  input: UploadedAudioSchema.optional(),
  providers: z
    .object({
      stt: ProviderReceiptSchema.optional(),
      tts: ProviderReceiptSchema.optional()
    })
    .default({}),
  transcript: TranscriptResultSchema.optional(),
  features: AudioFeaturesSchema.optional(),
  readings: z.array(ReadingSchema).default([]),
  result: SessionResultSchema.optional(),
  errors: z.array(z.string()).default([])
});
export type SessionReceipt = z.infer<typeof SessionReceiptSchema>;

const BaseSessionEventSchema = z.object({
  sessionId: z.string(),
  timestamp: z.number().int().nonnegative(),
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
]);
export type SessionEvent = z.infer<typeof SessionEventSchema>;

export function parseSessionEvent(input: unknown): SessionEvent {
  return SessionEventSchema.parse(input);
}
