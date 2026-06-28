import { useEffect, useMemo, useState } from "react";

const DEFAULT_EVENTS_URL = "http://localhost:4317/events";

const SESSION_EVENT_TYPES = [
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
export type LampTone = "red" | "amber" | "green";
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

const MOCK_LAMPS: LampTones = {
  text: "red",
  voice: "amber",
  timing: "green",
};

const RECORDING_LAMPS: LampTones = {
  text: "red",
  voice: "red",
  timing: "red",
};

const PROCESSING_LAMPS: LampTones = {
  text: "amber",
  voice: "amber",
  timing: "amber",
};

const ERROR_LAMPS: LampTones = {
  text: "red",
  voice: "red",
  timing: "red",
};

const IDLE_DEVICE_STATE: DeviceState = {
  phase: "idle",
  topTitle: "READY",
  topSubtitle: "IDLE",
  lamps: MOCK_LAMPS,
};

export function useDeviceEvents(): DeviceState {
  const eventsUrl = useMemo(resolveEventsUrl, []);
  const [deviceState, setDeviceState] = useState<DeviceState>(IDLE_DEVICE_STATE);

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

      setDeviceState((current) => reduceDeviceState(current, sessionEvent));
    };

    const namedListeners = SESSION_EVENT_TYPES.map((type) => {
      const listener = (event: Event) => {
        const sessionEvent = parseSessionEvent(event as MessageEvent<string>, type);

        if (!sessionEvent) {
          return;
        }

        setDeviceState((current) => reduceDeviceState(current, sessionEvent));
      };

      source.addEventListener(type, listener);

      return { type, listener };
    });

    source.addEventListener("message", handleMessage);

    return () => {
      source.removeEventListener("message", handleMessage);

      for (const { type, listener } of namedListeners) {
        source.removeEventListener(type, listener);
      }

      source.close();
    };
  }, [eventsUrl]);

  return deviceState;
}

function resolveEventsUrl() {
  const configuredUrl = import.meta.env.VITE_EVENTS_URL?.trim();

  return configuredUrl || DEFAULT_EVENTS_URL;
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
      return withResolvedReadingLamp(
        {
          phase: "processing",
          topTitle: "READING",
          topSubtitle: "PROCESSING",
          lamps: current.phase === "idle" ? PROCESSING_LAMPS : current.lamps,
        },
        event,
      );
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

function toneForSignalState(state: SignalState): LampTone {
  if (state === "maintain") {
    return "green";
  }

  if (state === "deviate") {
    return "red";
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
