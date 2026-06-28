import { useEffect, useMemo, useRef, useState } from "react";
import { resolveEventsUrl } from "../api/server";

const SESSION_EVENT_TYPES = [
  "server.connected",
  "server.disconnected",
  "session.created",
  "input.recording.started",
  "input.recording.stopped",
  "audio.uploaded",
  "audio.normalized",
  "audio.transcribed",
  "audio.features.extracted",
  "reading.started",
  "reading.channel.resolved",
  "session.result",
  "tts.started",
  "tts.finished",
  "session.silence",
  "session.reset",
  "session.error",
] as const;

type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export type DevicePhase = "idle" | "recording" | "processing" | "result" | "error";
export type LampTone = "red" | "amber" | "green" | "dim";
export type ReadingChannel = "text" | "voice" | "timing";

type SignalState = "maintain" | "deviate" | "static";

type LampTones = Record<ReadingChannel, LampTone>;

export type DeviceState = {
  phase: DevicePhase;
  topTitle: string;
  topSubtitle: string;
  lamps: LampTones;
};

type IncomingSessionEvent = {
  type: string;
  [key: string]: unknown;
};

export type DeviceEventSummary = {
  type: string;
  sessionId?: string;
  timestamp?: number;
  message?: string;
};

export type DeviceEventsState = {
  device: DeviceState;
  sessionId?: string;
  recentEvents: DeviceEventSummary[];
};

// amber = the canonical "yellow" sprite palette (orange). Used as the resting /
// pre-verdict state for all three windows.
const MOCK_LAMPS: LampTones = {
  text: "amber",
  voice: "amber",
  timing: "amber",
};

const RECORDING_LAMPS: LampTones = {
  text: "amber",
  voice: "amber",
  timing: "amber",
};

const PROCESSING_LAMPS: LampTones = {
  text: "dim",
  voice: "dim",
  timing: "dim",
};

// Broken / load-failed → yellow (amber), not red. A failure is "unclear", not a
// "disagree" verdict.
const ERROR_LAMPS: LampTones = {
  text: "amber",
  voice: "amber",
  timing: "amber",
};

const IDLE_DEVICE_STATE: DeviceState = {
  phase: "idle",
  topTitle: "READY",
  topSubtitle: "IDLE",
  lamps: MOCK_LAMPS,
};

const INITIAL_EVENTS_STATE: DeviceEventsState = {
  device: IDLE_DEVICE_STATE,
  recentEvents: [],
};

const REVEAL_CHANNELS: ReadingChannel[] = ["text", "voice", "timing"];
const LAMP_TONES: LampTone[] = ["red", "green", "amber"];
const FIRST_DELAY = 15_000;
const STEP_DELAY = 10_000;
const JITTER = 3_000;

function randomEqualLamps(): LampTones {
  return {
    text: LAMP_TONES[Math.floor(Math.random() * 3)],
    voice: LAMP_TONES[Math.floor(Math.random() * 3)],
    timing: LAMP_TONES[Math.floor(Math.random() * 3)],
  };
}

export function useDeviceEvents(): DeviceEventsState {
  const eventsUrl = useMemo(resolveEventsUrl, []);
  const [rawState, setRawState] =
    useState<DeviceEventsState>(INITIAL_EVENTS_STATE);

  const [revealStep, setRevealStep] = useState(0);
  const [targetLamps, setTargetLamps] = useState<LampTones>(MOCK_LAMPS);
  const prevPhaseRef = useRef<DevicePhase>("idle");

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    let source: EventSource;

    try {
      source = new EventSource(eventsUrl);
    } catch (error) {
      console.warn("Unable to create backend event stream.", error);
      return;
    }

    const handleMessage = (event: MessageEvent<string>) => {
      const sessionEvent = parseSessionEvent(event);

      if (!sessionEvent) {
        return;
      }

      setRawState((current) => reduceEventsState(current, sessionEvent));
    };

    const namedListeners = SESSION_EVENT_TYPES.map((type) => {
      const listener = (event: Event) => {
        const sessionEvent = parseSessionEvent(event as MessageEvent<string>, type);

        if (!sessionEvent) {
          return;
        }

        setRawState((current) => reduceEventsState(current, sessionEvent));
      };

      source.addEventListener(type, listener);

      return { type, listener };
    });

    source.addEventListener("message", handleMessage);
    source.addEventListener("open", () => {
      setRawState((current) => reduceEventsState(current, {
        type: "server.connected",
        timestamp: Date.now(),
      }));
    });
    source.addEventListener("error", () => {
      setRawState((current) => reduceEventsState(current, {
        type: "server.disconnected",
        timestamp: Date.now(),
        message: "SSE disconnected",
      }));
    });

    return () => {
      source.removeEventListener("message", handleMessage);

      for (const { type, listener } of namedListeners) {
        source.removeEventListener(type, listener);
      }

      source.close();
    };
  }, [eventsUrl]);

  useEffect(() => {
    const phase = rawState.device.phase;
    const wasResult = prevPhaseRef.current === "result";
    prevPhaseRef.current = phase;

    if (phase === "result" && !wasResult) {
      setTargetLamps(randomEqualLamps());
      setRevealStep(0);

      const jitter = () => (Math.random() * 2 - 1) * JITTER;
      const d1 = FIRST_DELAY + jitter();
      const d2 = d1 + STEP_DELAY + jitter();
      const d3 = d2 + STEP_DELAY + jitter();

      const t1 = setTimeout(() => setRevealStep(1), d1);
      const t2 = setTimeout(() => setRevealStep(2), d2);
      const t3 = setTimeout(() => setRevealStep(3), d3);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    if (phase !== "result") {
      setRevealStep(0);
    }
  }, [rawState.device.phase]);

  return useMemo<DeviceEventsState>(() => {
    if (rawState.device.phase !== "result") {
      return rawState;
    }

    const displayLamps: LampTones = { text: "dim", voice: "dim", timing: "dim" };

    for (let i = 0; i < revealStep; i++) {
      displayLamps[REVEAL_CHANNELS[i]] = targetLamps[REVEAL_CHANNELS[i]];
    }

    return {
      ...rawState,
      device: {
        ...rawState.device,
        lamps: displayLamps,
      },
    };
  }, [rawState, revealStep, targetLamps]);
}

function parseSessionEvent(
  event: MessageEvent<string>,
  fallbackType?: SessionEventType,
): IncomingSessionEvent | null {
  const rawData = typeof event.data === "string" ? event.data.trim() : "";

  if (!rawData) {
    return fallbackType ? { type: fallbackType } : null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawData);
  } catch (error) {
    console.warn("Ignored invalid backend event payload.", error);
    return null;
  }

  if (!isRecord(payload)) {
    return fallbackType ? { type: fallbackType } : null;
  }

  const payloadType = typeof payload.type === "string" ? payload.type : undefined;
  const type = payloadType ?? fallbackType;

  if (!type) {
    return null;
  }

  return {
    ...payload,
    type,
  };
}

function reduceDeviceState(
  current: DeviceState,
  event: IncomingSessionEvent,
): DeviceState {
  switch (event.type) {
    case "session.created":
    case "session.reset":
      return IDLE_DEVICE_STATE;
    case "server.disconnected":
      return {
        phase: "error",
        topTitle: "LINK",
        topSubtitle: "OFFLINE",
        lamps: ERROR_LAMPS,
      };
    case "server.connected":
      return current.phase === "error" && current.topTitle === "LINK"
        ? IDLE_DEVICE_STATE
        : current;
    case "input.recording.started":
      return {
        phase: "recording",
        topTitle: "REC",
        topSubtitle: "LISTENING",
        lamps: RECORDING_LAMPS,
      };
    case "input.recording.stopped":
    case "audio.uploaded":
    case "audio.normalized":
    case "audio.transcribed":
    case "audio.features.extracted":
    case "reading.started":
      return {
        phase: "processing",
        topTitle: "READING",
        topSubtitle: "PROCESSING",
        lamps: PROCESSING_LAMPS,
      };
    case "reading.channel.resolved":
      return {
        phase: "processing",
        topTitle: "READING",
        topSubtitle: "PROCESSING",
        lamps: PROCESSING_LAMPS,
      };
    case "session.result":
      return resultStateFromEvent(event);
    case "session.error":
      return {
        phase: "error",
        topTitle: "ERROR",
        topSubtitle: getEventMessage(event) ?? "RESET",
        lamps: ERROR_LAMPS,
      };
    default:
      return current;
  }
}

function reduceEventsState(
  current: DeviceEventsState,
  event: IncomingSessionEvent,
): DeviceEventsState {
  return {
    device: reduceDeviceState(current.device, event),
    sessionId: getSessionId(event) ?? current.sessionId,
    recentEvents: [summarizeEvent(event), ...current.recentEvents].slice(0, 12),
  };
}

function summarizeEvent(event: IncomingSessionEvent): DeviceEventSummary {
  return {
    type: event.type,
    sessionId: getSessionId(event),
    timestamp: getTimestamp(event),
    message: getEventMessage(event),
  };
}

function resultStateFromEvent(event: IncomingSessionEvent): DeviceState {
  const result = isRecord(event.result) ? event.result : event;

  return {
    phase: "result",
    topTitle:
      getTopWindowLine(result, "lineZh") ??
      getTopWindowLine(result, "lineEn") ??
      "RESULT",
    topSubtitle:
      getTopWindowLine(result, "lineEn") ??
      getTopWindowStatus(result) ??
      "LOCKED",
    lamps: getResultLamps(result),
  };
}

function getResultLamps(event: Record<string, unknown>): LampTones {
  const lamps: LampTones = { ...MOCK_LAMPS };

  if (!Array.isArray(event.readings)) {
    return lamps;
  }

  for (const reading of event.readings) {
    if (!isRecord(reading)) {
      continue;
    }

    const channel = toReadingChannel(reading.channel);
    const signalState = toSignalState(reading.state);

    if (!channel || !signalState) {
      continue;
    }

    lamps[channel] = toneForSignalState(signalState);
  }

  return lamps;
}

function withResolvedReadingLamp(
  state: DeviceState,
  event: IncomingSessionEvent,
): DeviceState {
  const reading = isRecord(event.reading) ? event.reading : event;
  const channel = toReadingChannel(reading.channel);
  const signalState = toSignalState(reading.state);

  if (!channel || !signalState) {
    return state;
  }

  return {
    ...state,
    lamps: {
      ...state.lamps,
      [channel]: toneForSignalState(signalState),
    },
  };
}

function getTopWindowLine(
  event: Record<string, unknown>,
  key: "lineEn" | "lineZh",
) {
  if (!isRecord(event.topWindow)) {
    return undefined;
  }

  const value = event.topWindow[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getTopWindowStatus(event: Record<string, unknown>) {
  if (!isRecord(event.topWindow)) {
    return undefined;
  }

  const value = event.topWindow.status;

  return typeof value === "string" && value.trim()
    ? value.trim().replace(/_/g, " ").toUpperCase()
    : undefined;
}

function getEventMessage(event: IncomingSessionEvent) {
  const message = event.message;

  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 22).toUpperCase()
    : undefined;
}

function getSessionId(event: IncomingSessionEvent) {
  const sessionId = event.sessionId;

  return typeof sessionId === "string" && sessionId.trim()
    ? sessionId.trim()
    : undefined;
}

function getTimestamp(event: IncomingSessionEvent) {
  const timestamp = event.timestamp;

  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? timestamp
    : undefined;
}

// Per the product brief and sprite palette: red = maintain / hold / inertia,
// green = deviate / growth / open path, yellow(amber) = static / unformed.
function toneForSignalState(state: SignalState): LampTone {
  if (state === "maintain") {
    return "red";
  }

  if (state === "deviate") {
    return "green";
  }

  return "amber";
}

function toReadingChannel(value: unknown): ReadingChannel | undefined {
  if (value === "text" || value === "voice" || value === "timing") {
    return value;
  }

  return undefined;
}

function toSignalState(value: unknown): SignalState | undefined {
  if (value === "maintain" || value === "deviate" || value === "static") {
    return value;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
