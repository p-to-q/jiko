import type {
  AudioFeatures,
  NormalizedAudio,
  Reading,
  ReadingChannel,
  RuntimeSource,
  SessionEvent,
  SessionPhase,
  SessionReceipt,
  SessionResult,
  SignalState,
  TranscriptResult,
  UploadedAudio
} from "@jiko/protocol";

export type SessionReadings = Partial<Record<ReadingChannel, Reading>>;

export type SessionMachineState = {
  sessionId?: string;
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

export function createInitialSessionState(
  sessionId?: string
): SessionMachineState {
  return {
    sessionId,
    phase: "idle",
    readings: {},
    errors: []
  };
}

export function reduceSessionEvent(
  state: SessionMachineState,
  event: SessionEvent
): SessionMachineState {
  const baseState = {
    ...state,
    sessionId: event.sessionId,
    source: event.source ?? state.source,
    updatedAt: event.timestamp
  };

  switch (event.type) {
    case "session.created":
      return {
        ...createInitialSessionState(event.sessionId),
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
        phase: state.phase === "silence" ? "silence" : "result"
      };
    case "session.silence":
      return {
        ...baseState,
        phase: "silence"
      };
    case "session.reset":
      return {
        ...createInitialSessionState(event.sessionId),
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

export type ComposeSessionResultInput = {
  sessionId: string;
  readings: Reading[];
  silenceMs?: number;
};

export function composeSessionResult(
  input: ComposeSessionResultInput
): SessionResult {
  const majorityState = getMajorityState(input.readings);
  const presentStates = uniqueStates(input.readings);
  const minorityStates = majorityState
    ? presentStates.filter((state) => state !== majorityState)
    : presentStates;
  const topWindow = buildTopWindow(majorityState, minorityStates, input.readings);

  return {
    sessionId: input.sessionId,
    readings: input.readings,
    majorityState,
    minorityStates,
    topWindow,
    tts: buildTts(topWindow, majorityState, minorityStates, input.readings),
    colors: buildColorAssignments(input.readings, topWindow.status),
    silenceMs: input.silenceMs
  };
}

export function composeSessionReceipt(
  state: SessionMachineState,
  options: {
    startedAt: string;
    finishedAt?: string;
  }
): SessionReceipt {
  return {
    sessionId: requireSessionId(state),
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    input: state.uploadedAudio,
    providers: {
      stt: state.transcript
        ? {
            id: state.transcript.provider,
            latencyMs: state.transcript.latencyMs,
            remote: false
          }
        : undefined
    },
    transcript: state.transcript,
    features: state.features,
    readings: Object.values(state.readings),
    result: state.result,
    errors: state.errors
  };
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
  const states = readings.map((reading) => reading.state);
  return [...new Set(states)];
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

function buildTopWindow(
  majorityState: SignalState | undefined,
  minorityStates: SignalState[],
  readings: Reading[]
): SessionResult["topWindow"] {
  if (readings.length === 0) {
    return {
      status: "empty",
      lineEn: "Waiting for signal.",
      lineZh: "等待读数。"
    };
  }

  if (!majorityState) {
    return {
      status: "mixed",
      lineEn: "The signal will not settle.",
      lineZh: "信号没有站稳。\n这一轮先别相信。"
    };
  }

  if (minorityStates.length > 0) {
    return {
      status: "minority_exists",
      lineEn: "A side signal remains.",
      lineZh: "路的另一边有信号。\n它还没有熄灭。"
    };
  }

  if (majorityState === "maintain") {
    return {
      status: "consensus_maintain",
      lineEn: "Too aligned is not an answer.",
      lineZh: "太一致了。\n但一致不等于答案。"
    };
  }

  if (majorityState === "deviate") {
    return {
      status: "consensus_deviate",
      lineEn: "All answers rose. You remain.",
      lineZh: "答案太整齐了。\n它们都同意，但你还在。"
    };
  }

  return {
    status: "consensus_static",
    lineEn: "The system closed. You did not.",
    lineZh: "这次没有异声。\n系统合上了，你没有。"
  };
}

function buildTts(
  topWindow: SessionResult["topWindow"],
  majorityState: SignalState | undefined,
  minorityStates: SignalState[],
  readings: Reading[]
): SessionResult["tts"] {
  if (readings.length === 0) {
    return undefined;
  }

  if (!majorityState) {
    return {
      language: "zh",
      text: "没有多数。"
    };
  }

  if (minorityStates.length > 0) {
    return {
      language: "zh",
      text: `两项${stateLineZh(majorityState)}。一项不同。${spokenLine(
        topWindow.lineZh
      )}`
    };
  }

  return {
    language: "zh",
    text: spokenLine(topWindow.lineZh)
  };
}

function buildColorAssignments(
  readings: Reading[],
  topWindowStatus: SessionResult["topWindow"]["status"]
): Record<string, string> {
  const assignments = readings.reduce<Record<string, string>>(
    (colors, reading) => {
      return {
        ...colors,
        [reading.channel]: `signal.${reading.state}`
      };
    },
    {}
  );

  return {
    ...assignments,
    topWindow: `result.${topWindowStatus}`
  };
}

function stateLineZh(state: SignalState): string {
  if (state === "maintain") {
    return "维持";
  }

  if (state === "deviate") {
    return "偏离";
  }

  return "静止";
}

function spokenLine(line: string): string {
  return line.replace(/\s+/g, "");
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
