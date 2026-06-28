import { randomUUID } from "node:crypto";
import type {
  AudioFeatures,
  Reading,
  RuntimeSource,
  SessionEvent,
  SessionRecord,
  SessionResult,
  SessionStatus,
  TranscriptResult,
  UploadedAudio
} from "./types.js";

type CreateSessionInput = {
  sessionId?: string;
  source?: RuntimeSource;
};

type AnalysisPatch = {
  uploadedAudio?: UploadedAudio;
  transcript?: TranscriptResult;
  features?: AudioFeatures;
  readings?: Reading[];
  result?: SessionResult;
};

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();

  createSession(input: CreateSessionInput = {}): SessionRecord {
    const id = sanitizeSessionId(input.sessionId) ?? randomUUID();
    if (this.sessions.has(id)) {
      throw new Error(`Session already exists: ${id}`);
    }

    const now = new Date().toISOString();
    const session: SessionRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      status: "created",
      source: input.source ?? "server",
      events: []
    };

    this.sessions.set(id, session);
    return session;
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  addEvent(event: SessionEvent): SessionRecord | undefined {
    if (!event.sessionId) {
      return undefined;
    }

    const session = this.sessions.get(event.sessionId);
    if (!session) {
      return undefined;
    }

    session.events.push(event);
    session.updatedAt = new Date(event.timestamp).toISOString();
    session.status = statusForEvent(event.type, session.status);
    return session;
  }

  updateAnalysis(sessionId: string, patch: AnalysisPatch): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    return session;
  }
}

export function sanitizeSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 96) {
    return undefined;
  }

  return /^[a-zA-Z0-9._:-]+$/.test(trimmed) ? trimmed : undefined;
}

function statusForEvent(type: string, fallback: SessionStatus): SessionStatus {
  if (type === "input.recording.started") {
    return "recording";
  }

  if (type === "input.recording.stopped" || type === "audio.uploaded") {
    return "processing";
  }

  if (type === "audio.transcribed" || type === "audio.features.extracted") {
    return "processing";
  }

  if (type === "reading.started" || type === "reading.channel.resolved") {
    return "reading";
  }

  if (type === "session.result") {
    return "result";
  }

  if (type === "session.silence") {
    return "silence";
  }

  if (type === "session.reset") {
    return "reset";
  }

  if (type === "session.error") {
    return "error";
  }

  return fallback;
}
