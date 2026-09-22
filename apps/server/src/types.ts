import type {
  AudioFeatures,
  NormalizedAudio,
  OrderedPcmIngressReceipt,
  PipelineReceipt,
  Reading,
  RuntimeSource,
  SessionEvent,
  SessionResult,
  SessionStatus,
  SttProviderReceipt,
  TranscriptResult,
  UploadedAudio
} from "@jiko/protocol";

export type {
  AudioFeatures,
  NormalizedAudio,
  OrderedPcmIngressReceipt,
  PipelineReceipt,
  Reading,
  RuntimeSource,
  SessionEvent,
  SessionResult,
  SessionStatus,
  SttProviderReceipt,
  TranscriptResult,
  UploadedAudio
} from "@jiko/protocol";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SessionRecord = {
  id: string;
  attemptId: string;
  lastSequence: number;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  source: RuntimeSource;
  uploadedAudio?: UploadedAudio;
  normalizedAudio?: NormalizedAudio;
  orderedPcm?: OrderedPcmIngressReceipt;
  pipeline?: PipelineReceipt;
  sttProviderReceipt?: SttProviderReceipt;
  transcript?: TranscriptResult;
  features?: AudioFeatures;
  readings?: Reading[];
  result?: SessionResult;
  events: SessionEvent[];
};
