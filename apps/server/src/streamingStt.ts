import {
  OrderedPcmIdentitySchema,
  OrderedPcmProfileSchema,
  type OrderedPcmIdentity,
  type OrderedPcmProfile,
  type SttProviderReceipt,
  type TranscriptResult
} from "@jiko/protocol";

export type StreamingSttPhase =
  | "opening"
  | "streaming"
  | "finishing"
  | "completed"
  | "cancelled"
  | "timed_out"
  | "failed";

export type StreamingSttPcmChunk = OrderedPcmIdentity & {
  sequence: number;
  sourceMonotonicMs: number;
  frameCount: number;
  pcmBytes: Uint8Array;
};

export type StreamingSttFinish = OrderedPcmIdentity & {
  finalSequence: number;
  sourceMonotonicMs: number;
  /**
   * An optional tighter server-monotonic cutoff. It can shorten the deadline
   * established at open, but it can never extend it.
   */
  expiresAtMs?: number;
};

export type StreamingSttAdapterEvent =
  | (OrderedPcmIdentity & {
      type: "partial";
      revision: number;
      coverageSequence: number;
      text: string;
      language?: string;
    })
  | (OrderedPcmIdentity & {
      type: "final";
      finalSequence: number;
      text: string;
      language?: string;
      confidence?: number;
    });

export type StreamingSttObserverPartial = Readonly<
  OrderedPcmIdentity & {
    type: "partial";
    provider: string;
    revision: number;
    coverageSequence: number;
    text: string;
    language?: string;
    receivedAtMs: number;
  }
>;

export type StreamingSttAdapterOpenInput = {
  identity: Readonly<OrderedPcmIdentity>;
  pcmProfile: Readonly<OrderedPcmProfile>;
  signal: AbortSignal;
  emit(event: StreamingSttAdapterEvent): void;
};

export type StreamingSttAdapterSession = {
  push(chunk: StreamingSttPcmChunk): Promise<void>;
  /** Resolve only after emitting one matching final event. */
  finish(input: StreamingSttFinish): Promise<void>;
  cancel(reason: Error): void | Promise<void>;
};

export type StreamingSttAdapter = {
  id: string;
  remote: boolean;
  open(input: StreamingSttAdapterOpenInput): Promise<StreamingSttAdapterSession>;
};

export type StreamingSttFinal = Readonly<{
  identity: Readonly<OrderedPcmIdentity>;
  finalSequence: number;
  transcript: TranscriptResult;
  providerReceipt: SttProviderReceipt;
  partialRevisionCount: number;
  pushedChunkCount: number;
  pushedByteCount: number;
  queueHighWaterBytes: number;
  openedAtMs: number;
  finishedAtMs: number;
}>;

export type OpenStreamingSttAttempt = {
  identity: OrderedPcmIdentity;
  pcmProfile: OrderedPcmProfile;
  /** Absolute server-monotonic deadline. */
  expiresAtMs: number;
  signal?: AbortSignal;
  remoteAudioAuthorized?: boolean;
  onPartial?(partial: StreamingSttObserverPartial): void;
  onObserverError?(error: unknown): void;
};

export type StreamingSttSchedulerOptions = {
  maxQueuedChunks?: number;
  maxQueuedPcmBytes?: number;
  maxTranscriptBytes?: number;
  maxPartialEvents?: number;
  maxObserverBytes?: number;
};

type ResolvedSchedulerOptions = Required<StreamingSttSchedulerOptions>;

const defaultSchedulerOptions: ResolvedSchedulerOptions = {
  maxQueuedChunks: 32,
  maxQueuedPcmBytes: 512 * 1024,
  maxTranscriptBytes: 16 * 1024,
  maxPartialEvents: 256,
  maxObserverBytes: 512 * 1024
};

export type StreamingSttContractErrorCode =
  | "attempt_already_open"
  | "attempt_identity_mismatch"
  | "deadline_exceeded"
  | "duplicate_final"
  | "finish_without_final"
  | "invalid_event"
  | "invalid_sequence"
  | "lifecycle_violation"
  | "output_capacity_exceeded"
  | "queue_capacity_exceeded"
  | "remote_audio_not_authorized";

export class StreamingSttContractError extends Error {
  constructor(
    readonly code: StreamingSttContractErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StreamingSttContractError";
  }
}

export class StreamingSttDeadlineError extends StreamingSttContractError {
  constructor() {
    super("deadline_exceeded", "Streaming STT attempt exceeded its deadline");
    this.name = "StreamingSttDeadlineError";
  }
}

/**
 * Owns provider-neutral lifecycle and arbitration for incremental ASR.
 *
 * This scheduler does not select a model and has no default provider. It is a
 * runtime boundary for a deliberately injected local/self-hosted adapter (or
 * an explicitly authorized remote adapter). Partial hypotheses leave only via
 * `onPartial`; the sole value returned by `finish()` is a coverage-checked
 * final that may enter the product pipeline.
 */
export class StreamingSttScheduler {
  private readonly attempts = new Map<string, StreamingSttAttempt>();
  private readonly options: ResolvedSchedulerOptions;
  private closedReason?: Error;

  constructor(
    readonly adapter: StreamingSttAdapter,
    options: StreamingSttSchedulerOptions = {}
  ) {
    const providerId = adapter.id.trim();
    if (!providerId || providerId.length > 256) {
      throw new Error("Streaming STT adapter id must be 1-256 characters");
    }
    this.options = resolveOptions(options);
  }

  get activeCount(): number {
    return this.attempts.size;
  }

  open(input: OpenStreamingSttAttempt): StreamingSttAttempt {
    if (this.closedReason) {
      throw this.closedReason;
    }
    if (this.adapter.remote && input.remoteAudioAuthorized !== true) {
      throw new StreamingSttContractError(
        "remote_audio_not_authorized",
        "Remote streaming STT requires explicit authorization for this attempt"
      );
    }

    const identity = immutableIdentity(input.identity);
    const pcmProfile = Object.freeze(OrderedPcmProfileSchema.parse(input.pcmProfile));
    const key = attemptKey(identity);
    if (this.attempts.has(key)) {
      throw new StreamingSttContractError(
        "attempt_already_open",
        `Streaming STT is already open for ${identity.sessionId}/${identity.attemptId}`
      );
    }

    let attempt!: StreamingSttAttempt;
    attempt = new StreamingSttAttempt(
      this.adapter,
      {
        ...input,
        identity,
        pcmProfile
      },
      this.options,
      () => {
        if (this.attempts.get(key) === attempt) {
          this.attempts.delete(key);
        }
      }
    );
    if (!isTerminalPhase(attempt.phase)) {
      this.attempts.set(key, attempt);
    }
    return attempt;
  }

  cancel(
    sessionId: string,
    attemptId: string,
    reason = new Error("Streaming STT attempt was cancelled")
  ): boolean {
    const attempt = this.attempts.get(attemptKey({ sessionId, attemptId }));
    if (!attempt) {
      return false;
    }
    attempt.cancel(reason);
    return true;
  }

  close(reason = new Error("Streaming STT scheduler was closed")): void {
    if (this.closedReason) {
      return;
    }
    this.closedReason = reason;
    for (const attempt of this.attempts.values()) {
      attempt.cancel(reason);
    }
  }
}

export class StreamingSttAttempt {
  private readonly controller = new AbortController();
  private readonly identityValue: Readonly<OrderedPcmIdentity>;
  private readonly pcmProfile: Readonly<OrderedPcmProfile>;
  private readonly openedAtMs = performance.now();
  private readonly adapterOpenPromise: Promise<StreamingSttAdapterSession>;
  private readonly sessionPromise: Promise<StreamingSttAdapterSession>;
  private deliveryTail: Promise<void> = Promise.resolve();
  private adapterSession?: StreamingSttAdapterSession;
  private deadlineTimer?: ReturnType<typeof setTimeout>;
  private expiresAtMs: number;
  private terminalError?: Error;
  private acceptedFinal?: StreamingSttFinal;
  private lastSequence = 0;
  private lastSourceMonotonicMs = 0;
  private lastPartialRevision = 0;
  private partialEventCount = 0;
  private observerBytes = 0;
  private queuedChunks = 0;
  private queuedPcmBytes = 0;
  private pushedByteCount = 0;
  private queueHighWaterBytes = 0;
  private phaseValue: StreamingSttPhase = "opening";
  private finished = false;
  private providerFinishStarted = false;
  private adapterCancelStarted = false;
  private parentAbortHandler?: () => void;

  constructor(
    private readonly adapter: StreamingSttAdapter,
    private readonly input: Omit<OpenStreamingSttAttempt, "identity" | "pcmProfile"> & {
      identity: Readonly<OrderedPcmIdentity>;
      pcmProfile: Readonly<OrderedPcmProfile>;
    },
    private readonly options: ResolvedSchedulerOptions,
    private readonly onTerminal: () => void
  ) {
    this.identityValue = input.identity;
    this.pcmProfile = input.pcmProfile;
    this.expiresAtMs = finiteDeadline(input.expiresAtMs);
    this.armDeadline();

    this.adapterOpenPromise = Promise.resolve().then(() => {
      if (this.controller.signal.aborted) {
        throw abortReason(this.controller.signal);
      }
      return this.adapter.open({
        identity: this.identityValue,
        pcmProfile: this.pcmProfile,
        signal: this.controller.signal,
        emit: (event) => this.receiveAdapterEvent(event)
      });
    }).then((session) => {
      this.adapterSession = validateAdapterSession(session);
      if (isTerminalPhase(this.phaseValue)) {
        void this.cancelAdapter(this.terminalError ?? new Error("Streaming STT attempt ended"));
      } else if (this.phaseValue === "opening") {
        this.expireIfDue();
        this.phaseValue = "streaming";
      }
      return this.adapterSession;
    });
    this.sessionPromise = raceWithSignal(
      this.adapterOpenPromise,
      this.controller.signal
    );
    this.linkParentSignal(input.signal);

    // Always observe startup rejection, even if the caller never pushes or
    // finishes. Later awaits still receive the original rejected promise.
    void this.sessionPromise.catch((error) => {
      this.fail(normalizeError(error, "Streaming STT adapter failed to open"));
    });
  }

  get identity(): Readonly<OrderedPcmIdentity> {
    return this.identityValue;
  }

  get phase(): StreamingSttPhase {
    return this.phaseValue;
  }

  push(input: StreamingSttPcmChunk): void {
    this.throwIfTerminal();
    this.expireIfDue();
    if (this.phaseValue !== "opening" && this.phaseValue !== "streaming") {
      throw new StreamingSttContractError(
        "lifecycle_violation",
        `Cannot push PCM while streaming STT is ${this.phaseValue}`
      );
    }
    this.assertAttemptIdentity(input);
    if (!Number.isSafeInteger(input.sequence) || input.sequence !== this.lastSequence + 1) {
      this.failAndThrow(new StreamingSttContractError(
        "invalid_sequence",
        `Expected streaming PCM sequence ${this.lastSequence + 1}, got ${input.sequence}`
      ));
    }
    if (
      !Number.isSafeInteger(input.frameCount) ||
      input.frameCount <= 0 ||
      !(input.pcmBytes instanceof Uint8Array) ||
      input.pcmBytes.byteLength !== input.frameCount * this.pcmProfile.channelCount * 2 ||
      !Number.isFinite(input.sourceMonotonicMs) ||
      input.sourceMonotonicMs < this.lastSourceMonotonicMs
    ) {
      this.failAndThrow(new StreamingSttContractError(
        "invalid_sequence",
        "Streaming PCM frame count, byte count, or source clock is invalid"
      ));
    }
    if (
      this.queuedChunks + 1 > this.options.maxQueuedChunks ||
      this.queuedPcmBytes + input.pcmBytes.byteLength > this.options.maxQueuedPcmBytes
    ) {
      this.failAndThrow(new StreamingSttContractError(
        "queue_capacity_exceeded",
        "Streaming STT PCM queue capacity was exceeded"
      ));
    }

    const chunk = immutableChunk(input);
    this.lastSequence = chunk.sequence;
    this.lastSourceMonotonicMs = chunk.sourceMonotonicMs;
    this.queuedChunks += 1;
    this.queuedPcmBytes += chunk.pcmBytes.byteLength;
    this.pushedByteCount += chunk.pcmBytes.byteLength;
    this.queueHighWaterBytes = Math.max(
      this.queueHighWaterBytes,
      this.queuedPcmBytes
    );

    const delivery = this.deliveryTail.then(async () => {
      this.throwIfTerminal();
      this.expireIfDue();
      const session = await this.sessionPromise;
      this.throwIfTerminal();
      this.expireIfDue();
      await raceWithSignal(
        Promise.resolve(session.push(chunk)),
        this.controller.signal
      );
      this.throwIfTerminal();
      this.expireIfDue();
    });
    this.deliveryTail = delivery.then(
      () => this.releaseQueuedChunk(chunk),
      (error) => {
        this.releaseQueuedChunk(chunk);
        this.fail(normalizeError(error, "Streaming STT adapter rejected PCM"));
      }
    );
  }

  finish(input: StreamingSttFinish): Promise<StreamingSttFinal> {
    this.throwIfTerminal();
    this.expireIfDue();
    if (this.phaseValue !== "opening" && this.phaseValue !== "streaming") {
      return Promise.reject(new StreamingSttContractError(
        "lifecycle_violation",
        `Cannot finish streaming STT while it is ${this.phaseValue}`
      ));
    }
    this.assertAttemptIdentity(input);
    if (
      !Number.isSafeInteger(input.finalSequence) ||
      input.finalSequence !== this.lastSequence ||
      !Number.isFinite(input.sourceMonotonicMs) ||
      input.sourceMonotonicMs < this.lastSourceMonotonicMs
    ) {
      const error = new StreamingSttContractError(
        "invalid_sequence",
        "Streaming STT finish does not cover the accepted PCM sequence and source clock"
      );
      this.fail(error);
      return Promise.reject(error);
    }

    this.phaseValue = "finishing";
    if (input.expiresAtMs !== undefined) {
      this.tightenDeadline(input.expiresAtMs);
    }
    this.expireIfDue();

    const finishInput = Object.freeze({ ...input, ...this.identityValue });
    return this.finishAdapter(finishInput);
  }

  cancel(reason = new Error("Streaming STT attempt was cancelled")): void {
    if (isTerminalPhase(this.phaseValue)) {
      return;
    }
    this.phaseValue = "cancelled";
    this.terminalError = reason;
    this.completeTerminal(reason);
  }

  private async finishAdapter(input: StreamingSttFinish): Promise<StreamingSttFinal> {
    try {
      await this.deliveryTail;
      this.throwIfTerminal();
      this.expireIfDue();
      const session = await this.sessionPromise;
      this.throwIfTerminal();
      this.expireIfDue();
      this.providerFinishStarted = true;
      await raceWithSignal(
        Promise.resolve(session.finish(input)),
        this.controller.signal
      );
      this.throwIfTerminal();
      this.expireIfDue();
      if (!this.acceptedFinal) {
        throw new StreamingSttContractError(
          "finish_without_final",
          "Streaming STT adapter finished without emitting a final transcript"
        );
      }

      // This is the commit boundary: a timer callback can be delayed behind a
      // blocked event loop, so completion must synchronously re-read the
      // monotonic clock instead of trusting that the timer already fired.
      this.expireIfDue();
      this.phaseValue = "completed";
      const final = this.acceptedFinal;
      this.completeTerminal();
      return final;
    } catch (error) {
      const failure = normalizeError(error, "Streaming STT finalization failed");
      this.fail(failure);
      throw this.terminalError ?? failure;
    }
  }

  private receiveAdapterEvent(event: StreamingSttAdapterEvent): void {
    try {
      this.throwIfTerminal();
      this.expireIfDue();
      this.assertAttemptIdentity(event);
      if (event.type === "partial") {
        this.receivePartial(event);
        return;
      }
      this.receiveFinal(event);
    } catch (error) {
      const failure = normalizeError(error, "Streaming STT adapter emitted an invalid event");
      this.fail(failure);
      throw failure;
    }
  }

  private receivePartial(
    event: Extract<StreamingSttAdapterEvent, { type: "partial" }>
  ): void {
    if (this.phaseValue === "completed" || this.acceptedFinal) {
      this.failAndThrow(new StreamingSttContractError(
        "lifecycle_violation",
        "Streaming STT emitted a partial after its final"
      ));
    }
    if (
      !Number.isSafeInteger(event.revision) ||
      event.revision <= this.lastPartialRevision ||
      !Number.isSafeInteger(event.coverageSequence) ||
      event.coverageSequence < 0 ||
      event.coverageSequence > this.lastSequence
    ) {
      this.failAndThrow(new StreamingSttContractError(
        "invalid_event",
        "Streaming STT partial revision or coverage is invalid"
      ));
    }

    const bytes = transcriptByteLength(event.text);
    if (
      bytes > this.options.maxTranscriptBytes ||
      this.partialEventCount + 1 > this.options.maxPartialEvents ||
      this.observerBytes + bytes > this.options.maxObserverBytes
    ) {
      this.failAndThrow(new StreamingSttContractError(
        "output_capacity_exceeded",
        "Streaming STT partial output capacity was exceeded"
      ));
    }

    this.lastPartialRevision = event.revision;
    this.partialEventCount += 1;
    this.observerBytes += bytes;
    const partial = Object.freeze({
      ...this.identityValue,
      type: "partial" as const,
      provider: this.adapter.id,
      revision: event.revision,
      coverageSequence: event.coverageSequence,
      text: event.text,
      ...(event.language ? { language: event.language } : {}),
      receivedAtMs: performance.now()
    });
    try {
      this.input.onPartial?.(partial);
    } catch (error) {
      if (this.input.onObserverError) {
        this.input.onObserverError(error);
      } else {
        console.error("Streaming STT partial observer failed");
      }
    }
    this.expireIfDue();
  }

  private receiveFinal(
    event: Extract<StreamingSttAdapterEvent, { type: "final" }>
  ): void {
    if (this.acceptedFinal) {
      this.failAndThrow(new StreamingSttContractError(
        "duplicate_final",
        "Streaming STT adapter emitted more than one final"
      ));
    }
    if (this.phaseValue !== "finishing" || !this.providerFinishStarted) {
      this.failAndThrow(new StreamingSttContractError(
        "lifecycle_violation",
        "Streaming STT final is only valid after PCM drain enters provider finish"
      ));
    }
    if (
      !Number.isSafeInteger(event.finalSequence) ||
      event.finalSequence !== this.lastSequence ||
      transcriptByteLength(event.text) > this.options.maxTranscriptBytes ||
      (event.confidence !== undefined &&
        (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1))
    ) {
      this.failAndThrow(new StreamingSttContractError(
        "invalid_event",
        "Streaming STT final identity, coverage, text, or confidence is invalid"
      ));
    }

    const finishedAtMs = performance.now();
    const transcript: TranscriptResult = Object.freeze({
      text: event.text,
      provider: this.adapter.id,
      ...(event.language ? { language: event.language } : {}),
      ...(event.confidence === undefined ? {} : { confidence: event.confidence }),
      latencyMs: elapsedMs(this.openedAtMs, finishedAtMs)
    });
    const providerReceipt: SttProviderReceipt = Object.freeze({
      id: this.adapter.id,
      latencyMs: transcript.latencyMs,
      remote: this.adapter.remote,
      outcome: "completed"
    });
    this.expireIfDue();
    this.acceptedFinal = Object.freeze({
      identity: this.identityValue,
      finalSequence: event.finalSequence,
      transcript,
      providerReceipt,
      partialRevisionCount: this.partialEventCount,
      pushedChunkCount: this.lastSequence,
      pushedByteCount: this.pushedByteCount,
      queueHighWaterBytes: this.queueHighWaterBytes,
      openedAtMs: this.openedAtMs,
      finishedAtMs
    });
  }

  private releaseQueuedChunk(chunk: StreamingSttPcmChunk): void {
    this.queuedChunks = Math.max(0, this.queuedChunks - 1);
    this.queuedPcmBytes = Math.max(
      0,
      this.queuedPcmBytes - chunk.pcmBytes.byteLength
    );
  }

  private tightenDeadline(expiresAtMs: number): void {
    const next = finiteDeadline(expiresAtMs);
    if (next >= this.expiresAtMs) {
      return;
    }
    this.expiresAtMs = next;
    this.armDeadline();
  }

  private armDeadline(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
    }
    const remainingMs = Math.max(0, this.expiresAtMs - performance.now());
    this.deadlineTimer = setTimeout(() => {
      this.fail(new StreamingSttDeadlineError());
    }, remainingMs);
    this.deadlineTimer.unref?.();
  }

  private expireIfDue(): void {
    if (performance.now() < this.expiresAtMs) {
      return;
    }
    const error = new StreamingSttDeadlineError();
    this.fail(error);
    throw this.terminalError ?? error;
  }

  private linkParentSignal(signal?: AbortSignal): void {
    if (!signal) {
      return;
    }
    const handleAbort = () => {
      this.cancel(abortReason(signal));
    };
    this.parentAbortHandler = handleAbort;
    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener("abort", handleAbort, { once: true });
  }

  private fail(error: Error): void {
    if (isTerminalPhase(this.phaseValue)) {
      return;
    }
    this.phaseValue = error instanceof StreamingSttDeadlineError
      ? "timed_out"
      : "failed";
    this.terminalError = error;
    this.completeTerminal(error);
  }

  private failAndThrow(error: Error): never {
    this.fail(error);
    throw error;
  }

  private completeTerminal(reason?: Error): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = undefined;
    }
    if (this.parentAbortHandler && this.input.signal) {
      this.input.signal.removeEventListener("abort", this.parentAbortHandler);
    }
    if (reason && !this.controller.signal.aborted) {
      this.controller.abort(reason);
      void this.cancelAdapter(reason);
    }
    this.onTerminal();
  }

  private async cancelAdapter(reason: Error): Promise<void> {
    if (this.adapterCancelStarted) {
      return;
    }
    this.adapterCancelStarted = true;
    try {
      const session = this.adapterSession ?? await this.adapterOpenPromise;
      await session.cancel(reason);
    } catch {
      // The original lifecycle error remains authoritative. Adapter cleanup
      // cannot replace it, and no transcript/audio content is logged here.
    }
  }

  private throwIfTerminal(): void {
    if (this.terminalError) {
      throw this.terminalError;
    }
    if (this.phaseValue === "cancelled") {
      throw new Error("Streaming STT attempt was cancelled");
    }
    if (this.phaseValue === "completed") {
      throw new StreamingSttContractError(
        "lifecycle_violation",
        "Streaming STT attempt already completed"
      );
    }
  }

  private assertAttemptIdentity(actual: OrderedPcmIdentity): void {
    try {
      assertIdentity(this.identityValue, actual);
    } catch (error) {
      this.failAndThrow(normalizeError(error, "Streaming STT attempt identity mismatch"));
    }
  }
}

function resolveOptions(options: StreamingSttSchedulerOptions): ResolvedSchedulerOptions {
  return {
    maxQueuedChunks: positiveInteger(options.maxQueuedChunks, defaultSchedulerOptions.maxQueuedChunks),
    maxQueuedPcmBytes: positiveInteger(options.maxQueuedPcmBytes, defaultSchedulerOptions.maxQueuedPcmBytes),
    maxTranscriptBytes: positiveInteger(options.maxTranscriptBytes, defaultSchedulerOptions.maxTranscriptBytes),
    maxPartialEvents: positiveInteger(options.maxPartialEvents, defaultSchedulerOptions.maxPartialEvents),
    maxObserverBytes: positiveInteger(options.maxObserverBytes, defaultSchedulerOptions.maxObserverBytes)
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? value as number
    : fallback;
}

function immutableIdentity(input: OrderedPcmIdentity): Readonly<OrderedPcmIdentity> {
  return Object.freeze(OrderedPcmIdentitySchema.parse({
    sessionId: input.sessionId,
    attemptId: input.attemptId,
    sourceId: input.sourceId,
    audioProfileHash: input.audioProfileHash
  }));
}

function immutableChunk(input: StreamingSttPcmChunk): StreamingSttPcmChunk {
  return Object.freeze({
    ...immutableIdentity(input),
    sequence: input.sequence,
    sourceMonotonicMs: input.sourceMonotonicMs,
    frameCount: input.frameCount,
    pcmBytes: Uint8Array.from(input.pcmBytes)
  });
}

function assertIdentity(
  expected: OrderedPcmIdentity,
  actual: OrderedPcmIdentity
): void {
  let parsed: OrderedPcmIdentity;
  try {
    parsed = OrderedPcmIdentitySchema.parse({
      sessionId: actual.sessionId,
      attemptId: actual.attemptId,
      sourceId: actual.sourceId,
      audioProfileHash: actual.audioProfileHash
    });
  } catch {
    throw new StreamingSttContractError(
      "attempt_identity_mismatch",
      "Streaming STT message has an invalid attempt identity"
    );
  }
  if (
    parsed.sessionId !== expected.sessionId ||
    parsed.attemptId !== expected.attemptId ||
    parsed.sourceId !== expected.sourceId ||
    parsed.audioProfileHash !== expected.audioProfileHash
  ) {
    throw new StreamingSttContractError(
      "attempt_identity_mismatch",
      "Streaming STT message does not belong to the open attempt"
    );
  }
}

function validateAdapterSession(session: StreamingSttAdapterSession): StreamingSttAdapterSession {
  if (
    !session ||
    typeof session.push !== "function" ||
    typeof session.finish !== "function" ||
    typeof session.cancel !== "function"
  ) {
    throw new Error("Streaming STT adapter returned an invalid session");
  }
  return session;
}

function attemptKey(identity: Pick<OrderedPcmIdentity, "sessionId" | "attemptId">): string {
  return JSON.stringify([identity.sessionId, identity.attemptId]);
}

function finiteDeadline(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Streaming STT deadline must be a finite monotonic timestamp");
  }
  return value;
}

function transcriptByteLength(text: unknown): number {
  if (typeof text !== "string") {
    throw new StreamingSttContractError(
      "invalid_event",
      "Streaming STT transcript text must be a string"
    );
  }
  return new TextEncoder().encode(text).byteLength;
}

function elapsedMs(startedAtMs: number, finishedAtMs: number): number {
  return Number(Math.max(0, finishedAtMs - startedAtMs).toFixed(3));
}

function isTerminalPhase(phase: StreamingSttPhase): boolean {
  return phase === "completed" ||
    phase === "cancelled" ||
    phase === "timed_out" ||
    phase === "failed";
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Streaming STT attempt was cancelled");
}

function raceWithSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The work may have rejected synchronously while also aborting the signal.
    // Observe it before returning the authoritative cancellation reason.
    void work.catch(() => undefined);
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
