import type {
  AudioFeatures,
  NormalizedAudio,
  PipelineReceipt,
  Reading,
  ReadingChannel,
  RuntimeSource,
  SessionEvent,
  SessionPhase,
  SessionReceipt,
  SessionResult,
  SessionStatus,
  SignalState,
  SttProviderReceipt,
  TranscriptResult,
  UploadedAudio
} from "@jiko/protocol";
import { SessionResultSchema } from "@jiko/protocol";

export type SessionReadings = Partial<Record<ReadingChannel, Reading>>;

export type SessionMachineState = {
  sessionId?: string;
  attemptId?: string;
  lastSequence: number;
  phase: SessionPhase;
  source?: RuntimeSource;
  createdAt?: number;
  updatedAt?: number;
  uploadedAudio?: UploadedAudio;
  normalizedAudio?: NormalizedAudio;
  transcript?: TranscriptResult;
  features?: AudioFeatures;
  readings: SessionReadings;
  result?: SessionResult;
  errors: string[];
};

export type InstrumentPhase =
  | "idle"
  | "recording"
  | "processing"
  | "result"
  | "error";

export type InstrumentLampTone = "red" | "amber" | "green" | "dim";
export type InstrumentLampMotion = "resting" | "spinning" | "locked";
export type InstrumentLampTones = Record<ReadingChannel, InstrumentLampTone>;
export type InstrumentLampMotions = Record<ReadingChannel, InstrumentLampMotion>;

/**
 * Framework-neutral state for the four-window instrument face. Both runtime
 * shells project this scene from the canonical session state; transport and
 * animation adapters may temporarily decorate it, but they do not decide the
 * product reading.
 */
export type InstrumentScene = {
  phase: InstrumentPhase;
  topTitle: string;
  topSubtitle: string;
  lamps: InstrumentLampTones;
  lampMotions: InstrumentLampMotions;
};

const READING_CHANNELS: readonly ReadingChannel[] = ["text", "voice", "timing"];
const SIGNAL_STATES: readonly SignalState[] = ["maintain", "deviate", "static"];

export function createIdleInstrumentScene(): InstrumentScene {
  return {
    phase: "idle",
    topTitle: "READY",
    topSubtitle: "IDLE",
    lamps: allLampTones("amber"),
    lampMotions: allLampMotions("resting")
  };
}

export function projectInstrumentScene(
  state: SessionMachineState
): InstrumentScene {
  switch (state.phase) {
    case "idle":
    case "reset":
      return createIdleInstrumentScene();
    case "armed":
    case "recording":
      return {
        phase: "recording",
        topTitle: "REC",
        topSubtitle: "LISTENING",
        lamps: allLampTones("amber"),
        lampMotions: allLampMotions("resting")
      };
    case "processing":
    case "reading":
      return projectProcessingScene(state.readings);
    case "result":
    case "silence":
      return state.result
        ? projectResultScene(state.result)
        : projectProcessingScene(state.readings);
    case "error":
      return {
        phase: "error",
        topTitle: "ERROR",
        topSubtitle: compactInstrumentMessage(
          state.errors[state.errors.length - 1] ?? "RESET"
        ),
        // A runtime failure is unclear, not a red verdict.
        lamps: allLampTones("amber"),
        lampMotions: allLampMotions("resting")
      };
    default:
      return assertNeverPhase(state.phase);
  }
}

function projectProcessingScene(readings: SessionReadings): InstrumentScene {
  const lamps = allLampTones("dim");
  const lampMotions = allLampMotions("spinning");

  for (const channel of READING_CHANNELS) {
    const reading = readings[channel];
    if (!reading) {
      continue;
    }

    lamps[channel] = lampToneForReading(reading);
    lampMotions[channel] = "locked";
  }

  return {
    phase: "processing",
    topTitle: "READING",
    topSubtitle: "PROCESSING",
    lamps,
    lampMotions
  };
}

function projectResultScene(result: SessionResult): InstrumentScene {
  const lamps = allLampTones("dim");
  for (const reading of result.readings) {
    lamps[reading.channel] = lampToneForReading(reading);
  }

  return {
    phase: "result",
    topTitle: result.topWindow.lineZh.trim() || result.topWindow.lineEn.trim() || "RESULT",
    topSubtitle:
      result.topWindow.lineEn.trim() ||
      result.topWindow.status.replace(/_/g, " ").toUpperCase() ||
      "LOCKED",
    lamps,
    lampMotions: allLampMotions("locked")
  };
}

function lampToneForReading(reading: Reading): InstrumentLampTone {
  if (reading.availability === "unavailable") {
    return "dim";
  }

  // Red means maintain / inertia, green means deviate / opening, and amber
  // means static / not-yet-formed. These are signals, not good/bad scores.
  if (reading.state === "maintain") {
    return "red";
  }
  if (reading.state === "deviate") {
    return "green";
  }
  return "amber";
}

function allLampTones(tone: InstrumentLampTone): InstrumentLampTones {
  return { text: tone, voice: tone, timing: tone };
}

function allLampMotions(motion: InstrumentLampMotion): InstrumentLampMotions {
  return { text: motion, voice: motion, timing: motion };
}

function compactInstrumentMessage(message: string): string {
  const compact = message.trim().replace(/\s+/g, " ");
  return (compact || "RESET").slice(0, 22).toUpperCase();
}

function assertNeverPhase(value: never): never {
  throw new Error(`Unhandled session phase: ${String(value)}`);
}

const SESSION_EVENT_PHASES: Partial<
  Record<SessionEvent["type"], ReadonlySet<SessionPhase | "created">>
> = {
  "session.created": new Set(["created"]),
  "input.recording.started": new Set(["created", "idle"]),
  "input.recording.stopped": new Set(["recording"]),
  "audio.uploaded": new Set(["created", "recording", "processing"]),
  "audio.normalized": new Set(["processing"]),
  "audio.transcribed": new Set(["created", "processing"]),
  "audio.features.extracted": new Set(["processing"]),
  "reading.started": new Set(["processing"]),
  "reading.channel.resolved": new Set(["reading"]),
  "session.result": new Set(["reading"]),
  "tts.started": new Set(["result"]),
  "tts.finished": new Set(["result"]),
  "session.silence": new Set(["result"])
};

export function canApplySessionEvent(
  phase: SessionPhase | "created",
  eventType: SessionEvent["type"]
): boolean {
  if (phase === "reset") {
    return false;
  }

  if (phase === "error") {
    return eventType === "session.reset";
  }

  if (eventType === "session.reset" || eventType === "session.error") {
    return true;
  }

  return SESSION_EVENT_PHASES[eventType]?.has(phase) ?? false;
}

export function canAcceptExternalEvent(
  phase: SessionPhase | "created",
  eventType: SessionEvent["type"]
): boolean {
  const externalTypes = new Set<SessionEvent["type"]>([
    "input.recording.started",
    "input.recording.stopped",
    "session.silence",
    "session.reset",
    "session.error"
  ]);
  return externalTypes.has(eventType) && canApplySessionEvent(phase, eventType);
}

export function createInitialSessionState(
  sessionId?: string,
  attemptId?: string
): SessionMachineState {
  return {
    sessionId,
    attemptId,
    lastSequence: 0,
    phase: "idle",
    readings: {},
    errors: []
  };
}

export function reduceSessionEvent(
  state: SessionMachineState,
  event: SessionEvent
): SessionMachineState {
  const disposition = classifySessionEvent(state, event);
  if (disposition === "duplicate") {
    return state;
  }
  if (disposition !== "apply") {
    throw new Error(
      `Cannot apply ${event.type} (${event.sessionId}/${event.attemptId}/${event.sequence}): ${disposition}`
    );
  }

  // The protocol/store calls the pre-input state `created`, while the product
  // UI renders it as `idle`. Translate that one representation boundary before
  // enforcing the same transition contract used by the server store.
  const transitionPhase: SessionPhase | "created" =
    state.phase === "idle" ? "created" : state.phase;
  const repeatsCreation = event.type === "session.created" && state.lastSequence > 0;
  if (repeatsCreation || !canApplySessionEvent(transitionPhase, event.type)) {
    throw new Error(
      `Cannot apply ${event.type} from phase ${state.phase}: invalid_transition`
    );
  }

  const baseState = {
    ...state,
    sessionId: event.sessionId,
    attemptId: event.attemptId,
    lastSequence: event.sequence,
    source: event.source ?? state.source,
    updatedAt: event.timestamp
  };

  switch (event.type) {
    case "session.created":
      return {
        ...createInitialSessionState(event.sessionId, event.attemptId),
        lastSequence: event.sequence,
        source: event.source,
        createdAt: event.timestamp,
        updatedAt: event.timestamp
      };
    case "input.recording.started":
      return {
        ...baseState,
        phase: "recording"
      };
    case "input.recording.stopped":
      return {
        ...baseState,
        phase: "processing"
      };
    case "audio.uploaded":
      return {
        ...baseState,
        phase: "processing",
        uploadedAudio: event.audio
      };
    case "audio.normalized":
      return {
        ...baseState,
        phase: "processing",
        normalizedAudio: event.audio
      };
    case "audio.transcribed":
      return {
        ...baseState,
        phase: "processing",
        transcript: event.transcript
      };
    case "audio.features.extracted":
      return {
        ...baseState,
        phase: "processing",
        features: event.features
      };
    case "reading.started":
      return {
        ...baseState,
        phase: "reading"
      };
    case "reading.channel.resolved":
      return {
        ...baseState,
        phase: "reading",
        readings: {
          ...state.readings,
          [event.reading.channel]: event.reading
        }
      };
    case "session.result":
      return {
        ...baseState,
        phase: "result",
        result: event.result,
        readings: readingsByChannel(event.result.readings)
      };
    case "tts.started":
    case "tts.finished":
      return {
        ...baseState,
        phase: state.phase
      };
    case "session.silence":
      return {
        ...baseState,
        phase: "silence"
      };
    case "session.reset":
      return {
        ...createInitialSessionState(event.sessionId, event.attemptId),
        lastSequence: event.sequence,
        phase: "reset",
        source: event.source,
        updatedAt: event.timestamp
      };
    case "session.error":
      return {
        ...baseState,
        phase: "error",
        errors: [...state.errors, event.message]
      };
    default:
      return assertNever(event as never);
  }
}

export type SessionEventCursor = {
  sessionId?: string;
  attemptId?: string;
  lastSequence: number;
};

export type SessionEventDisposition =
  | "apply"
  | "duplicate"
  | "foreign_session"
  | "foreign_attempt"
  | "sequence_gap";

/**
 * Classifies an event before it mutates a per-session projection. This is used
 * by both the shared state machine and UI stream adapters so a global or
 * reconnecting transport cannot silently splice two turns together.
 */
export function classifySessionEvent(
  cursor: SessionEventCursor,
  event: SessionEvent
): SessionEventDisposition {
  if (cursor.sessionId && event.sessionId !== cursor.sessionId) {
    return "foreign_session";
  }

  if (cursor.attemptId && event.attemptId !== cursor.attemptId) {
    return "foreign_attempt";
  }

  if (event.sequence <= cursor.lastSequence) {
    return "duplicate";
  }

  if (event.sequence !== cursor.lastSequence + 1) {
    return "sequence_gap";
  }

  return "apply";
}

export type ComposeSessionResultInput = {
  sessionId: string;
  readings: Reading[];
  silenceMs?: number;
};

export function composeSessionResult(
  input: ComposeSessionResultInput
): SessionResult {
  const coverage = buildReadingCoverage(input.readings);
  const availableReadings = input.readings.filter(
    (reading) => reading.availability !== "unavailable"
  );
  const majorityState = getMajorityState(availableReadings);
  const presentStates = uniqueStates(availableReadings);
  const minorityStates = majorityState
    ? presentStates.filter((state) => state !== majorityState)
    : presentStates;
  const topWindow = buildTopWindow(
    majorityState,
    minorityStates,
    availableReadings,
    input.sessionId,
    coverage
  );

  return SessionResultSchema.parse({
    sessionId: input.sessionId,
    readings: input.readings,
    majorityState,
    minorityStates,
    topWindow,
    coverage,
    tts: buildTts(topWindow, majorityState, minorityStates, availableReadings),
    colors: buildColorAssignments(input.readings, topWindow.status),
    silenceMs: input.silenceMs
  });
}

export function composeSessionReceipt(
  state: SessionMachineState,
  options: {
    startedAt: string;
    finishedAt?: string;
    pipeline?: PipelineReceipt;
  }
): SessionReceipt {
  return {
    schemaVersion: "session_receipt_v1",
    sessionId: requireSessionId(state),
    attemptId: requireAttemptId(state),
    lastSequence: state.lastSequence,
    startedAt: options.startedAt,
    updatedAt: new Date(
      state.updatedAt ?? state.createdAt ?? Date.parse(options.startedAt)
    ).toISOString(),
    finishedAt: options.finishedAt,
    status: receiptStatusForPhase(state.phase),
    source: state.source ?? "server",
    input: {
      audioStored: false,
      ...(state.uploadedAudio ? { audio: state.uploadedAudio } : {}),
      ...(state.normalizedAudio
        ? { normalizedAudio: state.normalizedAudio }
        : {})
    },
    providers: {
      stt: state.transcript
        ? fallbackSttProviderReceipt(state.transcript)
        : undefined
    },
    transcript: state.transcript,
    features: state.features,
    pipeline: options.pipeline,
    readings: Object.values(state.readings),
    result: state.result,
    events: [],
    errors: state.errors
  };
}

function fallbackSttProviderReceipt(
  transcript: TranscriptResult
): SttProviderReceipt {
  return {
    id: transcript.provider,
    latencyMs: transcript.latencyMs,
    remote: false,
    outcome: transcript.failureCode ??
      (transcript.provider === "local:manual" ? "not_run" : "completed")
  };
}

function receiptStatusForPhase(phase: SessionPhase): SessionStatus {
  if (phase === "idle" || phase === "armed") {
    return "created";
  }

  return phase;
}

function requireAttemptId(state: SessionMachineState): string {
  if (!state.attemptId) {
    throw new Error("Cannot compose a receipt without an attempt id");
  }

  return state.attemptId;
}

function readingsByChannel(readings: Reading[]): SessionReadings {
  return readings.reduce<SessionReadings>((indexedReadings, reading) => {
    return {
      ...indexedReadings,
      [reading.channel]: reading
    };
  }, {});
}

function uniqueStates(readings: Reading[]): SignalState[] {
  const states = new Set(readings.map((reading) => reading.state));
  return SIGNAL_STATES.filter((state) => states.has(state));
}

function buildReadingCoverage(
  readings: Reading[]
): NonNullable<SessionResult["coverage"]> {
  const unavailableChannels = READING_CHANNELS.filter((channel) =>
    readings.some(
      (reading) =>
        reading.channel === channel && reading.availability === "unavailable"
    )
  );

  return {
    total: readings.length,
    measured: readings.filter(
      (reading) => !reading.availability || reading.availability === "measured"
    ).length,
    simulated: readings.filter(
      (reading) => reading.availability === "simulated"
    ).length,
    unavailable: unavailableChannels.length,
    unavailableChannels
  };
}

function getMajorityState(readings: Reading[]): SignalState | undefined {
  if (readings.length === 0) {
    return undefined;
  }

  const counts = readings.reduce<Record<SignalState, number>>(
    (stateCounts, reading) => {
      return {
        ...stateCounts,
        [reading.state]: stateCounts[reading.state] + 1
      };
    },
    {
      maintain: 0,
      deviate: 0,
      static: 0
    }
  );

  const majority = Object.entries(counts).find(
    ([, count]) => count > readings.length / 2
  );

  return majority?.[0] as SignalState | undefined;
}

// Copy repository. Each bucket holds a representative English line and a pool of
// Chinese candidates (from docs/result-copy.md); one zh line is selected from
// the session id so retries and receipts reproduce the same verdict copy.
const COPY_BUCKETS = {
  // Tie / unclear / all-static — the yellow state.
  static: {
    lineEn: "The signal will not settle.",
    lineZh: [
      "信号没有站稳。\n这一轮先别相信。",
      "这页被风吹乱了。\n稍后再看。",
      "灯还没形成方向。\n不要急着读它。",
      "声音没有落地。\n再靠近一点。",
      "这一轮太短。\n答案还没醒。"
    ]
  },
  // A minority diverges from the majority.
  minority: {
    lineEn: "A side signal remains.",
    lineZh: [
      "路的另一边有信号。\n它还没有熄灭。",
      "有个答案站了起来。\n偏离不是错误。",
      "不是所有灯都看向同处。\n你身上仍有回声。",
      "有一盏没有归队。\n先别急着按下它。",
      "小路亮了一下。\n不代表你要走，但它在。",
      "另一种你没有消失。\n它只是比较小声。"
    ]
  },
  // Unanimous — all readings agree.
  unanimous: {
    lineEn: "All answers rose. You remain.",
    lineZh: [
      "太一致了。\n但一致不等于答案。",
      "三盏灯看向同处。\n这不是许可。",
      "这次没有异声。\n系统合上了，你没有。",
      "答案太整齐了。\n它们都同意，但你还在。",
      "没有反对声。\n但这不等于通过。",
      "路面很平。\n脚还在你这里。"
    ]
  },
  // All readings hold / maintain — inertia.
  maintain: {
    lineEn: "The familiar path lit first.",
    lineZh: [
      "熟路先亮了。\n但熟悉不是答案。",
      "旧答案回来了。\n它很会发光。",
      "你正在靠近原路。\n先别把省力当作同意。",
      "系统看见了惯性。\n你还可以不照做。",
      "多数选择维持。\nNOT FIXED。"
    ]
  }
} as const;

function pickLine(pool: readonly string[], seed: string): string {
  let hash = 2166136261;

  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return pool[(hash >>> 0) % pool.length] ?? pool[0];
}

function topWindowFromBucket(
  status: SessionResult["topWindow"]["status"],
  bucket: keyof typeof COPY_BUCKETS,
  sessionId: string
): SessionResult["topWindow"] {
  return {
    status,
    lineEn: COPY_BUCKETS[bucket].lineEn,
    lineZh: pickLine(COPY_BUCKETS[bucket].lineZh, `${bucket}:${sessionId}`)
  };
}

function buildTopWindow(
  majorityState: SignalState | undefined,
  minorityStates: SignalState[],
  readings: Reading[],
  sessionId: string,
  coverage: NonNullable<SessionResult["coverage"]>
): SessionResult["topWindow"] {
  if (coverage.unavailable > 0) {
    if (readings.length < 2 || !majorityState) {
      return {
        status: "insufficient",
        lineEn: "Not enough signal.",
        lineZh: "有一路没有抵达。\n这一轮先不要相信。"
      };
    }

    return {
      status: "partial",
      lineEn: "One signal is unavailable.",
      lineZh: "有一路没有抵达。\n先只看见已经亮起的。"
    };
  }

  if (readings.length === 0) {
    return {
      status: "empty",
      lineEn: "Waiting for signal.",
      lineZh: "等待读数。"
    };
  }

  // Tie: no state holds a majority — the yellow / unsettled verdict.
  if (!majorityState) {
    return topWindowFromBucket("mixed", "static", sessionId);
  }

  if (minorityStates.length > 0) {
    return topWindowFromBucket("minority_exists", "minority", sessionId);
  }

  if (majorityState === "maintain") {
    return topWindowFromBucket("consensus_maintain", "maintain", sessionId);
  }

  if (majorityState === "deviate") {
    return topWindowFromBucket("consensus_deviate", "unanimous", sessionId);
  }

  return topWindowFromBucket("consensus_static", "static", sessionId);
}

function buildTts(
  topWindow: SessionResult["topWindow"],
  majorityState: SignalState | undefined,
  minorityStates: SignalState[],
  readings: Reading[]
): SessionResult["tts"] {
  if (topWindow.status === "partial" || topWindow.status === "insufficient") {
    return undefined;
  }

  if (readings.length === 0) {
    return undefined;
  }

  if (!majorityState) {
    return {
      language: "zh",
      text: clipText("mixed.no-majority"),
      clipKey: "mixed.no-majority"
    };
  }

  if (minorityStates.length > 0) {
    const clipKey = `minority.${majorityState}`;
    return {
      language: "zh",
      text: clipText(clipKey),
      clipKey
    };
  }

  const clipKey = `consensus.${majorityState}`;
  return {
    language: "zh",
    text: clipText(clipKey),
    clipKey
  };
}

const CLIP_TEXT: Record<string, string> = {
  "mixed.no-majority": "没有多数。",
  "minority.maintain": "两项维持。一项不同。路的另一边有信号。它还没有熄灭。",
  "minority.deviate": "两项偏离。一项不同。路的另一边有信号。它还没有熄灭。",
  "minority.static": "两项静止。一项不同。路的另一边有信号。它还没有熄灭。",
  "consensus.maintain": "太一致了。但一致不等于答案。",
  "consensus.deviate": "答案太整齐了。它们都同意，但你还在。",
  "consensus.static": "这次没有异声。系统合上了，你没有。"
};

function clipText(clipKey: string): string {
  return CLIP_TEXT[clipKey] ?? "信号已经落定。"
}

function buildColorAssignments(
  readings: Reading[],
  topWindowStatus: SessionResult["topWindow"]["status"]
): Record<string, string> {
  const assignments = readings.reduce<Record<string, string>>(
    (colors, reading) => {
      return {
        ...colors,
        [reading.channel]: reading.availability === "unavailable"
          ? "signal.unavailable"
          : `signal.${reading.state}`
      };
    },
    {}
  );

  return {
    ...assignments,
    topWindow: `result.${topWindowStatus}`
  };
}

function requireSessionId(state: SessionMachineState): string {
  if (!state.sessionId) {
    throw new Error("Cannot compose a receipt without a sessionId.");
  }

  return state.sessionId;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled session event: ${JSON.stringify(value)}`);
}
