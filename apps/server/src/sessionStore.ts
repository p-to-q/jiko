import { randomUUID } from "node:crypto";
import { canApplySessionEvent } from "@jiko/core";
import type {
  AudioFeatures,
  NormalizedAudio,
  OrderedPcmIngressReceipt,
  PipelineReceipt,
  Reading,
  RuntimeSource,
  SessionEvent,
  SessionRecord,
  SessionResult,
  SessionStatus,
  SttProviderReceipt,
  TranscriptResult,
  UploadedAudio
} from "./types.js";

type CreateSessionInput = {
  sessionId?: string;
  source?: RuntimeSource;
};

export type SessionStoreOptions = {
  maxSessions?: number;
  terminalRetentionMs?: number;
  idleSessionTtlMs?: number;
  receiptRetentionMs?: number;
  identityRetryHorizonMs?: number;
  maxIdentityTombstones?: number;
  now?: () => number;
};

export class SessionCapacityError extends Error {
  readonly code = "session_capacity_exceeded";

  constructor(readonly maxSessions: number) {
    super(`Session capacity (${maxSessions}) was exceeded`);
    this.name = "SessionCapacityError";
  }
}

export class SessionIdentityRetiredError extends Error {
  readonly code = "session_identity_retired";

  constructor(
    readonly sessionId: string,
    readonly retryAfterMs: number
  ) {
    super(`Session identity is still retired: ${sessionId}`);
    this.name = "SessionIdentityRetiredError";
  }
}

export class SessionIdentityLedgerCapacityError extends Error {
  readonly code = "session_identity_ledger_capacity_exceeded";

  constructor(readonly maxTombstones: number) {
    super(`Session identity tombstone capacity (${maxTombstones}) was exceeded`);
    this.name = "SessionIdentityLedgerCapacityError";
  }
}

export type SessionIdentityState =
  | { status: "active" }
  | {
      status: "retired";
      retiredAt: string;
      retryAfterMs: number;
    }
  | { status: "available" };

export type AttemptInputKind = "audio" | "manual";

type AnalysisPatch = {
  uploadedAudio?: UploadedAudio;
  normalizedAudio?: NormalizedAudio;
  orderedPcm?: OrderedPcmIngressReceipt;
  pipeline?: PipelineReceipt;
  sttProviderReceipt?: SttProviderReceipt;
  transcript?: TranscriptResult;
  features?: AudioFeatures;
  readings?: Reading[];
  result?: SessionResult;
};

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private inputClaims = new Map<string, {
    attemptId: string;
    kind: AttemptInputKind;
  }>();
  private readonly lastTouchedAtMs = new Map<string, number>();
  // Keep retired identities separate from full session records. If this
  // bounded ledger fills, the store retains the old session and rejects new
  // creation rather than making an idempotent retry look like a fresh attempt.
  private readonly identityTombstones = new Map<string, {
    retiredAtMs: number;
    expiresAtMs: number;
  }>();
  private readonly maxSessions: number;
  private readonly terminalRetentionMs: number;
  private readonly idleSessionTtlMs: number;
  private readonly identityRetryHorizonMs: number;
  private readonly maxIdentityTombstones: number;
  private readonly now: () => number;
  private rejectedIdentityRetirements = 0;

  constructor(options: SessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxSessions = resolvedPositiveInteger(
      options.maxSessions,
      configuredPositiveInteger("JIKO_SESSION_MAX_COUNT") ?? 256,
      "maxSessions"
    );
    this.terminalRetentionMs = resolvedPositiveInteger(
      options.terminalRetentionMs,
      configuredPositiveInteger("JIKO_SESSION_TERMINAL_RETENTION_MS") ?? 86_400_000,
      "terminalRetentionMs"
    );
    this.idleSessionTtlMs = resolvedPositiveInteger(
      options.idleSessionTtlMs,
      configuredPositiveInteger("JIKO_SESSION_IDLE_TTL_MS") ?? 600_000,
      "idleSessionTtlMs"
    );
    const receiptRetentionMs = resolvedPositiveInteger(
      options.receiptRetentionMs,
      configuredPositiveInteger("JIKO_RECEIPT_RETENTION_MS") ?? 604_800_000,
      "receiptRetentionMs"
    );
    this.identityRetryHorizonMs = resolvedPositiveInteger(
      options.identityRetryHorizonMs,
      configuredPositiveInteger("JIKO_SESSION_ID_RETRY_HORIZON_MS") ??
        Math.max(604_800_000, receiptRetentionMs),
      "identityRetryHorizonMs"
    );
    this.maxIdentityTombstones = resolvedPositiveInteger(
      options.maxIdentityTombstones,
      configuredPositiveInteger("JIKO_SESSION_TOMBSTONE_MAX_COUNT") ?? 4_096,
      "maxIdentityTombstones"
    );
    if (this.identityRetryHorizonMs < receiptRetentionMs) {
      throw new Error(
        "identityRetryHorizonMs must be at least receiptRetentionMs"
      );
    }
    assertSafeIdentityExpiry(this.now(), this.identityRetryHorizonMs);
  }

  createSession(input: CreateSessionInput = {}): SessionRecord {
    this.pruneExpired(true);
    const hasRequestedSessionId = Object.prototype.hasOwnProperty.call(
      input,
      "sessionId"
    );
    const requestedSessionId = sanitizeSessionId(input.sessionId);
    if (hasRequestedSessionId && !requestedSessionId) {
      throw new Error("Invalid explicit sessionId");
    }
    const id = requestedSessionId ?? randomUUID();
    if (this.sessions.has(id)) {
      throw new Error(`Session already exists: ${id}`);
    }
    const tombstone = this.identityTombstones.get(id);
    if (tombstone) {
      throw new SessionIdentityRetiredError(
        id,
        Math.max(0, tombstone.expiresAtMs - this.now())
      );
    }

    this.evictOldestTerminalUntilCapacity();
    if (this.sessions.size >= this.maxSessions) {
      throw new SessionCapacityError(this.maxSessions);
    }

    const nowMs = this.now();
    const now = new Date(nowMs).toISOString();
    const session: SessionRecord = {
      id,
      attemptId: randomUUID(),
      lastSequence: 0,
      createdAt: now,
      updatedAt: now,
      status: "created",
      source: input.source ?? "server",
      events: []
    };

    this.sessions.set(id, session);
    this.lastTouchedAtMs.set(id, nowMs);
    return session;
  }

  getSession(sessionId: string): SessionRecord | undefined {
    this.pruneExpired(false);
    return this.sessions.get(sessionId);
  }

  listSessions(): SessionRecord[] {
    this.pruneExpired(false);
    return [...this.sessions.values()];
  }

  get capacity(): { current: number; max: number } {
    this.pruneExpired(false);
    return { current: this.sessions.size, max: this.maxSessions };
  }

  get identityLedgerCapacity(): {
    current: number;
    max: number;
    saturated: boolean;
    rejectedRetirements: number;
  } {
    this.pruneExpiredTombstones(this.now());
    return {
      current: this.identityTombstones.size,
      max: this.maxIdentityTombstones,
      saturated: this.identityTombstones.size >= this.maxIdentityTombstones,
      rejectedRetirements: this.rejectedIdentityRetirements
    };
  }

  getSessionIdentityState(sessionId: string): SessionIdentityState {
    this.pruneExpired(false);
    if (this.sessions.has(sessionId)) {
      return { status: "active" };
    }

    const nowMs = this.now();
    this.pruneExpiredTombstones(nowMs);
    const tombstone = this.identityTombstones.get(sessionId);
    if (!tombstone) {
      return { status: "available" };
    }

    return {
      status: "retired",
      retiredAt: new Date(tombstone.retiredAtMs).toISOString(),
      retryAfterMs: Math.max(0, tombstone.expiresAtMs - nowMs)
    };
  }

  /**
   * Claims the one input owner for an immutable attempt. The claim is kept for
   * the attempt's lifetime: retrying or changing input mode creates a new
   * session instead of allowing two pipelines to race toward different final
   * results.
   */
  claimAttemptInput(
    sessionId: string,
    attemptId: string,
    kind: AttemptInputKind
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.attemptId !== attemptId || this.inputClaims.has(sessionId)) {
      return false;
    }

    const lastEvent = session.events.at(-1);
    const canClaim = kind === "manual"
      ? session.status === "created"
      : session.status === "created" ||
        session.status === "recording" ||
        (
          session.status === "processing" &&
          lastEvent?.type === "input.recording.stopped" &&
          !session.uploadedAudio
        );

    if (!canClaim) {
      return false;
    }

    this.inputClaims.set(sessionId, { attemptId, kind });
    return true;
  }

  getAttemptInputClaim(
    sessionId: string,
    attemptId: string
  ): AttemptInputKind | undefined {
    const claim = this.inputClaims.get(sessionId);
    return claim?.attemptId === attemptId ? claim.kind : undefined;
  }

  addEvent(event: SessionEvent): SessionRecord | undefined {
    if (!event.sessionId) {
      return undefined;
    }

    const session = this.sessions.get(event.sessionId);
    if (!session) {
      return undefined;
    }

    if (event.attemptId !== session.attemptId) {
      throw new Error(
        `Attempt mismatch for ${event.sessionId}: expected ${session.attemptId}, got ${event.attemptId}`
      );
    }

    const expectedSequence = session.lastSequence + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Event sequence mismatch for ${event.sessionId}: expected ${expectedSequence}, got ${event.sequence}`
      );
    }

    assertEventMayFollowStatus(session, event);

    session.events.push(event);
    session.lastSequence = event.sequence;
    session.updatedAt = new Date(event.timestamp).toISOString();
    session.status = statusForEvent(event.type, session.status);
    this.lastTouchedAtMs.set(session.id, this.now());
    return session;
  }

  updateAnalysis(sessionId: string, patch: AnalysisPatch): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const nowMs = this.now();
    Object.assign(session, patch, { updatedAt: new Date(nowMs).toISOString() });
    this.lastTouchedAtMs.set(session.id, nowMs);
    return session;
  }

  private pruneExpired(failOnBlockedRetirement: boolean): void {
    const nowMs = this.now();
    this.pruneExpiredTombstones(nowMs);
    for (const [sessionId, session] of this.sessions) {
      const touchedAtMs = this.lastTouchedAtMs.get(sessionId) ?? nowMs;
      const ttlMs = terminalStatuses.has(session.status)
        ? this.terminalRetentionMs
        : this.idleSessionTtlMs;
      if (nowMs - touchedAtMs >= ttlMs) {
        if (!this.tryRetireSession(sessionId, nowMs) && failOnBlockedRetirement) {
          throw new SessionIdentityLedgerCapacityError(
            this.maxIdentityTombstones
          );
        }
      }
    }
  }

  private evictOldestTerminalUntilCapacity(): void {
    while (this.sessions.size >= this.maxSessions) {
      let oldest: { id: string; touchedAtMs: number } | undefined;
      for (const [sessionId, session] of this.sessions) {
        if (!terminalStatuses.has(session.status)) {
          continue;
        }
        const touchedAtMs = this.lastTouchedAtMs.get(sessionId) ?? this.now();
        if (!oldest || touchedAtMs < oldest.touchedAtMs) {
          oldest = { id: sessionId, touchedAtMs };
        }
      }
      if (!oldest) {
        return;
      }
      if (!this.tryRetireSession(oldest.id, this.now())) {
        throw new SessionIdentityLedgerCapacityError(
          this.maxIdentityTombstones
        );
      }
    }
  }

  private tryRetireSession(sessionId: string, nowMs: number): boolean {
    this.pruneExpiredTombstones(nowMs);
    if (this.identityTombstones.size >= this.maxIdentityTombstones) {
      this.rejectedIdentityRetirements = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.rejectedIdentityRetirements + 1
      );
      return false;
    }

    const expiresAtMs = assertSafeIdentityExpiry(
      nowMs,
      this.identityRetryHorizonMs
    );
    this.identityTombstones.set(sessionId, {
      retiredAtMs: nowMs,
      expiresAtMs
    });
    this.sessions.delete(sessionId);
    this.inputClaims.delete(sessionId);
    this.lastTouchedAtMs.delete(sessionId);
    return true;
  }

  private pruneExpiredTombstones(nowMs: number): void {
    for (const [sessionId, tombstone] of this.identityTombstones) {
      if (nowMs >= tombstone.expiresAtMs) {
        this.identityTombstones.delete(sessionId);
      }
    }
  }
}

const terminalStatuses = new Set<SessionStatus>([
  "result",
  "silence",
  "reset",
  "error"
]);

function assertEventMayFollowStatus(
  session: SessionRecord,
  event: SessionEvent
): void {
  const alreadyFinal = session.events.some(
    (existing) => existing.type === "session.result"
  );
  if (event.type === "session.result" && alreadyFinal) {
    throw new Error(`Session attempt already has a final result: ${session.id}`);
  }

  if (
    event.type === "session.created" &&
    session.events.some((existing) => existing.type === "session.created")
  ) {
    throw new Error(`Session was already created: ${session.id}`);
  }

  if (!canApplySessionEvent(session.status, event.type)) {
    throw new Error(
      `Cannot append ${event.type} from state ${session.status} for ${session.id}`
    );
  }

  if (event.type === "tts.started" || event.type === "tts.finished") {
    const ttsStarted = session.events.some(
      (existing) => existing.type === "tts.started"
    );
    const ttsFinished = session.events.some(
      (existing) => existing.type === "tts.finished"
    );
    if (
      (event.type === "tts.started" && (ttsStarted || ttsFinished)) ||
      (event.type === "tts.finished" && (!ttsStarted || ttsFinished))
    ) {
      throw new Error(`Invalid TTS event order for ${session.id}: ${event.type}`);
    }
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

  return trimmed !== "." &&
    trimmed !== ".." &&
    /^[a-zA-Z0-9._:-]+$/.test(trimmed)
    ? trimmed
    : undefined;
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

function configuredPositiveInteger(name: string): number | undefined {
  const configured = process.env[name];
  if (configured === undefined) {
    return undefined;
  }
  const rawValue = configured.trim();
  const parsed = Number(rawValue);
  if (!rawValue || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function resolvedPositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function assertSafeIdentityExpiry(nowMs: number, horizonMs: number): number {
  const expiresAtMs = nowMs + horizonMs;
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0 ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs > 8_640_000_000_000_000
  ) {
    throw new Error(
      "identityRetryHorizonMs must produce a safe JavaScript timestamp"
    );
  }
  return expiresAtMs;
}
