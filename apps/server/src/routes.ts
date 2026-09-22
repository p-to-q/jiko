import {
  parseSessionEvent,
  type RuntimeSource,
  type TtsRequest
} from "@jiko/protocol";
import { canAcceptExternalEvent } from "@jiko/core";
import {
  AudioPipelineError,
  audioPipelineReservationBytes,
  runAudioPipeline
} from "./audioPipeline.js";
import {
  AudioResourceAdmission,
  AudioResourceCapacityError,
  type AudioIngressLease,
  type AudioPipelineLease
} from "./audioResourceAdmission.js";
import {
  AttemptDeadlineRegistry,
  configuredResultCommitReserveMs,
  type AttemptDeadline,
  type SessionDeadlineExceededError
} from "./attemptDeadline.js";
import { AttemptWorkRegistry } from "./attemptWork.js";
import { collectDiagnostics } from "./diagnostics.js";
import type { EventBus } from "./eventBus.js";
import { buildMockFeatures, buildReadings, buildResult } from "./mockPipeline.js";
import { OutputScheduler, type OutputTaskOutcome } from "./outputScheduler.js";
import {
  buildSessionReceipt,
  ReceiptIdentityReadError,
  type ReceiptWriter
} from "./receipts.js";
import {
  sanitizeSessionId,
  SessionCapacityError,
  SessionIdentityLedgerCapacityError,
  SessionIdentityRetiredError,
  SessionStore
} from "./sessionStore.js";
import type { RemoteAudioConsent } from "./stt.js";
import type { StreamingSttFinal } from "./streamingStt.js";
import { speakLocalResult } from "./tts.js";
import { enhanceTranscript } from "./transcriptEnhancement.js";
import type {
  PipelineReceipt,
  Reading,
  SessionEvent,
  SessionRecord,
  SessionResult
} from "./types.js";

export type RouteDependencies = {
  audioAdmission: AudioResourceAdmission;
  attemptDeadlines: AttemptDeadlineRegistry;
  attemptWork: AttemptWorkRegistry;
  bus: EventBus;
  outputs: OutputScheduler;
  pipelineRunner: typeof runAudioPipeline;
  receipts: ReceiptWriter;
  store: SessionStore;
};

export type ClaimedAudioAttemptOutcome =
  | {
      status: "completed" | "failed";
      events: SessionEvent[];
      errorCode?: string;
      errorMessage?: string;
    }
  | {
      status: "superseded";
      events: SessionEvent[];
    };

type RequestHandlerDependencies = Omit<
  RouteDependencies,
  | "audioAdmission"
  | "attemptDeadlines"
  | "attemptWork"
  | "outputs"
  | "pipelineRunner"
> & {
  audioAdmission?: AudioResourceAdmission;
  attemptDeadlines?: AttemptDeadlineRegistry;
  attemptWork?: AttemptWorkRegistry;
  outputs?: OutputScheduler;
  pipelineRunner?: typeof runAudioPipeline;
  allowedOrigins?: readonly string[];
  maxSseConnections?: number;
};

type ParsedBody = Record<string, unknown>;
type EventPatch = {
  type: string;
  source?: RuntimeSource;
  [key: string]: unknown;
};

type ReceiptPersistenceFailure = {
  status: "failed";
  code: "receipt_persistence_failed";
  eventType: SessionEvent["type"];
  sequence: number;
  message: string;
};

const maxBodyBytes = 64 * 1024;
const maxAudioBodyBytes = 12 * 1024 * 1024;
const allowedInputEventTypes = new Set([
  "input.recording.started",
  "input.recording.stopped",
  "session.error"
]);
const allowedDemoEventTypes = new Set([
  "input.recording.started",
  "input.recording.stopped",
  "session.silence",
  "session.reset",
  "session.error"
]);
const allowedDemoPayloadFields: Partial<
  Record<SessionEvent["type"], readonly string[]>
> = {
  "input.recording.started": ["monotonicMs"],
  "input.recording.stopped": ["monotonicMs", "durationMs"],
  "session.silence": ["monotonicMs", "durationMs"],
  "session.reset": ["monotonicMs"],
  "session.error": ["monotonicMs", "message", "code", "recoverable"]
};
const terminalSessionEventTypes = new Set<SessionEvent["type"]>([
  "session.result",
  "session.silence",
  "session.reset",
  "session.error"
]);
const receiptPersistenceFailures = new WeakMap<
  SessionRecord,
  ReceiptPersistenceFailure
>();

class SseAdmission {
  private activeConnections = 0;

  constructor(readonly maxConnections: number) {
    if (!Number.isSafeInteger(maxConnections) || maxConnections <= 0) {
      throw new Error("maxSseConnections must be a positive safe integer");
    }
  }

  get active(): number {
    return this.activeConnections;
  }

  acquire(): boolean {
    if (this.activeConnections >= this.maxConnections) {
      return false;
    }
    this.activeConnections += 1;
    return true;
  }

  release(): void {
    this.activeConnections -= 1;
    if (this.activeConnections < 0) {
      throw new Error("SSE admission counter underflow");
    }
  }
}

export function createRequestHandler(baseDependencies: RequestHandlerDependencies) {
  const {
    allowedOrigins: providedAllowedOrigins,
    maxSseConnections: providedMaxSseConnections,
    ...providedDependencies
  } = baseDependencies;
  const allowedOrigins = providedAllowedOrigins ?? configuredHttpAllowedOrigins();
  const sseAdmission = new SseAdmission(
    providedMaxSseConnections ?? configuredSseMaxConnections()
  );
  const dependencies: RouteDependencies = {
    ...providedDependencies,
    audioAdmission: providedDependencies.audioAdmission ?? new AudioResourceAdmission(),
    attemptDeadlines:
      providedDependencies.attemptDeadlines ?? new AttemptDeadlineRegistry(),
    attemptWork: providedDependencies.attemptWork ?? new AttemptWorkRegistry(),
    outputs: providedDependencies.outputs ?? new OutputScheduler(),
    pipelineRunner: providedDependencies.pipelineRunner ?? runAudioPipeline
  };

  return async function handleRequest(request: any, response: any): Promise<void> {
    try {
      if (!applyCors(request, response, allowedOrigins)) {
        sendJson(response, 403, { error: "Browser Origin is not allowed" });
        return;
      }

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      if (hasPercentEncodedDotPathSegment(request.url)) {
        sendJson(response, 400, {
          error: "Invalid sessionId path segment",
          code: "invalid_session_id"
        });
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      let pathSessionId: string | undefined;
      if (parts[0] === "sessions" && parts.length >= 2) {
        pathSessionId = decodeSessionPathSegment(parts[1]);
        if (!pathSessionId) {
          sendJson(response, 400, {
            error: "Invalid sessionId path segment",
            code: "invalid_session_id"
          });
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/health") {
        const diagnostics = await collectDiagnostics();
        sendJson(response, 200, {
          ok: true,
          service: "@jiko/server",
          mode: "local",
          uptimeSeconds: Math.round(process.uptime()),
          sessions: dependencies.store.listSessions().length,
          sessionCapacity: dependencies.store.capacity,
          sessionIdentityProtection: {
            mode: dependencies.receipts.enabled
              ? "retained_receipts"
              : "process_only",
            restartProtected: dependencies.receipts.enabled,
            ledgerCapacity: dependencies.store.identityLedgerCapacity
          },
          sseClients: dependencies.bus.listenerCount,
          sseAdmission: {
            active: sseAdmission.active,
            max: sseAdmission.maxConnections
          },
          receiptsEnabled: dependencies.receipts.enabled,
          audioAdmission: dependencies.audioAdmission.snapshot(),
          output: {
            idle: dependencies.outputs.idle,
            activeKey: dependencies.outputs.activeKey
          },
          providers: {
            stt: process.env.STT_PROVIDER || "local:stt-unconfigured",
            tts: process.env.TTS_PROVIDER || "local:tts-unconfigured"
          },
          diagnostics
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/events") {
        handleEvents(request, response, url, dependencies, sseAdmission);
        return;
      }

      if (request.method === "POST" && url.pathname === "/sessions") {
        await handleCreateSession(request, response, dependencies);
        return;
      }

      if (request.method === "GET" && parts.length === 2 && parts[0] === "sessions") {
        await handleGetSession(pathSessionId!, response, dependencies);
        return;
      }

      if (request.method === "GET" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "receipt") {
        await handleGetSessionReceipt(pathSessionId!, response, dependencies);
        return;
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "manual-transcript") {
        await handleManualTranscript(pathSessionId!, request, response, dependencies);
        return;
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "audio") {
        await handleAudioUpload(pathSessionId!, request, response, url, dependencies);
        return;
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "input-event") {
        await handleInputEvent(pathSessionId!, request, response, dependencies);
        return;
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "demo-event") {
        await handleDemoEvent(pathSessionId!, request, response, dependencies);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof JsonBodyError) {
        sendJson(response, error.statusCode, {
          error: error.message,
          code: error.code
        });
        return;
      }
      if (error instanceof AudioBodyTooLargeError) {
        sendJson(response, 413, {
          error: error.message,
          code: "audio_body_too_large"
        });
        return;
      }
      if (error instanceof AudioResourceCapacityError) {
        sendJson(response, 503, {
          error: error.message,
          code: error.resource.startsWith("ingress_")
            ? "audio_ingress_capacity_exceeded"
            : "audio_pipeline_capacity_exceeded",
          resource: error.resource
        });
        return;
      }
      if (error instanceof SessionCapacityError) {
        sendJson(response, 503, {
          error: error.message,
          code: error.code,
          maxSessions: error.maxSessions
        });
        return;
      }
      if (error instanceof SessionIdentityRetiredError) {
        response.setHeader(
          "retry-after",
          String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000)))
        );
        sendJson(response, 410, {
          error: error.message,
          code: error.code,
          sessionId: error.sessionId,
          retryAfterMs: error.retryAfterMs
        });
        return;
      }
      if (error instanceof SessionIdentityLedgerCapacityError) {
        sendJson(response, 503, {
          error: error.message,
          code: error.code,
          maxTombstones: error.maxTombstones
        });
        return;
      }
      if (error instanceof ReceiptIdentityReadError) {
        sendJson(response, 503, {
          error: error.message,
          code: error.code,
          sessionId: error.sessionId
        });
        return;
      }
      const message = error instanceof Error ? error.message : "Unexpected server error";
      sendJson(response, 500, { error: message });
    }
  };
}

async function handleCreateSession(request: any, response: any, dependencies: RouteDependencies): Promise<void> {
  const body = await readJsonBody(request, false);
  const requestBody = body ?? {};
  const hasRequestedSessionId = Object.prototype.hasOwnProperty.call(requestBody, "sessionId");
  const requestedSessionId = hasRequestedSessionId
    ? sanitizeSessionId(requestBody.sessionId)
    : undefined;
  const source = sourceValue(requestBody.source) ?? "server";

  if (hasRequestedSessionId && !requestedSessionId) {
    sendJson(response, 400, {
      error: "sessionId must be 1-96 characters using only letters, numbers, dot, underscore, colon, or hyphen"
    });
    return;
  }

  if (requestedSessionId) {
    const existingSession = dependencies.store.getSession(requestedSessionId);
    if (existingSession) {
      await sendExistingSessionReplay(
        existingSession,
        source,
        response,
        dependencies
      );
      return;
    }

    const persistedIdentity = await dependencies.receipts.lookupSessionIdentity(
      requestedSessionId
    );
    if (persistedIdentity) {
      sendJson(response, 410, {
        error: "Session identity belongs to a retained prior attempt",
        code: "session_identity_retired",
        sessionId: requestedSessionId,
        persistedAttemptId: persistedIdentity.attemptId,
        persistedAt: persistedIdentity.updatedAt,
        restartRecovered: true
      });
      return;
    }

    // Receipt lookup is asynchronous. Re-check the process-local owner so two
    // simultaneous creates cannot both pass the first lookup and diverge.
    const concurrentSession = dependencies.store.getSession(requestedSessionId);
    if (concurrentSession) {
      await sendExistingSessionReplay(
        concurrentSession,
        source,
        response,
        dependencies
      );
      return;
    }
  }

  const session = dependencies.store.createSession(
    requestedSessionId
      ? { sessionId: requestedSessionId, source }
      : { source }
  );
  dependencies.outputs.cancelActive(new Error("A newer session was created"));

  const event = await emitSessionEvent(dependencies, session, {
    type: "session.created",
    source: session.source,
  });

  sendJson(response, 201, {
    session,
    event
  });
}

async function sendExistingSessionReplay(
  session: SessionRecord,
  requestedSource: RuntimeSource,
  response: any,
  dependencies: RouteDependencies
): Promise<void> {
  if (session.source !== requestedSource) {
    sendJson(response, 409, {
      error: "Session already exists with a different source",
      sessionId: session.id,
      existingSource: session.source,
      requestedSource
    });
    return;
  }

  const existingCreatedEvent = session.events.find(
    (event) => event.type === "session.created"
  );
  const createdEvent: SessionEvent = existingCreatedEvent ??
    await emitSessionEvent(dependencies, session, {
      type: "session.created",
      source: session.source,
    });
  if (existingCreatedEvent) {
    // A previous non-terminal receipt write may have failed after the event
    // committed. An idempotent retry repairs that restart identity boundary.
    await dependencies.receipts.write(session);
  }

  sendJson(response, 200, {
    session,
    event: createdEvent,
    replayed: true
  });
}

async function handleGetSession(sessionId: string, response: any, dependencies: RouteDependencies): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  sendJson(response, 200, withReceiptPersistenceFailure(session, { session }));
}

async function handleGetSessionReceipt(sessionId: string, response: any, dependencies: RouteDependencies): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  sendJson(response, 200, buildSessionReceipt(session));
}

async function handleAudioUpload(
  sessionId: string,
  request: any,
  response: any,
  url: URL,
  dependencies: RouteDependencies
): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  if (!canSubmitAudio(session)) {
    sendSessionSealed(response, session, "audio upload");
    return;
  }

  const contentType = contentTypeValue(request.headers?.["content-type"]);
  if (!contentType || contentType.startsWith("application/json")) {
    sendJson(response, 415, {
      error: "Expected a raw audio request body",
      supportedContentTypes: ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4"]
    });
    return;
  }

  const remoteAudioConsent = remoteAudioConsentValue(request, url);
  if (remoteAudioConsent === null) {
    sendJson(response, 400, {
      error: "Remote audio consent must be exactly 'deepgram' when provided."
    });
    return;
  }

  // Browser/device stop normally owns the release-to-result anchor. Direct
  // audio callers have no stop event, so request acceptance is their fallback
  // anchor. ensure() preserves the earlier stop deadline when one exists.
  const ingressLease = dependencies.audioAdmission.beginIngress();
  const hadAttemptDeadline = Boolean(
    dependencies.attemptDeadlines.get(session.id, session.attemptId)
  );
  let attemptDeadline: AttemptDeadline | undefined;
  try {
    attemptDeadline = ensureAttemptDeadline(dependencies, session);
    const body = await readRawBody(
      request,
      maxAudioBodyBytes,
      ingressLease,
      attemptDeadline.signal
    );
    if (!attemptDeadlineAllowsCommit(dependencies, session, attemptDeadline)) {
      sendAttemptSuperseded(response, session);
      return;
    }
    if (body.byteLength === 0) {
      cancelRequestOwnedDeadline(
        dependencies,
        session.id,
        session.attemptId,
        hadAttemptDeadline,
        new Error("Empty audio upload was rejected")
      );
      sendJson(response, 400, { error: "Expected non-empty audio body" });
      return;
    }

    if (!dependencies.store.claimAttemptInput(session.id, session.attemptId, "audio")) {
      cancelRequestOwnedDeadline(
        dependencies,
        session.id,
        session.attemptId,
        hadAttemptDeadline,
        new Error("Audio upload lost the attempt input claim")
      );
      sendAttemptClaimConflict(response, session, "audio");
      return;
    }

    const durationMs = numberValue(url.searchParams.get("durationMs")) ?? numberValue(request.headers?.["x-audio-duration-ms"]);
    const monotonicMs = numberValue(url.searchParams.get("monotonicMs"));
    const source = sourceValue(url.searchParams.get("source")) ?? "browser";
    const uploadedAudio = {
      source,
      mediaType: contentType,
      byteSize: body.byteLength,
      durationMs
    };

    if (durationMs !== undefined && session.status === "recording") {
      await emitSessionEvent(dependencies, session, {
        type: "input.recording.stopped",
        source,
        monotonicMs,
        durationMs
      }, () => ensureAttemptDeadline(dependencies, session));
    }

    const outcome = await runClaimedAudioAttempt(dependencies, {
      session,
      source,
      mediaType: contentType,
      body,
      durationMs,
      remoteAudioConsent,
      attemptDeadline,
      uploadedAudio
    });
    if (outcome.status === "superseded") {
      sendAttemptSuperseded(response, session);
      return;
    }
    if (
      outcome.status === "failed" &&
      outcome.errorCode === "audio_pipeline_capacity_exceeded"
    ) {
      const currentSession = dependencies.store.getSession(sessionId);
      sendJson(response, 503, withReceiptPersistenceFailure(currentSession, {
        error: outcome.errorMessage,
        code: outcome.errorCode,
        session: currentSession,
        events: outcome.events
      }));
      return;
    }

    const currentSession = dependencies.store.getSession(sessionId);
    sendJson(response, 202, withReceiptPersistenceFailure(currentSession, {
      session: currentSession,
      events: outcome.events
    }));
  } catch (error) {
    if (attemptDeadline?.signal.aborted) {
      sendAttemptSuperseded(response, session);
      return;
    }
    if (
      error instanceof AudioBodyTooLargeError ||
      error instanceof AudioResourceCapacityError
    ) {
      cancelRequestOwnedDeadline(
        dependencies,
        session.id,
        session.attemptId,
        hadAttemptDeadline,
        error
      );
    }
    throw error;
  } finally {
    ingressLease.release();
  }
}

function cancelRequestOwnedDeadline(
  dependencies: RouteDependencies,
  sessionId: string,
  attemptId: string,
  deadlinePredatedRequest: boolean,
  reason: Error
): void {
  if (!deadlinePredatedRequest) {
    dependencies.attemptDeadlines.cancel(sessionId, attemptId, reason);
  }
}

/**
 * Runs the one canonical audio-to-result commit path after the caller has
 * claimed the attempt's audio input. HTTP batch upload and ordered PCM ingress
 * share this function so final-result arbitration cannot drift between them.
 */
export async function runClaimedAudioAttempt(
  dependencies: RouteDependencies,
  input: {
    session: SessionRecord;
    source: RuntimeSource;
    mediaType: string;
    body: Uint8Array;
    durationMs?: number;
    remoteAudioConsent?: RemoteAudioConsent;
    attemptDeadline?: AttemptDeadline;
    acceptedStreamingFinal?: StreamingSttFinal;
    uploadedAudio?: {
      source: RuntimeSource;
      mediaType: string;
      byteSize: number;
      durationMs?: number;
    };
  }
): Promise<ClaimedAudioAttemptOutcome> {
  const { session } = input;
  const attemptDeadline = input.attemptDeadline ??
    ensureAttemptDeadline(dependencies, session);
  const work = dependencies.attemptWork.begin(session.id, session.attemptId);
  let pipelineLease: AudioPipelineLease | undefined;
  const events: SessionEvent[] = [];
  const uploadedAudio = input.uploadedAudio ?? {
    source: input.source,
    mediaType: input.mediaType,
    byteSize: input.body.byteLength,
    durationMs: input.durationMs
  };

  try {
    assertAttemptMayCommit(dependencies, session, attemptDeadline, work.signal);
    pipelineLease = dependencies.audioAdmission.acquirePipeline(
      audioPipelineReservationBytes(input.body.byteLength)
    );
    dependencies.store.updateAnalysis(session.id, { uploadedAudio });
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "audio.uploaded",
        source: input.source,
        audio: uploadedAudio
      })
    );

    assertAttemptMayCommit(dependencies, session, attemptDeadline, work.signal);
    const admittedPipelineLease = pipelineLease;
    const admittedPipelineWork = Promise.resolve(
      dependencies.pipelineRunner({
        sessionId: session.id,
        source: input.source,
        mediaType: input.mediaType,
        body: input.body,
        durationMs: input.durationMs,
        signal: work.signal,
        remoteAudioConsent: input.remoteAudioConsent,
        acceptedStreamingFinal: input.acceptedStreamingFinal,
        sttDeadlineMs: attemptDeadline.expiresAtMs -
          configuredResultCommitReserveMs(attemptDeadline.timeoutMs)
      })
    );
    const admittedResourceSettlement = admittedPipelineWork.then(
      (result) => result.resourceSettlement ?? Promise.resolve(),
      () => undefined
    ).finally(() => {
      admittedPipelineLease.release();
    });
    void admittedResourceSettlement.catch((error) => {
      console.error(
        `[audio-admission] provider settlement failed for ${session.id}/${session.attemptId}: ` +
          errorMessage(error)
      );
    });
    // Once provider work exists, it owns the capacity lease until its actual
    // promise settles. An attempt deadline may detach a noncooperative adapter,
    // but must not advertise that its bytes/slot became available while that
    // adapter can still consume CPU, memory, or a model worker.
    pipelineLease = undefined;
    const pipeline = await raceWithAbort(
      admittedPipelineWork,
      work.signal
    );

    assertAttemptMayCommit(dependencies, session, attemptDeadline, work.signal);
    dependencies.store.updateAnalysis(session.id, {
      normalizedAudio: pipeline.normalizedAudio
    });
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "audio.normalized",
        source: input.source,
        audio: pipeline.normalizedAudio
      })
    );

    assertAttemptMayCommit(dependencies, session, attemptDeadline, work.signal);
    dependencies.store.updateAnalysis(session.id, {
      sttProviderReceipt: pipeline.sttProviderReceipt,
      transcript: pipeline.transcript
    });
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "audio.transcribed",
        source: input.source,
        transcript: pipeline.transcript
      })
    );

    assertAttemptMayCommit(dependencies, session, attemptDeadline, work.signal);
    dependencies.store.updateAnalysis(session.id, {
      features: pipeline.features
    });
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "audio.features.extracted",
        source: input.source,
        features: pipeline.features
      })
    );

    assertAttemptMayCommit(dependencies, session, attemptDeadline, work.signal);
    dependencies.store.updateAnalysis(session.id, {
      pipeline: pipeline.pipeline
    });
    await emitReadingsAndResult(
      dependencies,
      session,
      input.source,
      pipeline.readings,
      pipeline.result,
      events,
      { attemptDeadline, workSignal: work.signal }
    );
    return { status: "completed", events };
  } catch (error) {
    if (
      !attemptDeadlineAllowsCommit(dependencies, session, attemptDeadline) ||
      work.signal.aborted ||
      error instanceof SessionSupersededError ||
      !isAttemptOpen(dependencies, session)
    ) {
      return { status: "superseded", events };
    }

    if (error instanceof AudioPipelineError) {
      dependencies.store.updateAnalysis(session.id, {
        pipeline: error.pipeline
      });
    }

    const capacityError = error instanceof AudioResourceCapacityError
      ? error
      : undefined;
    if (capacityError) {
      dependencies.store.updateAnalysis(session.id, {
        pipeline: admissionFailureReceipt()
      });
    }

    const errorMessage = error instanceof Error
      ? error.message
      : "Audio pipeline failed";
    const errorCode = capacityError
      ? "audio_pipeline_capacity_exceeded"
      : "audio_pipeline_failed";
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "session.error",
        source: "server",
        message: errorMessage,
        code: errorCode,
        recoverable: true
      }, () => cancelAttemptAfterTerminal(dependencies, session, "session.error"))
    );
    return { status: "failed", events, errorCode, errorMessage };
  } finally {
    pipelineLease?.release();
    work.finish();
  }
}

async function handleInputEvent(
  sessionId: string,
  request: any,
  response: any,
  dependencies: RouteDependencies
): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  const body = await readJsonBody(request, true);
  const type = stringValue(body.type);
  const source = sourceValue(body.source);

  if (!type || !allowedInputEventTypes.has(type)) {
    sendJson(response, 400, {
      error: "Expected an input event",
      allowedTypes: [...allowedInputEventTypes]
    });
    return;
  }

  if (source !== "browser" && source !== "device") {
    sendJson(response, 400, { error: "Input event source must be browser or device" });
    return;
  }

  const eventType = type as SessionEvent["type"];
  const monotonicMs = numberValue(body.monotonicMs);
  const durationMs = eventType === "input.recording.stopped"
    ? numberValue(body.durationMs)
    : undefined;
  let errorMessage: string | undefined;
  let errorCode: string | undefined;
  let errorRecoverable: boolean | undefined;

  if (eventType === "session.error") {
    errorMessage = stringValue(body.message)?.trim();
    if (!errorMessage) {
      sendJson(response, 400, { error: "session.error requires a non-empty message" });
      return;
    }

    if (body.code !== undefined && typeof body.code !== "string") {
      sendJson(response, 400, { error: "session.error code must be a string when provided" });
      return;
    }

    if (body.recoverable !== undefined && typeof body.recoverable !== "boolean") {
      sendJson(response, 400, { error: "session.error recoverable must be a boolean when provided" });
      return;
    }

    errorCode = typeof body.code === "string" ? body.code : undefined;
    errorRecoverable = body.recoverable ?? true;
  }

  const replayedEvent = findReplayedInputEvent(
    session,
    eventType,
    source,
    monotonicMs,
    durationMs,
    errorMessage,
    errorCode,
    errorRecoverable
  );
  if (replayedEvent) {
    sendJson(response, 200, withReceiptPersistenceFailure(session, {
      session,
      event: replayedEvent,
      replayed: true
    }));
    return;
  }

  const existingInputClaim = dependencies.store.getAttemptInputClaim(
    session.id,
    session.attemptId
  );
  if (existingInputClaim) {
    sendJson(response, 409, {
      error: `Session attempt input is already owned by ${existingInputClaim}`,
      session
    });
    return;
  }

  if (!canAcceptExternalEvent(session.status, eventType)) {
    sendTransitionConflict(response, session, eventType);
    return;
  }

  const eventPatch: EventPatch = { type: eventType, source };
  if (monotonicMs !== undefined) {
    eventPatch.monotonicMs = monotonicMs;
  }
  if (eventType === "input.recording.stopped") {
    if (durationMs !== undefined) {
      eventPatch.durationMs = durationMs;
    }
  }

  if (eventType === "session.error") {
    eventPatch.message = errorMessage;
    if (errorCode !== undefined) {
      eventPatch.code = errorCode;
    }
    eventPatch.recoverable = errorRecoverable;
  }

  if (eventType === "input.recording.started") {
    dependencies.outputs.cancelActive(
      new Error("New recording started")
    );
  }
  const event = await emitSessionEvent(
    dependencies,
    session,
    eventPatch,
    eventType === "input.recording.stopped"
      ? () => ensureAttemptDeadline(dependencies, session)
      : eventType === "session.error"
        ? () => cancelAttemptAfterTerminal(dependencies, session, eventType)
        : undefined
  );
  const currentSession = dependencies.store.getSession(sessionId);
  sendJson(response, 200, withReceiptPersistenceFailure(currentSession, {
    session: currentSession,
    event
  }));
}

function findReplayedInputEvent(
  session: SessionRecord,
  eventType: SessionEvent["type"],
  source: RuntimeSource,
  monotonicMs: number | undefined,
  durationMs: number | undefined,
  errorMessage: string | undefined,
  errorCode: string | undefined,
  errorRecoverable: boolean | undefined
): SessionEvent | undefined {
  if (monotonicMs === undefined) {
    return undefined;
  }

  if (eventType === "session.error") {
    return session.events.find((event) =>
      event.type === "session.error" &&
      event.source === source &&
      event.monotonicMs === monotonicMs &&
      event.message === errorMessage &&
      event.code === errorCode &&
      event.recoverable === errorRecoverable
    );
  }

  if (
    (
      eventType !== "input.recording.started" &&
      eventType !== "input.recording.stopped"
    ) ||
    (eventType === "input.recording.stopped" && durationMs === undefined)
  ) {
    return undefined;
  }

  return session.events.find((event) => {
    if (
      event.type !== eventType ||
      event.source !== source ||
      event.monotonicMs !== monotonicMs
    ) {
      return false;
    }

    return eventType === "input.recording.started" ||
      (
        event.type === "input.recording.stopped" &&
        event.durationMs === durationMs
      );
  });
}

async function handleManualTranscript(
  sessionId: string,
  request: any,
  response: any,
  dependencies: RouteDependencies
): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  if (session.status !== "created") {
    sendSessionSealed(response, session, "manual transcript");
    return;
  }

  const body = await readJsonBody(request, true);
  const transcript = stringValue(body.transcript)?.trim();
  if (!transcript) {
    sendJson(response, 400, { error: "Expected non-empty JSON string field: transcript" });
    return;
  }

  if (transcript.length > 5000) {
    sendJson(response, 413, { error: "Transcript is too large for the mock route" });
    return;
  }

  const language = stringValue(body.language) ?? guessLanguage(transcript);
  if (!dependencies.store.claimAttemptInput(session.id, session.attemptId, "manual")) {
    sendAttemptClaimConflict(response, session, "manual");
    return;
  }
  let events: SessionEvent[];
  try {
    events = await runManualTranscriptLoop(dependencies, session, transcript, language, "manual");
  } catch (error) {
    if (error instanceof SessionSupersededError) {
      sendJson(response, 409, {
        error: error.message,
        sessionId: session.id,
        attemptId: session.attemptId
      });
      return;
    }
    throw error;
  }
  const currentSession = dependencies.store.getSession(sessionId);
  sendJson(response, 200, withReceiptPersistenceFailure(currentSession, {
    session: currentSession,
    events
  }));
}

async function handleDemoEvent(sessionId: string, request: any, response: any, dependencies: RouteDependencies): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  const body = await readJsonBody(request, true);
  const transcript = stringValue(body.transcript)?.trim();
  if (transcript) {
    if (session.status !== "created") {
      sendSessionSealed(response, session, "operator transcript");
      return;
    }
    if (!dependencies.store.claimAttemptInput(session.id, session.attemptId, "manual")) {
      sendAttemptClaimConflict(response, session, "manual");
      return;
    }
    const language = stringValue(body.language) ?? guessLanguage(transcript);
    let events: SessionEvent[];
    try {
      events = await runManualTranscriptLoop(
        dependencies,
        session,
        transcript,
        language,
        "operator"
      );
    } catch (error) {
      if (error instanceof SessionSupersededError) {
        sendJson(response, 409, {
          error: error.message,
          sessionId: session.id,
          attemptId: session.attemptId
        });
        return;
      }
      throw error;
    }
    const currentSession = dependencies.store.getSession(sessionId);
    sendJson(
      response,
      200,
      withReceiptPersistenceFailure(currentSession, {
        session: currentSession,
        events
      })
    );
    return;
  }

  const type = stringValue(body.type);
  if (!type || !allowedDemoEventTypes.has(type)) {
    sendJson(response, 400, {
      error: "Expected demo event type or transcript",
      allowedTypes: [...allowedDemoEventTypes]
    });
    return;
  }

  const eventType = type as SessionEvent["type"];
  const eventPatch = parseDemoEventPatch(eventType, body.payload, response);
  if (!eventPatch) {
    return;
  }
  if (!canAcceptExternalEvent(session.status, eventType)) {
    sendTransitionConflict(response, session, eventType);
    return;
  }

  const event = await emitSessionEvent(
    dependencies,
    session,
    eventPatch,
    eventType === "input.recording.stopped"
      ? () => ensureAttemptDeadline(dependencies, session)
      : eventType === "session.reset" || eventType === "session.error"
        ? () => cancelAttemptAfterTerminal(dependencies, session, eventType)
        : undefined
  );

  const currentSession = dependencies.store.getSession(sessionId);
  sendJson(response, 200, withReceiptPersistenceFailure(currentSession, {
    session: currentSession,
    event
  }));
}

function parseDemoEventPatch(
  eventType: SessionEvent["type"],
  rawPayload: unknown,
  response: any
): EventPatch | undefined {
  if (
    rawPayload !== undefined &&
    (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload))
  ) {
    sendJson(response, 400, { error: "Demo event payload must be a JSON object" });
    return undefined;
  }

  const payload = (rawPayload ?? {}) as Record<string, unknown>;
  const allowedFields = allowedDemoPayloadFields[eventType] ?? [];
  const unexpectedFields = Object.keys(payload).filter(
    (field) => !allowedFields.includes(field)
  );
  if (unexpectedFields.length > 0) {
    sendJson(response, 400, {
      error: "Demo event payload contains fields that are not allowed for this event type",
      eventType,
      allowedFields,
      unexpectedFields
    });
    return undefined;
  }

  const eventPatch: EventPatch = {
    type: eventType,
    source: "operator"
  };
  for (const field of ["monotonicMs", "durationMs"] as const) {
    const value = payload[field];
    if (value === undefined) {
      continue;
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      sendJson(response, 400, {
        error: `Demo event payload field ${field} must be a non-negative finite number`
      });
      return undefined;
    }
    eventPatch[field] = value;
  }

  if (eventType === "session.error") {
    if (payload.message !== undefined && typeof payload.message !== "string") {
      sendJson(response, 400, {
        error: "Demo session.error payload field message must be a string"
      });
      return undefined;
    }
    const message = typeof payload.message === "string"
      ? payload.message.trim()
      : "Operator demo error";
    if (!message) {
      sendJson(response, 400, {
        error: "Demo session.error payload field message must not be empty"
      });
      return undefined;
    }
    if (payload.code !== undefined && typeof payload.code !== "string") {
      sendJson(response, 400, {
        error: "Demo session.error payload field code must be a string"
      });
      return undefined;
    }
    if (
      payload.recoverable !== undefined &&
      typeof payload.recoverable !== "boolean"
    ) {
      sendJson(response, 400, {
        error: "Demo session.error payload field recoverable must be a boolean"
      });
      return undefined;
    }

    eventPatch.message = message;
    if (typeof payload.code === "string") {
      eventPatch.code = payload.code;
    }
    eventPatch.recoverable = payload.recoverable ?? true;
  }

  return eventPatch;
}

function sendTransitionConflict(
  response: any,
  session: SessionRecord,
  eventType: SessionEvent["type"]
): void {
  sendJson(response, 409, {
    error: "Event is not allowed in the current session state",
    sessionId: session.id,
    status: session.status,
    eventType
  });
}

function sendSessionSealed(
  response: any,
  session: SessionRecord,
  operation: string
): void {
  sendJson(response, 409, {
    error: `Session is sealed; cannot accept ${operation}`,
    sessionId: session.id,
    attemptId: session.attemptId,
    status: session.status,
    lastSequence: session.lastSequence
  });
}

function sendAttemptClaimConflict(
  response: any,
  session: SessionRecord,
  requestedInput: "audio" | "manual"
): void {
  sendJson(response, 409, {
    error: "Session attempt already has an input owner or is no longer claimable",
    sessionId: session.id,
    attemptId: session.attemptId,
    requestedInput,
    status: session.status,
    lastSequence: session.lastSequence
  });
}

function canSubmitAudio(session: SessionRecord): boolean {
  if (session.status === "created" || session.status === "recording") {
    return true;
  }

  return session.status === "processing" &&
    session.events.at(-1)?.type === "input.recording.stopped" &&
    !session.uploadedAudio;
}

async function runManualTranscriptLoop(
  dependencies: RouteDependencies,
  session: SessionRecord,
  transcript: string,
  language: string,
  source: RuntimeSource
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const features = buildMockFeatures(transcript);
  const transcriptResult = enhanceTranscript({
    text: transcript,
    language,
    provider: "local:manual",
    latencyMs: 0
  });
  const readings = buildReadings(
    transcriptResult.semanticText ?? transcript,
    language,
    features,
    undefined,
    "simulated:manual-transcript"
  );
  const result = buildResult(session.id, readings);

  assertAttemptOpen(dependencies, session);
  dependencies.store.updateAnalysis(session.id, { transcript: transcriptResult });
  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "audio.transcribed",
      source,
      transcript: transcriptResult
    })
  );

  assertAttemptOpen(dependencies, session);
  dependencies.store.updateAnalysis(session.id, { features });
  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "audio.features.extracted",
      source,
      features
    })
  );

  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "reading.started",
      source
    })
  );

  await emitReadingsAndResult(
    dependencies,
    session,
    source,
    readings,
    result,
    events,
    { emitStarted: false }
  );

  return events;
}

async function emitReadingsAndResult(
  dependencies: RouteDependencies,
  session: SessionRecord,
  source: RuntimeSource,
  readings: Reading[],
  result: SessionResult,
  events: SessionEvent[],
  options: {
    attemptDeadline?: AttemptDeadline;
    emitStarted?: boolean;
    workSignal?: AbortSignal;
  } = {}
): Promise<void> {
  if (options.emitStarted ?? true) {
    assertAttemptMayCommit(
      dependencies,
      session,
      options.attemptDeadline,
      options.workSignal
    );
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "reading.started",
        source
      })
    );
  }

  const resolvedReadings: Reading[] = [];
  assertAttemptMayCommit(
    dependencies,
    session,
    options.attemptDeadline,
    options.workSignal
  );
  dependencies.store.updateAnalysis(session.id, { readings: resolvedReadings });
  for (const reading of readings) {
    assertAttemptMayCommit(
      dependencies,
      session,
      options.attemptDeadline,
      options.workSignal
    );
    resolvedReadings.push(reading);
    dependencies.store.updateAnalysis(session.id, {
      readings: [...resolvedReadings]
    });
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "reading.channel.resolved",
        source,
        reading
      })
    );
  }

  assertAttemptMayCommit(
    dependencies,
    session,
    options.attemptDeadline,
    options.workSignal
  );
  dependencies.store.updateAnalysis(session.id, { result });
  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "session.result",
      source,
      result
    }, () => cancelAttemptDeadlineAfterResult(dependencies, session))
  );

  if (result.tts) {
    scheduleTtsOutput(dependencies, session, result.tts);
  }
}

function scheduleTtsOutput(
  dependencies: RouteDependencies,
  session: SessionRecord,
  tts: TtsRequest
): void {
  const key = `${session.id}:${session.attemptId}`;
  void dependencies.outputs.schedule(key, async (signal) => {
    try {
      await waitForTtsPacing(signal);
      assertAttemptOpen(dependencies, session);
      throwIfAborted(signal);
      await emitSessionEvent(dependencies, session, {
        type: "tts.started",
        source: "server",
        tts
      });

      const ttsOutput = await speakLocalResult(tts, signal);
      throwIfAborted(signal);
      assertAttemptOpen(dependencies, session);
      const ttsFinishedPatch: EventPatch = {
        type: "tts.finished",
        source: "server"
      };
      if (ttsOutput?.provider) {
        ttsFinishedPatch.provider = ttsOutput.provider;
      }
      await emitSessionEvent(dependencies, session, ttsFinishedPatch);
    } catch (error) {
      await emitTerminalTtsIfResultIsStillCurrent(
        dependencies,
        session,
        signal.aborted ? "local:tts:cancelled" : "local:tts:failed"
      );
      throw error;
    }
  }).then(reportOutputOutcome);
}

async function emitTerminalTtsIfResultIsStillCurrent(
  dependencies: RouteDependencies,
  expected: SessionRecord,
  providerId: string
): Promise<void> {
  const current = dependencies.store.getSession(expected.id);
  if (
    !current ||
    current.attemptId !== expected.attemptId ||
    current.status !== "result" ||
    !current.events.some((event) => event.type === "tts.started") ||
    current.events.some((event) => event.type === "tts.finished")
  ) {
    return;
  }

  await emitSessionEvent(dependencies, current, {
    type: "tts.finished",
    source: "server",
    provider: {
      id: providerId,
      remote: false
    }
  });
}

function reportOutputOutcome(outcome: OutputTaskOutcome): void {
  if (outcome.status === "failed") {
    console.error(`Output task ${outcome.key} failed`, outcome.error);
  }
}

async function waitForTtsPacing(signal: AbortSignal): Promise<void> {
  const configuredMs =
    numberValue(process.env.TTS_AFTER_RESULT_DELAY_MS) ??
    numberValue(process.env.RESULT_REVEAL_MS) ??
    0;
  const delayMs = Math.min(configuredMs, 15_000);

  if (delayMs === 0) {
    throwIfAborted(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function raceWithAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Output task was cancelled");
}

async function readRawBody(
  request: any,
  byteLimit: number,
  ingressLease: AudioIngressLease,
  signal: AbortSignal
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  const iterator = request[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await raceWithAbort(
        Promise.resolve(iterator.next()),
        signal
      );
      if (next.done) {
        break;
      }
      const buffer = toUint8Array(next.value);
      if (buffer.byteLength > byteLimit - totalBytes) {
        throw new AudioBodyTooLargeError(
          `Audio body exceeds the ${byteLimit} byte per-request limit`
        );
      }
      // Retaining the source chunks and then joining them into one contiguous
      // request body creates a bounded two-copy peak. Account for both copies
      // before retaining the chunk so the advertised ingress ceiling is a real
      // memory ceiling rather than only the final payload size.
      ingressLease.reserve(buffer.byteLength * 2);
      totalBytes += buffer.byteLength;
      chunks.push(buffer);
    }
  } catch (error) {
    if (signal.aborted) {
      // Stop accepting transport bytes as soon as the immutable attempt is
      // sealed. The pending iterator promise remains observed by raceWithAbort,
      // so a late stream completion cannot become an unhandled rejection.
      request.destroy?.();
    }
    throw error;
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

class AudioBodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioBodyTooLargeError";
  }
}

function admissionFailureReceipt(): PipelineReceipt {
  const timestamp = new Date().toISOString();
  return {
    startedAt: timestamp,
    finishedAt: timestamp,
    totalLatencyMs: 0,
    stages: [{
      stage: "total",
      status: "failed",
      latencyMs: 0,
      provider: "jiko:audio-admission-v1"
    }]
  };
}

export async function emitSessionEvent(
  dependencies: RouteDependencies,
  session: SessionRecord,
  eventPatch: EventPatch,
  afterCommit?: () => void
): Promise<SessionEvent> {
  const event = parseSessionEvent({
    ...eventPatch,
    sessionId: session.id,
    attemptId: session.attemptId,
    sequence: session.lastSequence + 1,
    timestamp: Date.now(),
    type: eventPatch.type,
    source: eventPatch.source
  });

  const updated = dependencies.store.addEvent(event);
  afterCommit?.();
  dependencies.bus.publish(event);
  if (updated) {
    try {
      await dependencies.receipts.write(updated);
      receiptPersistenceFailures.delete(updated);
    } catch (error) {
      if (!terminalSessionEventTypes.has(event.type)) {
        throw error;
      }

      receiptPersistenceFailures.set(updated, {
        status: "failed",
        code: "receipt_persistence_failed",
        eventType: event.type,
        sequence: event.sequence,
        message: "The terminal event committed, but its receipt snapshot was not persisted."
      });
      console.error(
        `[receipts] terminal snapshot write failed for ${event.sessionId}/${event.attemptId} ` +
          `${event.type}#${event.sequence}: ${errorMessage(error)}`
      );
    }
  }

  return event;
}

function withReceiptPersistenceFailure<T extends Record<string, unknown>>(
  session: SessionRecord | undefined,
  body: T
): T & { receiptPersistenceFailure?: ReceiptPersistenceFailure } {
  if (!session) {
    return body;
  }

  const failure = receiptPersistenceFailures.get(session);
  return failure ? { ...body, receiptPersistenceFailure: failure } : body;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}

function handleEvents(
  request: any,
  response: any,
  url: URL,
  dependencies: RouteDependencies,
  admission: SseAdmission
): void {
  const requestedSessionId = url.searchParams.get("sessionId");
  const sessionId = requestedSessionId === null
    ? undefined
    : sanitizeSessionId(requestedSessionId);

  if (requestedSessionId !== null && !sessionId) {
    sendJson(response, 400, { error: "Invalid sessionId query parameter" });
    return;
  }

  if (sessionId && !dependencies.store.getSession(sessionId)) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  if (!admission.acquire()) {
    sendJson(response, 503, {
      error: `SSE connection capacity (${admission.maxConnections}) was exceeded`,
      code: "sse_capacity_exceeded",
      maxConnections: admission.maxConnections
    });
    return;
  }

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    unsubscribe?.();
    admission.release();
    response.end?.();
  };

  try {
    response.writeHead(200, {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream"
    });
  } catch (error) {
    closed = true;
    admission.release();
    throw error;
  }

  if (!writeSse(response, {
    type: "server.connected",
    timestamp: Date.now(),
    sessionCount: dependencies.store.listSessions().length,
    sessionId
  })) {
    close();
    return;
  }

  unsubscribe = dependencies.bus.subscribe((event) => {
    if (sessionId && event.sessionId !== sessionId) {
      return;
    }
    if (!writeSse(response, event)) {
      close();
    }
  });

  const replaySession = sessionId
    ? dependencies.store.getSession(sessionId)
    : dependencies.store.listSessions().at(-1);
  const replayAfterSequence = replayCursorSequence(
    request.headers?.["last-event-id"],
    replaySession?.attemptId
  );
  for (const event of replaySession?.events ?? []) {
    if (event.sequence > replayAfterSequence) {
      if (!writeSse(response, event)) {
        close();
        return;
      }
    }
  }

  heartbeat = setInterval(() => {
    if (!response.write(": keep-alive\n\n")) {
      close();
    }
  }, 20000);
  heartbeat.unref?.();

  request.on("close", close);
  response.on?.("close", close);
  response.on?.("error", close);
}

function writeSse(
  response: any,
  event: SessionEvent | { type: string; timestamp: number; [key: string]: unknown }
): boolean {
  let frame = "";
  if ("attemptId" in event && "sequence" in event) {
    frame += `id: ${event.attemptId}:${event.sequence}\n`;
  }
  frame += `event: ${event.type}\n`;
  frame += `data: ${JSON.stringify(event)}\n\n`;
  try {
    return response.write(frame);
  } catch {
    return false;
  }
}

function replayCursorSequence(value: unknown, expectedAttemptId?: string): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !expectedAttemptId) {
    return 0;
  }

  const separator = raw.lastIndexOf(":");
  if (separator <= 0 || raw.slice(0, separator) !== expectedAttemptId) {
    return 0;
  }

  const sequence = Number(raw.slice(separator + 1));
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : 0;
}

class SessionSupersededError extends Error {}

export function ensureAttemptDeadline(
  dependencies: RouteDependencies,
  session: SessionRecord
): AttemptDeadline {
  return dependencies.attemptDeadlines.ensure(
    session.id,
    session.attemptId,
    performance.now(),
    (error) => sealAttemptAfterDeadline(dependencies, session, error)
  );
}

function sealAttemptAfterDeadline(
  dependencies: RouteDependencies,
  expected: SessionRecord,
  error: SessionDeadlineExceededError
): void | Promise<void> {
  const current = dependencies.store.getSession(expected.id);
  if (
    !current ||
    current.attemptId !== expected.attemptId ||
    current.status === "result" ||
    current.status === "silence" ||
    current.status === "reset" ||
    current.status === "error"
  ) {
    return;
  }

  return emitSessionEvent(dependencies, current, {
    type: "session.error",
    source: "server",
    message: `Analysis exceeded the ${error.timeoutMs} ms session deadline.`,
    code: "analysis_deadline_exceeded",
    recoverable: true
  }, () => cancelAttemptAfterTerminal(
    dependencies,
    current,
    "session.error",
    error
  )).then(() => undefined);
}

function attemptDeadlineAllowsCommit(
  dependencies: RouteDependencies,
  expected: SessionRecord,
  deadline: AttemptDeadline
): boolean {
  const expired = dependencies.attemptDeadlines.expireIfDue(
    expected.id,
    expected.attemptId
  );
  return !expired && !deadline.signal.aborted && isAttemptOpen(dependencies, expected);
}

function isAttemptOpen(
  dependencies: RouteDependencies,
  expected: SessionRecord
): boolean {
  const current = dependencies.store.getSession(expected.id);
  return Boolean(
    current &&
    current.attemptId === expected.attemptId &&
    current.status !== "reset" &&
    current.status !== "error"
  );
}

function assertAttemptOpen(
  dependencies: RouteDependencies,
  expected: SessionRecord
): SessionRecord {
  const current = dependencies.store.getSession(expected.id);
  if (!current || !isAttemptOpen(dependencies, expected)) {
    throw new SessionSupersededError(
      `Session attempt ${expected.id}/${expected.attemptId} is no longer active`
    );
  }

  return current;
}

function assertAttemptMayCommit(
  dependencies: RouteDependencies,
  expected: SessionRecord,
  deadline?: AttemptDeadline,
  workSignal?: AbortSignal
): SessionRecord {
  if (deadline && !attemptDeadlineAllowsCommit(dependencies, expected, deadline)) {
    if (deadline.signal.aborted) {
      throw abortReason(deadline.signal);
    }
    throw new SessionSupersededError(
      `Session attempt ${expected.id}/${expected.attemptId} exceeded its deadline`
    );
  }
  if (workSignal) {
    throwIfAborted(workSignal);
  }
  return assertAttemptOpen(dependencies, expected);
}

function sendAttemptSuperseded(response: any, expected: SessionRecord): void {
  sendJson(response, 409, {
    error: `Session attempt ${expected.id}/${expected.attemptId} is no longer active`,
    sessionId: expected.id,
    attemptId: expected.attemptId
  });
}

export function cancelAttemptAfterTerminal(
  dependencies: RouteDependencies,
  session: SessionRecord,
  eventType: "session.reset" | "session.error",
  cancellationReason?: Error
): void {
  const reason = cancellationReason ??
    new Error(`Session attempt stopped by ${eventType}`);
  dependencies.attemptDeadlines.cancel(session.id, session.attemptId, reason);
  dependencies.attemptWork.cancel(session.id, session.attemptId, reason);
  dependencies.outputs.cancel(`${session.id}:${session.attemptId}`, reason);
}

function cancelAttemptDeadlineAfterResult(
  dependencies: RouteDependencies,
  session: SessionRecord
): void {
  dependencies.attemptDeadlines.cancel(
    session.id,
    session.attemptId,
    new Error("Session result committed before its deadline")
  );
}

async function readJsonBody(request: any, requireBody: true): Promise<ParsedBody>;
async function readJsonBody(request: any, requireBody: false): Promise<ParsedBody | undefined>;
async function readJsonBody(request: any, requireBody: boolean): Promise<ParsedBody | undefined> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const bytes = toUint8Array(chunk);
    if (bytes.byteLength > maxBodyBytes - totalBytes) {
      throw new JsonBodyError(
        "Request body is too large",
        413,
        "json_body_too_large"
      );
    }
    totalBytes += bytes.byteLength;
    chunks.push(bytes);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let decoded: string;
  try {
    // Decode only after all raw chunks have been joined so a UTF-8 code point
    // split at a transport boundary is preserved. Fatal mode rejects invalid
    // byte sequences instead of silently replacing them with U+FFFD.
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new JsonBodyError(
      "Request body must be valid UTF-8",
      400,
      "invalid_json_utf8"
    );
  }

  const raw = decoded.trim();
  if (!raw) {
    if (requireBody) {
      throw new Error("Expected a JSON body");
    }
    return undefined;
  }

  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object body");
  }

  return value as ParsedBody;
}

class JsonBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413,
    readonly code: "invalid_json_utf8" | "json_body_too_large"
  ) {
    super(message);
    this.name = "JsonBodyError";
  }
}

function decodeSessionPathSegment(value: string): string | undefined {
  try {
    // URL.pathname retains percent escapes. Decode exactly this path segment
    // once, then apply the same allowlist used when sessions are created.
    return sanitizeSessionId(decodeURIComponent(value));
  } catch {
    return undefined;
  }
}

function hasPercentEncodedDotPathSegment(rawUrl: unknown): boolean {
  if (typeof rawUrl !== "string") {
    return false;
  }

  // WHATWG URL parsing removes percent-encoded `.` and `..` path segments.
  // Inspect the request target first so validation cannot be bypassed by that
  // normalization (for example `/sessions/%2e%2e/sessions`).
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  return rawPath.split("/").some((segment) =>
    /%2e/i.test(segment) && /^(?:\.|%2e){1,2}$/i.test(segment)
  );
}

function applyCors(
  request: any,
  response: any,
  allowedOrigins: readonly string[]
): boolean {
  const rawOrigin = request.headers?.origin;
  if (rawOrigin === undefined) {
    return true;
  }
  if (
    typeof rawOrigin !== "string" ||
    !allowedOrigins.includes(rawOrigin)
  ) {
    return false;
  }

  response.setHeader("access-control-allow-origin", rawOrigin);
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader(
    "access-control-allow-headers",
    "content-type,x-audio-duration-ms,x-jiko-remote-audio-consent"
  );
  return true;
}

function configuredHttpAllowedOrigins(): readonly string[] {
  const configured = process.env.JIKO_HTTP_ALLOWED_ORIGINS;
  if (configured?.trim()) {
    const origins = configured
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length > 0) {
      return origins;
    }
  }
  return [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173"
  ];
}

function configuredSseMaxConnections(): number {
  const configured = process.env.JIKO_SSE_MAX_CONNECTIONS;
  if (configured === undefined) {
    return 32;
  }
  const raw = configured.trim();
  const parsed = Number(raw);
  if (!raw || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("JIKO_SSE_MAX_CONNECTIONS must be a positive safe integer");
  }
  return parsed;
}

function sendJson(response: any, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function contentTypeValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }

  return raw.split(";")[0]?.trim().toLowerCase() || undefined;
}

function remoteAudioConsentValue(
  request: any,
  url: URL
): RemoteAudioConsent | null | undefined {
  const queryValues = url.searchParams.getAll("remoteAudioConsent");
  const headerValue = request.headers?.["x-jiko-remote-audio-consent"];
  if (queryValues.length > 1 || Array.isArray(headerValue)) {
    return null;
  }

  const values = [queryValues[0], headerValue].filter(
    (value): value is string => value !== undefined
  );
  if (values.length === 0) {
    return undefined;
  }

  return values.every((value) => value === "deepgram")
    ? "deepgram"
    : null;
}

function toUint8Array(value: unknown): Uint8Array {
  const buffer = Buffer.isBuffer(value) || value instanceof Uint8Array ? value : Buffer.from(String(value));
  const bytes = buffer as unknown as { length: number; [index: number]: number };
  const output = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes[index];
  }

  return output;
}

function numberValue(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || raw === null || raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function sourceValue(value: unknown): RuntimeSource | undefined {
  if (
    value === "browser" ||
    value === "device" ||
    value === "operator" ||
    value === "server" ||
    value === "manual"
  ) {
    return value;
  }

  return undefined;
}


function guessLanguage(transcript: string): string {
  return /[\u3400-\u9fff]/.test(transcript) ? "zh" : "en";
}
