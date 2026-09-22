import { createHash, type Hash } from "node:crypto";
import {
  mkdtemp,
  open,
  rm,
  type FileHandle
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_ORDERED_PCM_BINARY_METADATA_BYTES,
  MAX_ORDERED_PCM_CHUNK_BYTES,
  ORDERED_PCM_BINARY_FIXED_HEADER_BYTES,
  ORDERED_PCM_PROTOCOL_VERSION,
  OrderedPcmAckSchema,
  OrderedPcmErrorSchema,
  applyOrderedPcmIngressMessage,
  canonicalizeOrderedPcmProfile,
  createOrderedPcmIngressState,
  decodeOrderedPcmBinaryEnvelope,
  orderedPcmIngressReceiptFromState,
  type OrderedPcmErrorCode,
  type OrderedPcmIdentity,
  type OrderedPcmIngressMessage,
  type OrderedPcmIngressReceipt,
  type OrderedPcmIngressState,
  type OrderedPcmStart
} from "@jiko/protocol";
import WebSocket, {
  WebSocketServer,
  type RawData
} from "ws";
import {
  AudioResourceCapacityError,
  type AudioIngressLease
} from "./audioResourceAdmission.js";
import {
  configuredResultCommitReserveMs,
  configuredSessionDeadlineMs
} from "./attemptDeadline.js";
import {
  cancelAttemptAfterTerminal,
  emitSessionEvent,
  ensureAttemptDeadline,
  runClaimedAudioAttempt,
  type RouteDependencies
} from "./routes.js";
import { sanitizeSessionId } from "./sessionStore.js";
import {
  type StreamingSttAttempt,
  type StreamingSttObserverPartial,
  type StreamingSttScheduler
} from "./streamingStt.js";
import type { RuntimeSource, SessionRecord } from "./types.js";

export const ORDERED_PCM_WS_SUBPROTOCOL = "jiko.ordered-pcm.v1";

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173"
] as const;
const defaultMaxSpoolBytes = 12 * 1024 * 1024;
const defaultMaxWalBytes = 4 * 1024 * 1024;
const defaultMaxChunks = 12_000;
const defaultCaptureTimeoutMs = 120_000;
const defaultStartTimeoutMs = 10_000;
const defaultMaxConnections = 8;
const maxSourceClockDriftMs = 120;
const maxWebSocketPayloadBytes =
  ORDERED_PCM_BINARY_FIXED_HEADER_BYTES +
  MAX_ORDERED_PCM_BINARY_METADATA_BYTES +
  MAX_ORDERED_PCM_CHUNK_BYTES;
const pcmWaveHeaderBytes = 44;

export type OrderedPcmWebSocketOptions = {
  allowedOrigins?: readonly string[];
  captureTimeoutMs?: number;
  startTimeoutMs?: number;
  maxConnections?: number;
  maxChunks?: number;
  maxSpoolBytes?: number;
  maxWalBytes?: number;
  spoolRoot?: string;
  /**
   * Experimental provider-neutral streaming primary. Production composition
   * does not inject one yet, so the existing post-stop batch path is unchanged.
   * When injected, failure is terminal instead of a silent batch fallback.
   */
  streamingStt?: {
    scheduler: StreamingSttScheduler;
    onPartial?(partial: StreamingSttObserverPartial): void;
    onObserverError?(error: unknown): void;
  };
};

type ResolvedOrderedPcmWebSocketOptions = Required<
  Omit<OrderedPcmWebSocketOptions, "streamingStt">
> & Pick<OrderedPcmWebSocketOptions, "streamingStt">;

export type OrderedPcmWebSocketRuntime = {
  close(): Promise<void>;
};

/**
 * Attaches the ordered PCM transport to an existing HTTP server. The server
 * stays authoritative for session/attempt ownership; a successful WebSocket
 * handshake does not claim an attempt until a valid audio.start is received.
 */
export function attachOrderedPcmWebSocketServer(
  server: any,
  dependencies: RouteDependencies,
  options: OrderedPcmWebSocketOptions = {}
): OrderedPcmWebSocketRuntime {
  const allowedOrigins = new Set(
    options.allowedOrigins ?? configuredAllowedOrigins()
  );
  const resolvedOptions: ResolvedOrderedPcmWebSocketOptions = {
    allowedOrigins: [...allowedOrigins],
    captureTimeoutMs: positiveInteger(
      options.captureTimeoutMs,
      configuredPositiveInteger("JIKO_ORDERED_PCM_CAPTURE_TIMEOUT_MS") ??
        defaultCaptureTimeoutMs
    ),
    startTimeoutMs: positiveInteger(
      options.startTimeoutMs,
      configuredPositiveInteger("JIKO_ORDERED_PCM_START_TIMEOUT_MS") ??
        defaultStartTimeoutMs
    ),
    maxConnections: positiveInteger(
      options.maxConnections,
      configuredPositiveInteger("JIKO_ORDERED_PCM_MAX_CONNECTIONS") ??
        defaultMaxConnections
    ),
    maxChunks: positiveInteger(
      options.maxChunks,
      configuredPositiveInteger("JIKO_ORDERED_PCM_MAX_CHUNKS") ??
        defaultMaxChunks
    ),
    maxSpoolBytes: positiveInteger(
      options.maxSpoolBytes,
      configuredPositiveInteger("JIKO_ORDERED_PCM_MAX_SPOOL_BYTES") ??
        defaultMaxSpoolBytes
    ),
    maxWalBytes: positiveInteger(
      options.maxWalBytes,
      configuredPositiveInteger("JIKO_ORDERED_PCM_MAX_WAL_BYTES") ??
        defaultMaxWalBytes
    ),
    spoolRoot: options.spoolRoot ?? tmpdir(),
    streamingStt: options.streamingStt
  };
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: maxWebSocketPayloadBytes,
    perMessageDeflate: false,
    clientTracking: true,
    handleProtocols(protocols) {
      return protocols.has(ORDERED_PCM_WS_SUBPROTOCOL)
        ? ORDERED_PCM_WS_SUBPROTOCOL
        : false;
    }
  });
  const actors = new Set<OrderedPcmConnectionActor>();
  let accepting = true;

  const handleUpgrade = (request: any, socket: any, head: Buffer) => {
    if (!accepting) {
      rejectUpgrade(socket, 503, "Ordered PCM ingress is shutting down");
      return;
    }
    if (actors.size >= resolvedOptions.maxConnections) {
      rejectUpgrade(socket, 503, "Ordered PCM connection capacity was exceeded");
      return;
    }

    const target = parseAudioStreamTarget(request.url);
    if (!target) {
      rejectUpgrade(socket, 404, "Not found");
      return;
    }

    const origin = singleHeaderValue(request.headers?.origin);
    if (!origin || !allowedOrigins.has(origin)) {
      rejectUpgrade(socket, 403, "Origin is not allowed");
      return;
    }

    const protocols = commaSeparatedHeaderValues(
      request.headers?.["sec-websocket-protocol"]
    );
    if (
      protocols.length !== 1 ||
      protocols[0] !== ORDERED_PCM_WS_SUBPROTOCOL
    ) {
      rejectUpgrade(
        socket,
        426,
        "The jiko.ordered-pcm.v1 subprotocol is required",
        { "sec-websocket-protocol": ORDERED_PCM_WS_SUBPROTOCOL }
      );
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      const actor = new OrderedPcmConnectionActor(
        webSocket,
        target.sessionId,
        dependencies,
        resolvedOptions,
        () => actors.delete(actor)
      );
      actors.add(actor);
      actor.start();
    });
  };

  server.on("upgrade", handleUpgrade);

  return {
    async close() {
      if (!accepting) {
        return;
      }
      accepting = false;
      server.off("upgrade", handleUpgrade);
      await Promise.all([...actors].map((actor) => actor.shutdown()));
      await new Promise<void>((resolve) => {
        webSocketServer.close(() => resolve());
      });
    }
  };
}

class OrderedPcmConnectionActor {
  private state: OrderedPcmIngressState = createOrderedPcmIngressState();
  private taskTail: Promise<void> = Promise.resolve();
  private pcmFile?: FileHandle;
  private walFile?: FileHandle;
  private spoolDirectory?: string;
  private sourceHash?: Hash;
  private startMessage?: OrderedPcmStart;
  private source?: RuntimeSource;
  private spoolLease?: AudioIngressLease;
  private walBytes = 0;
  private captureTimer?: ReturnType<typeof setTimeout>;
  private streamingSttAttempt?: StreamingSttAttempt;
  private terminal = false;
  private cleanupStarted?: Promise<void>;

  constructor(
    private readonly webSocket: WebSocket,
    private readonly pathSessionId: string,
    private readonly dependencies: RouteDependencies,
    private readonly options: ResolvedOrderedPcmWebSocketOptions,
    private readonly onClosed: () => void
  ) {}

  start(): void {
    this.armStartTimeout();
    this.webSocket.on("message", (data, isBinary) => {
      if (this.terminal) {
        return;
      }
      this.webSocket.pause();
      this.enqueue(async () => {
        await this.handleWireMessage(data, isBinary);
      });
    });
    this.webSocket.on("close", () => {
      this.enqueue(async () => {
        if (!this.terminal && this.state.phase !== "stopped") {
          await this.fail({
            code: "transport_closed",
            message: "Ordered PCM transport closed before audio.stop",
            sessionErrorCode: "ordered_pcm_transport_closed",
            sealSession: this.state.phase === "open",
            sendBeforeClose: false
          });
        } else {
          await this.cleanup();
        }
        this.onClosed();
      });
    });
    this.webSocket.on("error", (error) => {
      console.error("Ordered PCM WebSocket error", error);
    });
  }

  shutdown(): Promise<void> {
    if (!this.terminal) {
      this.enqueue(async () => {
        await this.fail({
          code: "transport_closed",
          message: "Ordered PCM ingress is shutting down",
          sessionErrorCode: "ordered_pcm_transport_closed",
          sealSession: this.state.phase === "open"
        });
      });
    }
    return this.taskTail.finally(() => {
      this.webSocket.terminate();
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.taskTail = this.taskTail
      .then(task)
      .catch((error) => this.handleUnexpectedFailure(error))
      .finally(() => {
        if (
          this.webSocket.readyState === WebSocket.OPEN ||
          this.webSocket.readyState === WebSocket.CLOSING
        ) {
          this.webSocket.resume();
        }
      });
  }

  private async handleWireMessage(
    rawData: RawData,
    isBinary: boolean
  ): Promise<void> {
    if (!isBinary) {
      await this.fail({
        code: "wire_error",
        message: "Ordered PCM ingress accepts binary envelopes only",
        sessionErrorCode: "ordered_pcm_wire_error",
        sealSession: this.state.phase === "open"
      });
      return;
    }

    let message: OrderedPcmIngressMessage;
    try {
      message = decodeOrderedPcmBinaryEnvelope(rawDataToUint8Array(rawData));
    } catch (error) {
      await this.fail({
        code: "wire_error",
        message: error instanceof Error ? error.message : "Invalid ordered PCM envelope",
        sessionErrorCode: "ordered_pcm_wire_error",
        sealSession: this.state.phase === "open"
      });
      return;
    }

    if (message.sessionId !== this.pathSessionId) {
      await this.failForMessage(
        message,
        "identity_mismatch",
        "audio message sessionId does not match the WebSocket path",
        this.state.phase === "open"
      );
      return;
    }

    if (message.type === "audio.start") {
      await this.handleStart(message);
      return;
    }
    if (message.type === "audio.chunk") {
      await this.handleChunk(message);
      return;
    }
    await this.handleStop(message);
  }

  private async handleStart(message: OrderedPcmStart): Promise<void> {
    const transition = applyOrderedPcmIngressMessage(this.state, message);
    if (!transition.accepted) {
      await this.failForMessage(
        message,
        transition.code,
        transition.message,
        this.state.phase === "open" || Boolean(this.startMessage)
      );
      return;
    }

    const expectedProfileHash = sha256Hex(
      new TextEncoder().encode(canonicalizeOrderedPcmProfile(message.pcmProfile))
    );
    if (message.audioProfileHash !== expectedProfileHash) {
      await this.failForMessage(
        message,
        "profile_hash_mismatch",
        "audioProfileHash does not match pcmProfile",
        false
      );
      return;
    }

    const session = this.dependencies.store.getSession(message.sessionId);
    if (!session) {
      await this.failForMessage(
        message,
        "session_not_found",
        "Session not found",
        false
      );
      return;
    }
    if (session.attemptId !== message.attemptId) {
      await this.failForMessage(
        message,
        "attempt_mismatch",
        "audio.start attemptId does not match the active session attempt",
        false
      );
      return;
    }
    if (
      session.status !== "created" ||
      (session.source !== "browser" && session.source !== "device")
    ) {
      await this.failForMessage(
        message,
        "session_sealed",
        "Session is not claimable for ordered PCM input",
        false
      );
      return;
    }
    if (
      !this.dependencies.store.claimAttemptInput(
        session.id,
        session.attemptId,
        "audio"
      )
    ) {
      await this.failForMessage(
        message,
        "input_claim_conflict",
        "Session attempt already has an input owner",
        false
      );
      return;
    }

    this.startMessage = message;
    this.source = session.source;
    this.sourceHash = createHash("sha256");
    try {
      this.spoolLease = this.dependencies.audioAdmission.beginIngress();
      await this.openSpool();
      await this.appendWal({
        type: message.type,
        protocolVersion: message.protocolVersion,
        sessionId: message.sessionId,
        attemptId: message.attemptId,
        sourceId: message.sourceId,
        audioProfileHash: message.audioProfileHash,
        sourceMonotonicMs: message.sourceMonotonicMs,
        pcmProfile: message.pcmProfile
      });
      await emitSessionEvent(this.dependencies, session, {
        type: "input.recording.started",
        source: session.source,
        monotonicMs: message.sourceMonotonicMs
      });
    } catch (error) {
      const capacityError = error instanceof AudioResourceCapacityError;
      if (!capacityError) {
        console.error("Could not initialize ordered PCM spool", error);
      }
      await this.fail({
        code: capacityError ? "capacity_exceeded" : "internal_error",
        message: capacityError
          ? error.message
          : "Could not initialize ordered PCM spool",
        sessionErrorCode: capacityError
          ? "ordered_pcm_global_capacity_exceeded"
          : "ordered_pcm_spool_failed",
        sealSession: true,
        messageIdentity: message
      });
      return;
    }

    this.state = transition.state;
    try {
      this.streamingSttAttempt = this.options.streamingStt?.scheduler.open({
        identity: streamingIdentity(message),
        pcmProfile: message.pcmProfile,
        expiresAtMs:
          performance.now() +
          this.options.captureTimeoutMs +
          configuredSessionDeadlineMs(),
        // ordered_pcm_v1 has no remote-audio consent field. This integration
        // seam therefore remains local/self-hosted until policy and protocol
        // explicitly add a per-attempt authorization boundary.
        remoteAudioAuthorized: false,
        onPartial: this.options.streamingStt?.onPartial,
        onObserverError: this.options.streamingStt?.onObserverError
      });
    } catch (error) {
      await this.fail({
        code: "internal_error",
        message: error instanceof Error
          ? error.message
          : "Could not start streaming STT",
        sessionErrorCode: "streaming_stt_open_failed",
        sealSession: true,
        messageIdentity: message
      });
      return;
    }
    this.armCaptureTimeout();
    await this.sendAcknowledgement(message, 0, "spooled");
  }

  private async handleChunk(
    message: Extract<OrderedPcmIngressMessage, { type: "audio.chunk" }>
  ): Promise<void> {
    const transition = applyOrderedPcmIngressMessage(this.state, message);
    if (!transition.accepted) {
      await this.failForMessage(
        message,
        transition.code,
        transition.message,
        this.state.phase === "open"
      );
      return;
    }
    if (!this.attemptStillRecording()) {
      await this.failForMessage(
        message,
        "session_sealed",
        "Session attempt is no longer recording",
        false
      );
      return;
    }
    if (transition.state.phase !== "open") {
      throw new Error("audio.chunk did not produce an open ingress state");
    }

    const captureLimitError = captureLimitViolation(
      transition.state,
      this.options.captureTimeoutMs
    );
    if (captureLimitError) {
      await this.failForMessage(
        message,
        "capture_timeout",
        captureLimitError,
        true
      );
      return;
    }
    if (
      transition.state.receivedByteCount > this.options.maxSpoolBytes ||
      transition.state.receivedChunkCount > this.options.maxChunks
    ) {
      await this.failForMessage(
        message,
        "capacity_exceeded",
        "Ordered PCM spool capacity was exceeded",
        true
      );
      return;
    }

    try {
      const pcmFile = this.requirePcmFile();
      this.requireSpoolLease().reserve(message.pcmBytes.byteLength);
      await writeAll(pcmFile, message.pcmBytes);
      this.sourceHash?.update(message.pcmBytes);
      await this.appendWal({
        type: message.type,
        sequence: message.sequence,
        sourceMonotonicMs: message.sourceMonotonicMs,
        frameCount: message.frameCount,
        byteCount: message.byteCount,
        receivedByteCount: transition.state.receivedByteCount,
        lossEvidence: message.lossEvidence
      });
    } catch (error) {
      if (
        error instanceof AudioResourceCapacityError ||
        error instanceof SpoolCapacityError
      ) {
        await this.failForMessage(
          message,
          "capacity_exceeded",
          error.message,
          true
        );
        return;
      }
      throw error;
    }

    try {
      this.streamingSttAttempt?.push({
        ...streamingIdentity(message),
        sequence: message.sequence,
        sourceMonotonicMs: message.sourceMonotonicMs,
        frameCount: message.frameCount,
        pcmBytes: message.pcmBytes
      });
    } catch (error) {
      await this.fail({
        code: "internal_error",
        message: error instanceof Error
          ? error.message
          : "Streaming STT rejected PCM",
        sessionErrorCode: "streaming_stt_push_failed",
        sealSession: true,
        messageIdentity: message,
        rejectedSequence: message.sequence
      });
      return;
    }

    this.state = transition.state;
    await this.sendAcknowledgement(
      message,
      message.sequence,
      "spooled"
    );
  }

  private async handleStop(
    message: Extract<OrderedPcmIngressMessage, { type: "audio.stop" }>
  ): Promise<void> {
    const transition = applyOrderedPcmIngressMessage(this.state, message);
    if (!transition.accepted) {
      await this.failForMessage(
        message,
        transition.code,
        transition.message,
        this.state.phase === "open"
      );
      return;
    }
    if (!this.attemptStillRecording()) {
      await this.failForMessage(
        message,
        "session_sealed",
        "Session attempt is no longer recording",
        false
      );
      return;
    }
    if (transition.state.phase !== "stopped") {
      throw new Error("audio.stop did not produce a stopped ingress state");
    }

    const captureLimitError = captureLimitViolation(
      transition.state,
      this.options.captureTimeoutMs
    );
    if (captureLimitError) {
      await this.failForMessage(
        message,
        "capture_timeout",
        captureLimitError,
        true
      );
      return;
    }

    const sourceDurationMs = Math.max(
      0,
      message.sourceMonotonicMs - transition.state.sourceStartedMonotonicMs
    );
    const accountedDurationMs =
      (transition.state.emittedFrameCount +
        transition.state.lossEvidence.droppedFrameCount) /
      transition.state.pcmProfile.sampleRateHz *
      1_000;
    if (Math.abs(sourceDurationMs - accountedDurationMs) > maxSourceClockDriftMs) {
      await this.failForMessage(
        message,
        "coverage_incomplete",
        "source clock duration does not match emitted and dropped PCM frames",
        true
      );
      return;
    }

    const receivedPcmSha256 = this.sourceHash?.digest("hex");
    if (
      message.sourcePcmSha256 &&
      message.sourcePcmSha256 !== receivedPcmSha256
    ) {
      await this.failForMessage(
        message,
        "source_hash_mismatch",
        "sourcePcmSha256 does not match the spooled PCM bytes",
        true
      );
      return;
    }

    try {
      await this.appendWal({
        type: message.type,
        sourceMonotonicMs: message.sourceMonotonicMs,
        finalSequence: message.finalSequence,
        emittedFrameCount: message.emittedFrameCount,
        emittedByteCount: message.emittedByteCount,
        lossEvidence: message.lossEvidence,
        sourcePcmSha256: message.sourcePcmSha256,
        receivedPcmSha256
      });
    } catch (error) {
      if (
        error instanceof AudioResourceCapacityError ||
        error instanceof SpoolCapacityError
      ) {
        await this.failForMessage(
          message,
          "capacity_exceeded",
          error.message,
          true
        );
        return;
      }
      throw error;
    }
    this.state = transition.state;
    this.clearCaptureTimeout();

    const receipt = orderedPcmIngressReceiptFromState(this.state);
    const session = this.requireActiveSession();
    this.dependencies.store.updateAnalysis(session.id, { orderedPcm: receipt });
    const audioDurationMs =
      this.state.emittedFrameCount /
      this.state.pcmProfile.sampleRateHz *
      1_000;
    await emitSessionEvent(this.dependencies, session, {
      type: "input.recording.stopped",
      source: this.requireSource(),
      monotonicMs: message.sourceMonotonicMs,
      durationMs: sourceDurationMs
    }, () => ensureAttemptDeadline(this.dependencies, session));

    if (!receipt.coverageComplete || receipt.receivedByteCount === 0) {
      await this.fail({
        code: "coverage_incomplete",
        message: receipt.receivedByteCount === 0
          ? "Ordered PCM capture contained no audio frames"
          : "Ordered PCM capture has gap, drop, or overflow evidence",
        sessionErrorCode: "ordered_pcm_coverage_incomplete",
        sealSession: true,
        messageIdentity: message,
        rejectedSequence: message.finalSequence
      });
      return;
    }

    try {
      const attemptDeadline = ensureAttemptDeadline(this.dependencies, session);
      const acceptedStreamingFinal = this.streamingSttAttempt
        ? await this.streamingSttAttempt.finish({
            ...streamingIdentity(message),
            finalSequence: message.finalSequence,
            sourceMonotonicMs: message.sourceMonotonicMs,
            expiresAtMs: attemptDeadline.expiresAtMs -
              configuredResultCommitReserveMs(attemptDeadline.timeoutMs)
          })
        : undefined;
      // The spool lease already accounts for the durable PCM and WAL. Reserve
      // the one contiguous WAV allocation before creating it so concurrent
      // finalizers cannot exceed the advertised process-wide ingress budget.
      this.requireSpoolLease().reserve(
        receipt.receivedByteCount + pcmWaveHeaderBytes
      );
      const wavBytes = await readPcmWaveExact(
        this.requirePcmFile(),
        receipt.receivedByteCount,
        this.state.pcmProfile.sampleRateHz,
        this.state.pcmProfile.channelCount
      );
      if (
        !receivedPcmSha256 ||
        sha256Hex(wavBytes.subarray(pcmWaveHeaderBytes)) !== receivedPcmSha256
      ) {
        throw new Error("Ordered PCM spool hash changed before finalization");
      }
      const outcome = await runClaimedAudioAttempt(this.dependencies, {
        session,
        source: this.requireSource(),
        mediaType: "audio/wav",
        body: wavBytes,
        durationMs: audioDurationMs,
        attemptDeadline,
        acceptedStreamingFinal,
        uploadedAudio: {
          source: this.requireSource(),
          mediaType: "audio/wav",
          byteSize: wavBytes.byteLength,
          durationMs: audioDurationMs
        }
      });
      if (outcome.status !== "completed") {
        const capacityExceeded = outcome.status === "failed" &&
          outcome.errorCode === "audio_pipeline_capacity_exceeded";
        await this.fail({
          code: capacityExceeded ? "capacity_exceeded" : "internal_error",
          message: outcome.status === "failed"
            ? outcome.errorMessage ?? "Audio pipeline failed"
            : "Session attempt was superseded before result commit",
          sessionErrorCode: capacityExceeded
            ? "audio_pipeline_capacity_exceeded"
            : "ordered_pcm_pipeline_failed",
          sealSession: false,
          messageIdentity: message,
          rejectedSequence: message.finalSequence
        });
        return;
      }

      await this.cleanup();
      await this.sendAcknowledgement(
        message,
        message.finalSequence,
        "finalized",
        receipt
      );
      this.terminal = true;
      this.webSocket.close(1000, "ordered PCM finalized");
    } catch (error) {
      if (error instanceof AudioResourceCapacityError) {
        await this.fail({
          code: "capacity_exceeded",
          message: error.message,
          sessionErrorCode: "ordered_pcm_capacity_exceeded",
          sealSession: true,
          messageIdentity: message,
          rejectedSequence: message.finalSequence
        });
        return;
      }
      console.error("Could not finalize ordered PCM input", error);
      await this.fail({
        code: "internal_error",
        message: "Could not finalize ordered PCM input",
        sessionErrorCode: "ordered_pcm_pipeline_failed",
        sealSession: true,
        messageIdentity: message,
        rejectedSequence: message.finalSequence
      });
    }
  }

  private attemptStillRecording(): boolean {
    if (!this.startMessage) {
      return false;
    }
    const session = this.dependencies.store.getSession(
      this.startMessage.sessionId
    );
    return Boolean(
      session &&
      session.attemptId === this.startMessage.attemptId &&
      session.status === "recording"
    );
  }

  private requireActiveSession(): SessionRecord {
    if (!this.startMessage) {
      throw new Error("Ordered PCM input has not started");
    }
    const session = this.dependencies.store.getSession(
      this.startMessage.sessionId
    );
    if (!session || session.attemptId !== this.startMessage.attemptId) {
      throw new Error("Ordered PCM session attempt is no longer active");
    }
    return session;
  }

  private requireSource(): RuntimeSource {
    if (!this.source) {
      throw new Error("Ordered PCM source is unavailable");
    }
    return this.source;
  }

  private async openSpool(): Promise<void> {
    this.spoolDirectory = await mkdtemp(
      path.join(this.options.spoolRoot, "jiko-ordered-pcm-")
    );
    const pcmPath = path.join(this.spoolDirectory, "capture.pcm");
    const walPath = path.join(this.spoolDirectory, "capture.wal.jsonl");
    this.pcmFile = await open(pcmPath, "wx+");
    this.walFile = await open(walPath, "wx");

    // This slice deliberately has no restart recovery. Unlink both sensitive
    // files immediately and retain only process-owned handles, so SIGKILL does
    // not leave named raw audio or WAL metadata behind. A `spooled` ACK means
    // both ordered writes completed and remain process-readable; it is not a
    // disk-durable or restart-recoverable commit.
    await rm(pcmPath, { force: true });
    await rm(walPath, { force: true });
    await rm(this.spoolDirectory, { force: true, recursive: true });
    this.spoolDirectory = undefined;
  }

  private requirePcmFile(): FileHandle {
    if (!this.pcmFile) {
      throw new Error("Ordered PCM spool is not open");
    }
    return this.pcmFile;
  }

  private requireSpoolLease(): AudioIngressLease {
    if (!this.spoolLease) {
      throw new Error("Ordered PCM spool admission lease is not open");
    }
    return this.spoolLease;
  }

  private async appendWal(entry: Record<string, unknown>): Promise<void> {
    if (!this.walFile) {
      throw new Error("Ordered PCM WAL is not open");
    }
    const line = new TextEncoder().encode(`${JSON.stringify(entry)}\n`);
    if (this.walBytes + line.byteLength > this.options.maxWalBytes) {
      throw new SpoolCapacityError("Ordered PCM WAL capacity was exceeded");
    }
    this.requireSpoolLease().reserve(line.byteLength);
    await writeAll(this.walFile, line);
    this.walBytes += line.byteLength;
  }

  private async sendAcknowledgement(
    message: OrderedPcmIngressMessage,
    acknowledgedSequence: number,
    commitState: "spooled" | "finalized",
    receipt?: OrderedPcmIngressReceipt
  ): Promise<void> {
    const acknowledgement = OrderedPcmAckSchema.parse({
      protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
      type: "audio.ack",
      sessionId: message.sessionId,
      attemptId: message.attemptId,
      sourceId: message.sourceId,
      audioProfileHash: message.audioProfileHash,
      acknowledgedType: message.type,
      acknowledgedSequence,
      commitState,
      receipt
    });
    await sendJson(this.webSocket, acknowledgement);
  }

  private async failForMessage(
    message: OrderedPcmIngressMessage,
    code: OrderedPcmErrorCode,
    errorMessage: string,
    sealSession: boolean
  ): Promise<void> {
    await this.fail({
      code,
      message: errorMessage,
      sessionErrorCode: `ordered_pcm_${code}`,
      sealSession,
      messageIdentity: message,
      rejectedSequence: message.type === "audio.start"
        ? undefined
        : message.type === "audio.chunk"
          ? message.sequence
          : message.finalSequence
    });
  }

  private async fail(input: {
    code: OrderedPcmErrorCode;
    message: string;
    sessionErrorCode: string;
    sealSession: boolean;
    messageIdentity?: OrderedPcmIngressMessage;
    rejectedSequence?: number;
    sendBeforeClose?: boolean;
  }): Promise<void> {
    if (this.terminal) {
      return;
    }
    this.terminal = true;
    this.clearCaptureTimeout();
    this.streamingSttAttempt?.cancel(new Error(input.message));

    if (input.sealSession && this.startMessage) {
      const session = this.dependencies.store.getSession(
        this.startMessage.sessionId
      );
      if (
        session &&
        session.attemptId === this.startMessage.attemptId &&
        session.status !== "result" &&
        session.status !== "silence" &&
        session.status !== "reset" &&
        session.status !== "error"
      ) {
        try {
          await emitSessionEvent(this.dependencies, session, {
            type: "session.error",
            source: "server",
            message: input.message,
            code: input.sessionErrorCode,
            recoverable: true
          }, () => cancelAttemptAfterTerminal(
            this.dependencies,
            session,
            "session.error"
          ));
        } catch (error) {
          console.error("Could not seal ordered PCM session", error);
        }
      }
    }

    const identity = input.messageIdentity ?? this.startMessage;
    const errorMessage = OrderedPcmErrorSchema.parse({
      protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
      type: "audio.error",
      code: input.code,
      message: truncateErrorMessage(input.message),
      recoverable: false,
      ...(identity
        ? {
            sessionId: identity.sessionId,
            attemptId: identity.attemptId,
            sourceId: identity.sourceId,
            audioProfileHash: identity.audioProfileHash,
            rejectedType: identity.type,
            ...(input.rejectedSequence === undefined
              ? {}
              : { rejectedSequence: input.rejectedSequence })
          }
        : {})
    });

    if (
      input.sendBeforeClose !== false &&
      this.webSocket.readyState === WebSocket.OPEN
    ) {
      try {
        await sendJson(this.webSocket, errorMessage);
      } catch {
        // The canonical session.error and local cleanup remain authoritative.
      }
    }
    await this.cleanup();
    if (this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.close(
        input.code === "internal_error" ? 1011 : 1008,
        "ordered PCM rejected"
      );
    }
  }

  private async handleUnexpectedFailure(error: unknown): Promise<void> {
    if (this.terminal) {
      await this.cleanup();
      return;
    }
    const code = error instanceof SpoolCapacityError
      ? "capacity_exceeded"
      : "internal_error";
    if (code === "internal_error") {
      console.error("Ordered PCM ingress failed", error);
    }
    await this.fail({
      code,
      message: code === "capacity_exceeded" && error instanceof Error
        ? error.message
        : "Ordered PCM ingress failed",
      sessionErrorCode: code === "capacity_exceeded"
        ? "ordered_pcm_capacity_exceeded"
        : "ordered_pcm_internal_error",
      sealSession: this.state.phase === "open" || Boolean(this.startMessage),
      messageIdentity: this.startMessage
    });
  }

  private armCaptureTimeout(): void {
    this.clearCaptureTimeout();
    this.captureTimer = setTimeout(() => {
      this.enqueue(async () => {
        await this.fail({
          code: "capture_timeout",
          message: `Ordered PCM capture exceeded ${this.options.captureTimeoutMs} ms`,
          sessionErrorCode: "ordered_pcm_capture_timeout",
          sealSession: true
        });
      });
    }, this.options.captureTimeoutMs);
    this.captureTimer.unref?.();
  }

  private armStartTimeout(): void {
    this.clearCaptureTimeout();
    this.captureTimer = setTimeout(() => {
      this.enqueue(async () => {
        await this.fail({
          code: "capture_timeout",
          message: `Ordered PCM audio.start was not received within ${this.options.startTimeoutMs} ms`,
          sessionErrorCode: "ordered_pcm_start_timeout",
          sealSession: false
        });
      });
    }, this.options.startTimeoutMs);
    this.captureTimer.unref?.();
  }

  private clearCaptureTimeout(): void {
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = undefined;
    }
  }

  private async closeSpoolHandles(): Promise<void> {
    const handles = [this.pcmFile, this.walFile].filter(
      (handle): handle is FileHandle => Boolean(handle)
    );
    this.pcmFile = undefined;
    this.walFile = undefined;
    await Promise.all(handles.map((handle) => handle.close()));
  }

  private cleanup(): Promise<void> {
    if (!this.cleanupStarted) {
      this.cleanupStarted = (async () => {
        this.clearCaptureTimeout();
        try {
          await this.closeSpoolHandles();
        } finally {
          try {
            if (this.spoolDirectory) {
              await rm(this.spoolDirectory, { force: true, recursive: true });
              this.spoolDirectory = undefined;
            }
          } finally {
            this.spoolLease?.release();
            this.spoolLease = undefined;
          }
        }
      })();
    }
    return this.cleanupStarted;
  }
}

function streamingIdentity(
  message: OrderedPcmIngressMessage
): OrderedPcmIdentity {
  return {
    sessionId: message.sessionId,
    attemptId: message.attemptId,
    sourceId: message.sourceId,
    audioProfileHash: message.audioProfileHash
  };
}

class SpoolCapacityError extends Error {}

function captureLimitViolation(
  state: Exclude<OrderedPcmIngressState, { phase: "idle" }>,
  captureTimeoutMs: number
): string | undefined {
  const bytesPerFrame = state.pcmProfile.channelCount * 2;
  const maximumFrameCount = Math.min(
    Math.floor(Number.MAX_SAFE_INTEGER / bytesPerFrame),
    Math.floor(
      (state.pcmProfile.sampleRateHz * captureTimeoutMs) / 1_000
    )
  );
  const maximumByteCount = maximumFrameCount * bytesPerFrame;
  const sourceDurationMs =
    state.lastSourceMonotonicMs - state.sourceStartedMonotonicMs;

  if (sourceDurationMs > captureTimeoutMs) {
    return `Ordered PCM source duration exceeded ${captureTimeoutMs} ms`;
  }

  const emittedOrReceivedFrameCount = state.phase === "stopped"
    ? state.emittedFrameCount
    : state.receivedFrameCount;
  if (
    exceedsCombinedLimit(
      emittedOrReceivedFrameCount,
      state.lossEvidence.droppedFrameCount,
      maximumFrameCount
    )
  ) {
    return `Ordered PCM frame duration exceeded ${captureTimeoutMs} ms`;
  }

  const emittedOrReceivedByteCount = state.phase === "stopped"
    ? state.emittedByteCount
    : state.receivedByteCount;
  if (
    exceedsCombinedLimit(
      emittedOrReceivedByteCount,
      state.lossEvidence.droppedByteCount,
      maximumByteCount
    )
  ) {
    return `Ordered PCM byte duration exceeded ${captureTimeoutMs} ms`;
  }

  return undefined;
}

function exceedsCombinedLimit(
  first: number,
  second: number,
  limit: number
): boolean {
  return first > limit || second > limit - first;
}

async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null
    );
    if (bytesWritten <= 0) {
      throw new Error("Ordered PCM spool write made no progress");
    }
    offset += bytesWritten;
  }
}

async function readPcmWaveExact(
  file: FileHandle,
  pcmByteLength: number,
  sampleRateHz: number,
  channelCount: number
): Promise<Uint8Array> {
  const output = createPcmWaveBuffer(
    pcmByteLength,
    sampleRateHz,
    channelCount
  );
  let pcmOffset = 0;
  while (pcmOffset < pcmByteLength) {
    const { bytesRead } = await file.read(
      output,
      pcmWaveHeaderBytes + pcmOffset,
      pcmByteLength - pcmOffset,
      pcmOffset
    );
    if (bytesRead <= 0) {
      throw new Error("Ordered PCM spool ended before its committed byte count");
    }
    pcmOffset += bytesRead;
  }
  return output;
}

export function encodePcmWave(
  pcmBytes: Uint8Array,
  sampleRateHz: number,
  channelCount: number
): Uint8Array {
  const output = createPcmWaveBuffer(
    pcmBytes.byteLength,
    sampleRateHz,
    channelCount
  );
  output.set(pcmBytes, pcmWaveHeaderBytes);
  return output;
}

function createPcmWaveBuffer(
  pcmByteLength: number,
  sampleRateHz: number,
  channelCount: number
): Uint8Array {
  if (pcmByteLength > 0xffff_ffff - 36) {
    throw new Error("PCM input is too large for a RIFF/WAVE container");
  }
  const blockAlign = channelCount * 2;
  if (pcmByteLength % blockAlign !== 0) {
    throw new Error("PCM byte length does not contain complete frames");
  }

  const output = new Uint8Array(pcmWaveHeaderBytes + pcmByteLength);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, "RIFF");
  view.setUint32(4, 36 + pcmByteLength, true);
  writeAscii(output, 8, "WAVE");
  writeAscii(output, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(output, 36, "data");
  view.setUint32(40, pcmByteLength, true);
  return output;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function rawDataToUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) {
    const totalBytes = data.reduce((total, chunk) => total + chunk.byteLength, 0);
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of data) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function sendJson(webSocket: WebSocket, value: unknown): Promise<void> {
  if (webSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Ordered PCM WebSocket is not open"));
  }
  return new Promise<void>((resolve, reject) => {
    webSocket.send(JSON.stringify(value), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function parseAudioStreamTarget(rawUrl: unknown): { sessionId: string } | undefined {
  if (
    typeof rawUrl !== "string" ||
    hasPercentEncodedDotPathSegment(rawUrl)
  ) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(rawUrl, "http://localhost");
  } catch {
    return undefined;
  }
  const match = /^\/sessions\/([^/]+)\/audio-stream$/.exec(url.pathname);
  if (!match) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  const sessionId = sanitizeSessionId(decoded);
  return sessionId ? { sessionId } : undefined;
}

function hasPercentEncodedDotPathSegment(rawUrl: string): boolean {
  // URL parsing canonicalizes encoded dot segments before pathname matching.
  // Reject them from the raw upgrade target so a noncanonical path cannot be
  // folded into the ordered-PCM endpoint.
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  return rawPath.split("/").some((segment) =>
    /%2e/i.test(segment) && /^(?:\.|%2e){1,2}$/i.test(segment)
  );
}

function configuredAllowedOrigins(): readonly string[] {
  const configured = process.env.JIKO_ORDERED_PCM_ALLOWED_ORIGINS;
  if (!configured?.trim()) {
    return defaultAllowedOrigins;
  }
  const origins = configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : defaultAllowedOrigins;
}

function configuredPositiveInteger(name: string): number | undefined {
  const configured = process.env[name];
  if (configured === undefined) {
    return undefined;
  }
  const raw = configured.trim();
  const parsed = Number(raw);
  if (!raw || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? value as number
    : fallback;
}

function singleHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return Array.isArray(value) && value.length === 1 && typeof value[0] === "string"
    ? value[0]
    : undefined;
}

function commaSeparatedHeaderValues(value: unknown): string[] {
  const raw = singleHeaderValue(value);
  return raw
    ? raw.split(",").map((part) => part.trim()).filter(Boolean)
    : [];
}

function rejectUpgrade(
  socket: any,
  statusCode: number,
  message: string,
  headers: Record<string, string> = {}
): void {
  const body = `${message}\n`;
  const headerLines = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  socket.end(
    `HTTP/1.1 ${statusCode} ${httpStatusText(statusCode)}\r\n` +
    "connection: close\r\n" +
    "content-type: text/plain; charset=utf-8\r\n" +
    `content-length: ${Buffer.byteLength(body)}\r\n` +
    headerLines +
    `\r\n${body}`
  );
}

function httpStatusText(statusCode: number): string {
  if (statusCode === 403) {
    return "Forbidden";
  }
  if (statusCode === 404) {
    return "Not Found";
  }
  if (statusCode === 426) {
    return "Upgrade Required";
  }
  if (statusCode === 503) {
    return "Service Unavailable";
  }
  return "Service Unavailable";
}

function truncateErrorMessage(message: string): string {
  return message.length <= 512 ? message : `${message.slice(0, 509)}...`;
}
