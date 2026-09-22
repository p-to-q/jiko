import {
  ORDERED_PCM_PROTOCOL_VERSION,
  SUPPORTED_ORDERED_PCM_SAMPLE_RATES_HZ,
  OrderedPcmOutboundMessageSchema,
  OrderedPcmProfileSchema,
  canonicalizeOrderedPcmProfile,
  encodeOrderedPcmBinaryEnvelope,
  type OrderedPcmAck,
  type OrderedPcmLossEvidence,
  type OrderedPcmProfile,
} from "@jiko/protocol";
import type { BrowserSessionRegistration } from "../api/server";

export const ORDERED_PCM_WEBSOCKET_PROTOCOL = "jiko.ordered-pcm.v1";

const WORKLET_PROCESSOR_NAME = "jiko-ordered-pcm-capture";
const WORKLET_CONTRACT_VERSION = 2;
const CAPTURE_FRAME_DURATION_MS = 20;
const FRAMES_PER_TRANSPORT_CHUNK = 4;
const MAX_INFLIGHT_CHUNKS = 4;
const MAX_WEBSOCKET_BUFFERED_BYTES = 256 * 1024;
const MAX_PRECONNECT_BYTES = 2 * 1024 * 1024;
const MAX_TURN_BYTES = 12 * 1024 * 1024;
const SOCKET_CONNECT_TIMEOUT_MS = 6_000;
const ACK_PROGRESS_TIMEOUT_MS = 6_000;
const STOP_SEND_TIMEOUT_MS = 20_000;
const STOP_FINAL_ACK_TIMEOUT_MS = 6_000;
const WORKLET_LOAD_TIMEOUT_MS = 6_000;
const WORKLET_STOP_TIMEOUT_MS = 1_000;
const AUDIO_CONTEXT_RESUME_TIMEOUT_MS = 2_000;
const WORKLET_FRAME_CREDITS = 32;
const MAX_SOURCE_CLOCK_DRIFT_MS = 120;

type OrderedPcmCaptureOptions = {
  apiBaseUrl: string;
  sessionId: string;
  stream: MediaStream;
  onFailure: (error: Error) => void;
};

type WorkletReady = {
  type: "capture.ready";
  contractVersion: number;
};

type WorkletPcmFrame = {
  type: "pcm.frame";
  pcmBuffer: ArrayBuffer;
  frameCount: number;
  sourceMonotonicMs: number;
  captureGapCount: number;
  droppedFrameCount: number;
  overflowCount: number;
};

type WorkletStopped = {
  type: "capture.stopped";
  captureGapCount: number;
  droppedFrameCount: number;
  overflowCount: number;
};

type WorkletMessage = WorkletReady | WorkletPcmFrame | WorkletStopped;

type BufferedFrame = {
  pcmBytes: Uint8Array;
  frameCount: number;
  sourceMonotonicMs: number;
};

type BufferedChunk = BufferedFrame & {
  sequence: number;
  lossEvidence: OrderedPcmLossEvidence;
};

type InflightChunk = {
  chunk: BufferedChunk;
  sentAtMonotonicMs: number;
};

type StopResult = {
  durationMs: number;
  stoppedMonotonicMs: number;
  acknowledgement: OrderedPcmAck;
};

export class OrderedPcmCaptureError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrderedPcmCaptureError";
    this.code = code;
  }
}

export type OrderedPcmBrowserCapture = {
  startedMonotonicMs: number;
  attachRegistration: (registration: BrowserSessionRegistration) => void;
  stop: () => Promise<StopResult>;
  abort: (reason?: Error) => Promise<void>;
};

export function canUseOrderedPcmCapture(): boolean {
  return Boolean(
    globalThis.isSecureContext &&
      globalThis.crypto?.subtle &&
      typeof globalThis.crypto?.randomUUID === "function" &&
      typeof globalThis.AudioContext !== "undefined" &&
      typeof globalThis.AudioWorkletNode !== "undefined" &&
      typeof globalThis.WebSocket !== "undefined",
  );
}

export async function startOrderedPcmCapture(
  options: OrderedPcmCaptureOptions,
): Promise<OrderedPcmBrowserCapture> {
  const audioContext = new AudioContext({ latencyHint: "interactive" });
  let profile!: OrderedPcmProfile;
  let audioProfileHash = "";
  let transport: OrderedPcmTurnTransport | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let silentOutput: GainNode | undefined;
  let workletStoppedResolve: (() => void) | undefined;
  let workletStopped = new Promise<void>((resolve) => {
    workletStoppedResolve = resolve;
  });
  let workletReadyResolve: (() => void) | undefined;
  let workletReadyReject: ((error: Error) => void) | undefined;
  const workletReady = new Promise<void>((resolve, reject) => {
    workletReadyResolve = resolve;
    workletReadyReject = reject;
  });
  // A track can end while addModule() is still pending. Attach a rejection
  // handler immediately, then await the original promise below so startup
  // failures remain observable without an unhandled-rejection window.
  void workletReady.catch(() => undefined);
  let closed = false;
  let stopping = false;
  let startedMonotonicMs = 0;
  let startupFailure: Error | undefined;

  const failStartupOrTransport = (error: Error) => {
    if (transport) {
      transport.fail(error);
      return;
    }
    startupFailure ??= error;
    workletReadyReject?.(startupFailure);
  };

  const handleInputTrackUnavailable = (event: Event) => {
    if (!closed && !stopping) {
      failStartupOrTransport(new OrderedPcmCaptureError(
        "input_track_unavailable",
        `The microphone track emitted ${event.type}; PCM coverage is incomplete.`,
      ));
    }
  };
  for (const track of options.stream.getAudioTracks()) {
    track.addEventListener("ended", handleInputTrackUnavailable);
    track.addEventListener("mute", handleInputTrackUnavailable);
  }

  const handleAudioContextStateChange = () => {
    if (
      !closed &&
      !stopping &&
      audioContext.state !== "running"
    ) {
      failStartupOrTransport(new OrderedPcmCaptureError(
        "audio_context_interrupted",
        `The browser audio context changed to ${audioContext.state}; PCM coverage is incomplete.`,
      ));
    }
  };
  const handleWorkletProcessorError = () => {
    if (!closed && !stopping) {
      failStartupOrTransport(new OrderedPcmCaptureError(
        "worklet_processor_error",
        "The microphone worklet processor stopped unexpectedly.",
      ));
    }
  };
  audioContext.addEventListener("statechange", handleAudioContextStateChange);

  try {
    const sampleRateHz = Math.round(audioContext.sampleRate);
    if (!(SUPPORTED_ORDERED_PCM_SAMPLE_RATES_HZ as readonly number[]).includes(sampleRateHz)) {
      throw new OrderedPcmCaptureError(
        "unsupported_pcm_profile",
        `This browser exposes ${sampleRateHz} Hz audio; ordered PCM currently supports 16000, 44100, or 48000 Hz.`,
      );
    }
    profile = OrderedPcmProfileSchema.parse({
      sampleFormat: "s16le",
      sampleRateHz,
      channelCount: 1,
    });
    audioProfileHash = await sha256Hex(
      new TextEncoder().encode(canonicalizeOrderedPcmProfile(profile)),
    );
    throwIfStartupFailed();
    const workletUrl = new URL(
      `${import.meta.env.BASE_URL}ordered-pcm-capture-worklet.js?contract=${WORKLET_CONTRACT_VERSION}`,
      window.location.href,
    );
    await withTimeout(
      audioContext.audioWorklet.addModule(workletUrl.toString()),
      WORKLET_LOAD_TIMEOUT_MS,
      new OrderedPcmCaptureError(
        "worklet_load_timeout",
        "The microphone worklet module did not load in time.",
      ),
    );
    throwIfStartupFailed();

    source = audioContext.createMediaStreamSource(options.stream);
    worklet = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: {
        frameDurationMs: CAPTURE_FRAME_DURATION_MS,
      },
    });
    worklet.addEventListener("processorerror", handleWorkletProcessorError);
    silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;

    worklet.port.onmessage = (event: MessageEvent<unknown>) => {
      const message = parseWorkletMessage(event.data);
      if (!message) {
        const error = new OrderedPcmCaptureError(
          "invalid_worklet_message",
          "The microphone worklet emitted an invalid PCM frame.",
        );
        if (transport) {
          transport.fail(error);
        } else {
          workletReadyReject?.(error);
        }
        return;
      }

      if (message.type === "capture.ready") {
        workletReadyResolve?.();
        workletReadyResolve = undefined;
        workletReadyReject = undefined;
        return;
      }

      if (message.type === "capture.stopped") {
        transport?.updateLossEvidence({
          captureGapCount: message.captureGapCount,
          droppedFrameCount: message.droppedFrameCount,
          droppedByteCount: message.droppedFrameCount * profile.channelCount * 2,
          overflowCount: message.overflowCount,
        });
        workletStoppedResolve?.();
        workletStoppedResolve = undefined;
        return;
      }

      transport?.appendFrame({
        pcmBytes: new Uint8Array(message.pcmBuffer),
        frameCount: message.frameCount,
        sourceMonotonicMs: message.sourceMonotonicMs,
      }, {
        captureGapCount: message.captureGapCount,
        droppedFrameCount: message.droppedFrameCount,
        droppedByteCount: message.droppedFrameCount * profile.channelCount * 2,
        overflowCount: message.overflowCount,
      });
      worklet?.port.postMessage({ type: "capture.credit", frameCount: 1 });
    };
    worklet.port.onmessageerror = () => {
      const error = new OrderedPcmCaptureError(
        "worklet_message_error",
        "The browser could not read a PCM frame from the microphone worklet.",
      );
      if (transport) {
        transport.fail(error);
      } else {
        workletReadyReject?.(error);
      }
    };

    source.connect(worklet);
    worklet.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    await withTimeout(
      audioContext.resume(),
      AUDIO_CONTEXT_RESUME_TIMEOUT_MS,
      new OrderedPcmCaptureError(
        "audio_context_resume_timeout",
        "The browser audio context did not resume in time.",
      ),
    );
    if (audioContext.state !== "running") {
      throw new OrderedPcmCaptureError(
        "audio_context_not_running",
        `The browser audio context remained ${audioContext.state} after resume.`,
      );
    }
    throwIfStartupFailed();
    await withTimeout(
      workletReady,
      WORKLET_STOP_TIMEOUT_MS,
      new OrderedPcmCaptureError(
        "worklet_warmup_timeout",
        "The microphone worklet did not reach stable capture cadence.",
      ),
    );
    throwIfStartupFailed();
    assertInputTracksAvailable();
    startedMonotonicMs = performance.now();
    transport = new OrderedPcmTurnTransport({
      apiBaseUrl: options.apiBaseUrl,
      sessionId: options.sessionId,
      sourceId: createSourceId(),
      profile,
      audioProfileHash,
      startedMonotonicMs,
      onFailure: options.onFailure,
    });
    worklet.port.postMessage({
      type: "capture.arm",
      sourceMonotonicOriginMs: startedMonotonicMs,
      frameCredits: WORKLET_FRAME_CREDITS,
    });
  } catch (error) {
    await closeAudioGraph();
    throw normalizeCaptureError(
      error,
      "worklet_start_failed",
      "The browser could not start ordered PCM capture.",
    );
  }

  function throwIfStartupFailed(): void {
    if (startupFailure) {
      throw startupFailure;
    }
  }

  function assertInputTracksAvailable(): void {
    const tracks = options.stream.getAudioTracks();
    if (
      tracks.length === 0 ||
      tracks.some((track) => track.readyState !== "live" || track.muted)
    ) {
      throw new OrderedPcmCaptureError(
        "input_track_unavailable",
        "The microphone track became unavailable before PCM capture was armed.",
      );
    }
  }

  const activeTransport = transport;
  if (!activeTransport || startedMonotonicMs === 0) {
    await closeAudioGraph();
    throw new OrderedPcmCaptureError(
      "worklet_start_failed",
      "The browser did not arm ordered PCM capture.",
    );
  }

  async function closeAudioGraph(): Promise<void> {
    if (closed) {
      return;
    }
    closed = true;
    audioContext.removeEventListener("statechange", handleAudioContextStateChange);
    for (const track of options.stream.getAudioTracks()) {
      track.removeEventListener("ended", handleInputTrackUnavailable);
      track.removeEventListener("mute", handleInputTrackUnavailable);
    }
    worklet?.disconnect();
    worklet?.removeEventListener("processorerror", handleWorkletProcessorError);
    source?.disconnect();
    silentOutput?.disconnect();
    if (audioContext.state !== "closed") {
      await audioContext.close().catch(() => undefined);
    }
  }

  async function stopWorklet(): Promise<void> {
    if (!worklet || closed) {
      return;
    }

    worklet.port.postMessage({ type: "capture.stop" });
    await withTimeout(
      workletStopped,
      WORKLET_STOP_TIMEOUT_MS,
      new OrderedPcmCaptureError(
        "worklet_stop_timeout",
        "The microphone worklet did not flush its final PCM frame in time.",
      ),
    );
  }

  function stopInputTracks(): void {
    for (const track of options.stream.getTracks()) {
      track.stop();
    }
  }

  return {
    startedMonotonicMs,
    attachRegistration(registration) {
      activeTransport.attachRegistration(registration);
    },
    async stop() {
      const stoppedMonotonicMs = performance.now();
      stopping = true;
      try {
        await stopWorklet();
        await closeAudioGraph();
        stopInputTracks();
        const acknowledgement = await activeTransport.stop(stoppedMonotonicMs);
        return {
          durationMs: Math.max(0, stoppedMonotonicMs - startedMonotonicMs),
          stoppedMonotonicMs,
          acknowledgement,
        };
      } catch (error) {
        await closeAudioGraph();
        stopInputTracks();
        const normalizedError = normalizeCaptureError(
          error,
          "ordered_pcm_stop_failed",
          "Ordered PCM capture could not be finalized.",
        );
        // Stop is an awaited operation owned by useRecorder. Abort transport
        // locally and let that caller reconcile a possibly committed result;
        // onFailure is reserved for asynchronous faults during active capture.
        activeTransport.abort(normalizedError);
        throw normalizedError;
      }
    },
    async abort(reason: Error = new OrderedPcmCaptureError(
      "capture_aborted",
      "Ordered PCM capture was aborted.",
    )) {
      stopping = true;
      workletStopped = Promise.resolve();
      activeTransport.abort(reason);
      await closeAudioGraph();
      stopInputTracks();
    },
  };
}

type OrderedPcmTurnTransportOptions = {
  apiBaseUrl: string;
  sessionId: string;
  sourceId: string;
  profile: OrderedPcmProfile;
  audioProfileHash: string;
  startedMonotonicMs: number;
  onFailure: (error: Error) => void;
};

class OrderedPcmTurnTransport {
  private readonly options: OrderedPcmTurnTransportOptions;
  private readonly pendingChunks: BufferedChunk[] = [];
  private readonly inflightChunks = new Map<number, InflightChunk>();
  private readonly turnArchive = new Map<number, BufferedChunk>();
  private readonly aggregateFrames: BufferedFrame[] = [];
  private registration?: BrowserSessionRegistration;
  private socket?: WebSocket;
  private connectTimeout?: number;
  private acknowledgementTimeout?: number;
  private pumpTimer?: number;
  private startAcknowledged = false;
  private stopRequested = false;
  private stopSent = false;
  private preparingStopHash = false;
  private sourcePcmSha256?: string;
  private finalized = false;
  private failure?: Error;
  private pendingByteCount = 0;
  private turnByteCount = 0;
  private aggregateFrameCount = 0;
  private aggregateByteCount = 0;
  private emittedFrameCount = 0;
  private emittedByteCount = 0;
  private nextSequence = 1;
  private highestSentSequence = 0;
  private highestAcknowledgedSequence = 0;
  private lastSourceMonotonicMs: number;
  private lossEvidence: OrderedPcmLossEvidence = emptyLossEvidence();
  private readonly stopPromise: Promise<OrderedPcmAck>;
  private readonly stopSentPromise: Promise<void>;
  private resolveStop!: (acknowledgement: OrderedPcmAck) => void;
  private rejectStop!: (error: Error) => void;
  private resolveStopSent!: () => void;
  private rejectStopSent!: (error: Error) => void;

  constructor(options: OrderedPcmTurnTransportOptions) {
    this.options = options;
    this.lastSourceMonotonicMs = options.startedMonotonicMs;
    this.stopPromise = new Promise<OrderedPcmAck>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    this.stopSentPromise = new Promise<void>((resolve, reject) => {
      this.resolveStopSent = resolve;
      this.rejectStopSent = reject;
    });
    void this.stopPromise.catch(() => undefined);
    void this.stopSentPromise.catch(() => undefined);
  }

  appendFrame(frame: BufferedFrame, lossEvidence: OrderedPcmLossEvidence): void {
    if (this.stopRequested || this.failure || this.finalized) {
      return;
    }
    if (
      frame.frameCount <= 0 ||
      frame.pcmBytes.byteLength !== frame.frameCount * this.options.profile.channelCount * 2
    ) {
      this.fail(new OrderedPcmCaptureError(
        "invalid_pcm_frame",
        "A microphone PCM frame did not match its declared frame count.",
      ));
      return;
    }
    if (!lossEvidenceDoesNotRegress(this.lossEvidence, lossEvidence)) {
      this.fail(new OrderedPcmCaptureError(
        "loss_evidence_regression",
        "Microphone loss evidence moved backwards.",
      ));
      return;
    }

    this.lossEvidence = lossEvidence;
    this.lastSourceMonotonicMs = Math.max(
      this.lastSourceMonotonicMs,
      frame.sourceMonotonicMs,
    );
    this.aggregateFrames.push(frame);
    this.aggregateFrameCount += frame.frameCount;
    this.aggregateByteCount += frame.pcmBytes.byteLength;
    if (this.aggregateFrames.length >= FRAMES_PER_TRANSPORT_CHUNK) {
      this.flushAggregate();
    }
  }

  updateLossEvidence(lossEvidence: OrderedPcmLossEvidence): void {
    if (this.failure || this.finalized) {
      return;
    }
    if (!lossEvidenceDoesNotRegress(this.lossEvidence, lossEvidence)) {
      this.fail(new OrderedPcmCaptureError(
        "loss_evidence_regression",
        "Microphone loss evidence moved backwards.",
      ));
      return;
    }
    this.lossEvidence = lossEvidence;
  }

  attachRegistration(registration: BrowserSessionRegistration): void {
    if (this.registration || this.failure || this.finalized) {
      return;
    }
    if (registration.sessionId !== this.options.sessionId) {
      this.fail(new OrderedPcmCaptureError(
        "session_mismatch",
        "The backend registered a different session for this PCM turn.",
      ));
      return;
    }

    this.registration = registration;
    this.openSocket();
  }

  async stop(stoppedMonotonicMs: number): Promise<OrderedPcmAck> {
    if (this.failure) {
      throw this.failure;
    }
    if (!this.stopRequested) {
      this.stopRequested = true;
      this.lastSourceMonotonicMs = Math.max(
        this.lastSourceMonotonicMs,
        stoppedMonotonicMs,
      );
      this.flushAggregate();
      const sourceDurationMs = Math.max(
        0,
        stoppedMonotonicMs - this.options.startedMonotonicMs,
      );
      const accountedDurationMs =
        (this.emittedFrameCount + this.lossEvidence.droppedFrameCount) /
        this.options.profile.sampleRateHz *
        1_000;
      if (
        Math.abs(sourceDurationMs - accountedDurationMs) >
        MAX_SOURCE_CLOCK_DRIFT_MS
      ) {
        const error = new OrderedPcmCaptureError(
          "source_clock_coverage_mismatch",
          "Captured PCM frames do not cover the source wall-clock interval.",
        );
        this.fail(error);
        throw error;
      }
      this.pump();
    }

    await withTimeout(
      this.stopSentPromise,
      STOP_SEND_TIMEOUT_MS,
      new OrderedPcmCaptureError(
        "stop_send_timeout",
        "The browser could not drain and send audio.stop in time.",
      ),
    );
    return withTimeout(
      this.stopPromise,
      STOP_FINAL_ACK_TIMEOUT_MS,
      new OrderedPcmCaptureError(
        "stop_finalize_timeout",
        "The backend did not confirm the final ordered PCM result in time.",
      ),
    );
  }

  abort(reason: Error = new OrderedPcmCaptureError(
    "capture_aborted",
    "Ordered PCM capture was aborted.",
  )): void {
    if (this.finalized) {
      return;
    }
    this.failure = reason;
    this.clearTimers();
    this.closeSocket(1000, "capture aborted");
    this.releaseBuffers();
    this.rejectStopSent(reason);
    this.rejectStop(reason);
  }

  fail(error: Error): void {
    if (this.failure || this.finalized) {
      return;
    }
    this.failure = error;
    this.clearTimers();
    this.closeSocket(4001, "ordered PCM failure");
    this.rejectStopSent(error);
    this.rejectStop(error);
    if (!this.stopRequested) {
      this.options.onFailure(error);
    }
  }

  private flushAggregate(): void {
    if (this.aggregateFrames.length === 0 || this.failure) {
      return;
    }

    const pcmBytes = new Uint8Array(this.aggregateByteCount);
    let offset = 0;
    for (const frame of this.aggregateFrames) {
      pcmBytes.set(frame.pcmBytes, offset);
      offset += frame.pcmBytes.byteLength;
    }

    const chunk: BufferedChunk = {
      sequence: this.nextSequence,
      pcmBytes,
      frameCount: this.aggregateFrameCount,
      sourceMonotonicMs: this.lastSourceMonotonicMs,
      lossEvidence: { ...this.lossEvidence },
    };
    this.aggregateFrames.length = 0;
    this.aggregateFrameCount = 0;
    this.aggregateByteCount = 0;

    if (
      this.turnByteCount + chunk.pcmBytes.byteLength > MAX_TURN_BYTES ||
      this.pendingByteCount + chunk.pcmBytes.byteLength > MAX_PRECONNECT_BYTES
    ) {
      this.lossEvidence = {
        ...this.lossEvidence,
        droppedFrameCount: this.lossEvidence.droppedFrameCount + chunk.frameCount,
        droppedByteCount:
          this.lossEvidence.droppedByteCount + chunk.pcmBytes.byteLength,
        overflowCount: this.lossEvidence.overflowCount + 1,
      };
      this.fail(new OrderedPcmCaptureError(
        "capture_buffer_overflow",
        "Ordered PCM capture exceeded its bounded browser buffer; no silent fallback was used.",
      ));
      return;
    }

    this.nextSequence += 1;
    this.emittedFrameCount += chunk.frameCount;
    this.emittedByteCount += chunk.pcmBytes.byteLength;
    this.pendingByteCount += chunk.pcmBytes.byteLength;
    this.turnByteCount += chunk.pcmBytes.byteLength;
    this.pendingChunks.push(chunk);
    this.turnArchive.set(chunk.sequence, chunk);
    this.pump();
  }

  private openSocket(): void {
    const registration = this.registration;
    if (!registration || this.failure || this.socket) {
      return;
    }

    const socket = new WebSocket(
      orderedPcmWebSocketUrl(this.options.apiBaseUrl, registration.sessionId),
      ORDERED_PCM_WEBSOCKET_PROTOCOL,
    );
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    this.connectTimeout = window.setTimeout(() => {
      this.fail(new OrderedPcmCaptureError(
        "socket_connect_timeout",
        "The ordered PCM WebSocket did not connect in time.",
      ));
    }, SOCKET_CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.failure || !this.registration) {
        return;
      }
      if (this.connectTimeout !== undefined) {
        window.clearTimeout(this.connectTimeout);
        this.connectTimeout = undefined;
      }
      this.sendBinary({
        protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
        type: "audio.start",
        ...this.identity(),
        sourceMonotonicMs: this.options.startedMonotonicMs,
        pcmProfile: this.options.profile,
      });
      this.armAcknowledgementTimeout(
        "The backend did not acknowledge audio.start in time.",
      );
    });
    socket.addEventListener("message", (event) => this.handleServerMessage(event.data));
    socket.addEventListener("error", () => {
      this.fail(new OrderedPcmCaptureError(
        "socket_error",
        "The ordered PCM WebSocket failed.",
      ));
    });
    socket.addEventListener("close", (event) => {
      if (!this.finalized && !this.failure) {
        this.fail(new OrderedPcmCaptureError(
          "socket_closed",
          `The ordered PCM WebSocket closed before finalization (${event.code}).`,
        ));
      }
    });
  }

  private handleServerMessage(rawMessage: unknown): void {
    if (this.failure || this.finalized) {
      return;
    }
    if (typeof rawMessage !== "string") {
      this.fail(new OrderedPcmCaptureError(
        "invalid_server_message",
        "The ordered PCM server response was not JSON text.",
      ));
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawMessage);
    } catch {
      this.fail(new OrderedPcmCaptureError(
        "invalid_server_message",
        "The ordered PCM server response was not valid JSON.",
      ));
      return;
    }

    const parsed = OrderedPcmOutboundMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.fail(new OrderedPcmCaptureError(
        "invalid_server_message",
        parsed.error.issues[0]?.message ?? "The ordered PCM response was invalid.",
      ));
      return;
    }
    const message = parsed.data;
    if (message.type === "audio.error") {
      this.fail(new OrderedPcmCaptureError(message.code, message.message));
      return;
    }
    if (!this.matchesIdentity(message)) {
      this.fail(new OrderedPcmCaptureError(
        "ack_identity_mismatch",
        "The ordered PCM acknowledgement belongs to another capture attempt.",
      ));
      return;
    }

    if (message.acknowledgedType === "audio.start") {
      if (this.startAcknowledged) {
        this.fail(new OrderedPcmCaptureError(
          "duplicate_start_ack",
          "The backend acknowledged audio.start more than once.",
        ));
        return;
      }
      this.clearAcknowledgementTimeout();
      this.startAcknowledged = true;
      this.pump();
      return;
    }
    if (message.acknowledgedType === "audio.chunk") {
      this.handleChunkAcknowledgement(message.acknowledgedSequence);
      return;
    }

    if (
      !this.stopSent ||
      message.acknowledgedSequence !== this.nextSequence - 1 ||
      !message.receipt
    ) {
      this.fail(new OrderedPcmCaptureError(
        "invalid_stop_ack",
        "The backend did not return the finalized receipt for this PCM turn.",
      ));
      return;
    }

    this.finalized = true;
    this.clearTimers();
    this.releaseBuffers();
    this.resolveStop(message);
    this.closeSocket(1000, "turn finalized");
  }

  private handleChunkAcknowledgement(sequence: number): void {
    if (
      sequence < this.highestAcknowledgedSequence ||
      sequence > this.highestSentSequence
    ) {
      this.fail(new OrderedPcmCaptureError(
        "invalid_chunk_ack",
        "The backend returned an invalid cumulative PCM acknowledgement.",
      ));
      return;
    }

    if (sequence === this.highestAcknowledgedSequence) {
      return;
    }

    this.clearAcknowledgementTimeout();
    this.highestAcknowledgedSequence = sequence;
    for (const [inflightSequence, inflight] of this.inflightChunks) {
      if (inflightSequence <= sequence) {
        this.inflightChunks.delete(inflightSequence);
        this.pendingByteCount -= inflight.chunk.pcmBytes.byteLength;
      }
    }
    this.pump();
  }

  private pump(): void {
    if (
      this.failure ||
      this.finalized ||
      !this.startAcknowledged ||
      this.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    if (this.socket.bufferedAmount > MAX_WEBSOCKET_BUFFERED_BYTES) {
      if (this.pumpTimer === undefined) {
        this.pumpTimer = window.setTimeout(() => {
          this.pumpTimer = undefined;
          this.pump();
        }, 10);
      }
      return;
    }

    while (
      !this.failure &&
      !this.finalized &&
      this.pendingChunks.length > 0 &&
      this.inflightChunks.size < MAX_INFLIGHT_CHUNKS &&
      this.socket.bufferedAmount <= MAX_WEBSOCKET_BUFFERED_BYTES
    ) {
      const chunk = this.pendingChunks.shift();
      if (!chunk) {
        break;
      }
      this.sendBinary({
        protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
        type: "audio.chunk",
        ...this.identity(),
        sequence: chunk.sequence,
        sourceMonotonicMs: chunk.sourceMonotonicMs,
        frameCount: chunk.frameCount,
        byteCount: chunk.pcmBytes.byteLength,
        lossEvidence: chunk.lossEvidence,
        pcmBytes: chunk.pcmBytes,
      });
      if (this.failure) {
        break;
      }
      this.inflightChunks.set(chunk.sequence, {
        chunk,
        sentAtMonotonicMs: performance.now(),
      });
      this.highestSentSequence = chunk.sequence;
    }

    if (
      this.inflightChunks.size > 0 &&
      this.acknowledgementTimeout === undefined
    ) {
      this.armChunkAcknowledgementTimeout();
    }

    if (
      this.stopRequested &&
      !this.stopSent &&
      this.pendingChunks.length === 0 &&
      this.inflightChunks.size === 0
    ) {
      if (!this.sourcePcmSha256) {
        if (!this.preparingStopHash) {
          this.preparingStopHash = true;
          void this.prepareStopHash();
        }
        return;
      }
      this.stopSent = true;
      this.clearAcknowledgementTimeout();
      this.sendBinary({
        protocolVersion: ORDERED_PCM_PROTOCOL_VERSION,
        type: "audio.stop",
        ...this.identity(),
        sourceMonotonicMs: this.lastSourceMonotonicMs,
        finalSequence: this.nextSequence - 1,
        emittedFrameCount: this.emittedFrameCount,
        emittedByteCount: this.emittedByteCount,
        lossEvidence: this.lossEvidence,
        sourcePcmSha256: this.sourcePcmSha256,
      });
      if (!this.failure) {
        this.resolveStopSent();
      }
    }
  }

  private async prepareStopHash(): Promise<void> {
    try {
      const turnPcm = new Uint8Array(this.turnByteCount);
      let offset = 0;
      for (let sequence = 1; sequence < this.nextSequence; sequence += 1) {
        const chunk = this.turnArchive.get(sequence);
        if (!chunk) {
          throw new OrderedPcmCaptureError(
            "turn_archive_incomplete",
            `The bounded turn archive is missing PCM chunk ${sequence}.`,
          );
        }
        turnPcm.set(chunk.pcmBytes, offset);
        offset += chunk.pcmBytes.byteLength;
      }
      if (offset !== this.turnByteCount) {
        throw new OrderedPcmCaptureError(
          "turn_archive_incomplete",
          "The bounded turn archive byte total is inconsistent.",
        );
      }
      const sourcePcmSha256 = await sha256Hex(turnPcm);
      if (this.failure || this.finalized) {
        return;
      }
      this.sourcePcmSha256 = sourcePcmSha256;
      this.pump();
    } catch (error) {
      this.fail(normalizeCaptureError(
        error,
        "turn_hash_failed",
        "The browser could not hash the captured PCM turn.",
      ));
    }
  }

  private sendBinary(message: Parameters<typeof encodeOrderedPcmBinaryEnvelope>[0]): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.fail(new OrderedPcmCaptureError(
        "socket_not_open",
        "The ordered PCM WebSocket is not open.",
      ));
      return;
    }
    try {
      socket.send(encodeOrderedPcmBinaryEnvelope(message));
    } catch (error) {
      this.fail(normalizeCaptureError(
        error,
        "socket_send_failed",
        "The browser could not send an ordered PCM message.",
      ));
    }
  }

  private identity() {
    const registration = this.registration;
    if (!registration) {
      throw new OrderedPcmCaptureError(
        "registration_missing",
        "Ordered PCM transport has no registered attempt.",
      );
    }
    return {
      sessionId: registration.sessionId,
      attemptId: registration.attemptId,
      sourceId: this.options.sourceId,
      audioProfileHash: this.options.audioProfileHash,
    };
  }

  private matchesIdentity(message: OrderedPcmAck): boolean {
    const identity = this.identity();
    return message.sessionId === identity.sessionId &&
      message.attemptId === identity.attemptId &&
      message.sourceId === identity.sourceId &&
      message.audioProfileHash === identity.audioProfileHash;
  }

  private clearTimers(): void {
    if (this.connectTimeout !== undefined) {
      window.clearTimeout(this.connectTimeout);
      this.connectTimeout = undefined;
    }
    if (this.pumpTimer !== undefined) {
      window.clearTimeout(this.pumpTimer);
      this.pumpTimer = undefined;
    }
    this.clearAcknowledgementTimeout();
  }

  private armAcknowledgementTimeout(message: string): void {
    if (this.failure || this.finalized) {
      return;
    }
    this.clearAcknowledgementTimeout();
    this.acknowledgementTimeout = window.setTimeout(() => {
      this.acknowledgementTimeout = undefined;
      this.fail(new OrderedPcmCaptureError(
        "ack_progress_timeout",
        message,
      ));
    }, ACK_PROGRESS_TIMEOUT_MS);
  }

  private armChunkAcknowledgementTimeout(): void {
    const oldestInflight = this.inflightChunks.values().next().value as
      | InflightChunk
      | undefined;
    if (!oldestInflight || this.failure || this.finalized) {
      this.clearAcknowledgementTimeout();
      return;
    }
    this.clearAcknowledgementTimeout();
    const remainingMs = Math.max(
      0,
      ACK_PROGRESS_TIMEOUT_MS -
        (performance.now() - oldestInflight.sentAtMonotonicMs),
    );
    this.acknowledgementTimeout = window.setTimeout(() => {
      this.acknowledgementTimeout = undefined;
      this.fail(new OrderedPcmCaptureError(
        "ack_progress_timeout",
        "The backend stopped acknowledging ordered PCM chunks.",
      ));
    }, remainingMs);
  }

  private clearAcknowledgementTimeout(): void {
    if (this.acknowledgementTimeout !== undefined) {
      window.clearTimeout(this.acknowledgementTimeout);
      this.acknowledgementTimeout = undefined;
    }
  }

  private closeSocket(code: number, reason: string): void {
    try {
      this.socket?.close(code, reason);
    } catch {
      // Local state and the canonical session error remain authoritative even
      // when the browser refuses a close while the handshake is still moving.
    }
  }

  private releaseBuffers(): void {
    this.aggregateFrames.length = 0;
    this.pendingChunks.length = 0;
    this.inflightChunks.clear();
    this.turnArchive.clear();
    this.pendingByteCount = 0;
    this.turnByteCount = 0;
  }
}

function orderedPcmWebSocketUrl(apiBaseUrl: string, sessionId: string): string {
  const url = new URL(apiBaseUrl, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/sessions/${encodeURIComponent(sessionId)}/audio-stream`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseWorkletMessage(value: unknown): WorkletMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }
  if (value.type === "capture.ready") {
    if (value.contractVersion !== WORKLET_CONTRACT_VERSION) {
      return undefined;
    }
    return {
      type: "capture.ready",
      contractVersion: value.contractVersion,
    };
  }
  if (value.type === "capture.stopped") {
    if (
      !isNonNegativeInteger(value.captureGapCount) ||
      !isNonNegativeInteger(value.droppedFrameCount) ||
      !isNonNegativeInteger(value.overflowCount)
    ) {
      return undefined;
    }
    return {
      type: "capture.stopped",
      captureGapCount: value.captureGapCount,
      droppedFrameCount: value.droppedFrameCount,
      overflowCount: value.overflowCount,
    };
  }
  if (
    value.type !== "pcm.frame" ||
    !(value.pcmBuffer instanceof ArrayBuffer) ||
    !isNonNegativeInteger(value.frameCount) ||
    value.frameCount === 0 ||
    value.pcmBuffer.byteLength !== value.frameCount * 2 ||
    typeof value.sourceMonotonicMs !== "number" ||
    !Number.isFinite(value.sourceMonotonicMs) ||
    value.sourceMonotonicMs < 0 ||
    !isNonNegativeInteger(value.captureGapCount) ||
    !isNonNegativeInteger(value.droppedFrameCount) ||
    !isNonNegativeInteger(value.overflowCount)
  ) {
    return undefined;
  }
  return {
    type: "pcm.frame",
    pcmBuffer: value.pcmBuffer,
    frameCount: value.frameCount,
    sourceMonotonicMs: value.sourceMonotonicMs,
    captureGapCount: value.captureGapCount,
    droppedFrameCount: value.droppedFrameCount,
    overflowCount: value.overflowCount,
  };
}

function lossEvidenceDoesNotRegress(
  previous: OrderedPcmLossEvidence,
  next: OrderedPcmLossEvidence,
): boolean {
  return next.captureGapCount >= previous.captureGapCount &&
    next.droppedFrameCount >= previous.droppedFrameCount &&
    next.droppedByteCount >= previous.droppedByteCount &&
    next.overflowCount >= previous.overflowCount;
}

function emptyLossEvidence(): OrderedPcmLossEvidence {
  return {
    captureGapCount: 0,
    droppedFrameCount: 0,
    droppedByteCount: 0,
    overflowCount: 0,
  };
}

function createSourceId(): string {
  return `browser-mic-${crypto.randomUUID()}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function withTimeout<T>(
  action: Promise<T>,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(timeoutError), timeoutMs);
  });
  try {
    return await Promise.race([action, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeCaptureError(
  error: unknown,
  code: string,
  fallbackMessage: string,
): Error {
  if (error instanceof Error) {
    return error;
  }
  return new OrderedPcmCaptureError(code, fallbackMessage);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
