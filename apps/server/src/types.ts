import type {
  AudioFeatures,
  Reading,
  RuntimeSource,
  SessionEvent,
  SessionResult,
  TranscriptResult,
  UploadedAudio
} from "@jiko/protocol";

export type {
  AudioFeatures,
  Reading,
  RuntimeSource,
  SessionEvent,
  SessionResult,
  TranscriptResult,
  UploadedAudio
} from "@jiko/protocol";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SessionStatus =
  | "created"
  | "recording"
  | "processing"
  | "reading"
  | "result"
  | "silence"
  | "reset"
  | "error";

export type SessionRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  source: RuntimeSource;
  uploadedAudio?: UploadedAudio;
  transcript?: TranscriptResult;
  features?: AudioFeatures;
  readings?: Reading[];
  result?: SessionResult;
  events: SessionEvent[];
};
