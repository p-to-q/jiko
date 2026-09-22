import { useEffect, useMemo, useRef, useState } from "react";
import {
  classifySessionEvent,
  createIdleInstrumentScene,
  createInitialSessionState,
  projectInstrumentScene,
  reduceSessionEvent,
  type InstrumentLampMotion,
  type InstrumentLampMotions,
  type InstrumentLampTone,
  type InstrumentLampTones,
  type InstrumentPhase,
  type InstrumentScene,
  type SessionMachineState,
} from "@jiko/core";
import {
  SessionEventSchema,
  type ReadingChannel as ProtocolReadingChannel,
  type SessionEvent,
} from "@jiko/protocol";
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

export type DevicePhase = InstrumentPhase;
export type LampTone = InstrumentLampTone;
export type LampMotion = InstrumentLampMotion;
export type ReadingChannel = ProtocolReadingChannel;
export type DeviceState = InstrumentScene;

type LampTones = InstrumentLampTones;
type LampMotions = InstrumentLampMotions;

type StreamStatusEvent = {
  type: string;
  [key: string]: unknown;
};

type IncomingSessionEvent = SessionEvent | StreamStatusEvent;

export type DeviceEventSummary = {
  type: string;
  sessionId?: string;
  attemptId?: string;
  sequence?: number;
  timestamp?: number;
  message?: string;
};

export type DeviceEventsState = {
  device: DeviceState;
  session: SessionMachineState;
  sessionId?: string;
  attemptId?: string;
  lastSequence: number;
  transport: "connecting" | "connected" | "disconnected" | "gap";
  resultSequence?: number;
  recentEvents: DeviceEventSummary[];
};

export type DeviceEventsOptions = {
  activeSessionId?: string;
  discoverDeviceSessions?: boolean;
  onSessionDiscovered?: (sessionId: string) => void;
};

// These copies belong only to the timed reveal choreography. The target scene
// itself is projected by @jiko/core from the canonical session reducer.
const IDLE_LAMPS: LampTones = {
  text: "amber",
  voice: "amber",
  timing: "amber",
};

const RESTING_LAMPS: LampMotions = {
  text: "resting",
  voice: "resting",
  timing: "resting",
};

const SPINNING_LAMPS: LampMotions = {
  text: "spinning",
  voice: "spinning",
  timing: "spinning",
};

const LOCKED_LAMPS: LampMotions = {
  text: "locked",
  voice: "locked",
  timing: "locked",
};

const PROCESSING_LAMPS: LampTones = {
  text: "dim",
  voice: "dim",
  timing: "dim",
};

function createInitialEventsState(sessionId?: string): DeviceEventsState {
  return {
    device: createIdleInstrumentScene(),
    session: createInitialSessionState(sessionId),
    sessionId,
    lastSequence: 0,
    transport: "connecting",
    recentEvents: [],
  };
}

const REVEAL_CHANNELS: ReadingChannel[] = ["text", "voice", "timing"];
const LOCK_DELAYS = [0, 450, 900] as const;

export function useDeviceEvents(
  options: DeviceEventsOptions = {},
): DeviceEventsState {
  const {
    activeSessionId,
    discoverDeviceSessions = false,
    onSessionDiscovered,
  } = options;
  const eventsUrl = useMemo(
    () => resolveEventsUrl(activeSessionId),
    [activeSessionId],
  );
  const [rawState, setRawState] =
    useState<DeviceEventsState>(() => createInitialEventsState(activeSessionId));
  const [streamRevision, setStreamRevision] = useState(0);
  const gapRecoveryRef = useRef<{ key?: string; attempts: number }>({ attempts: 0 });

  const [revealStep, setRevealStep] = useState(0);
  const [targetLamps, setTargetLamps] = useState<LampTones>(IDLE_LAMPS);
  const prefersReducedMotion = usePrefersReducedMotion();
  const revealIdentity =
    rawState.device.phase === "result" && rawState.resultSequence
      ? `${rawState.attemptId ?? "unknown"}:${rawState.resultSequence}`
      : undefined;

  useEffect(() => {
    gapRecoveryRef.current = { attempts: 0 };
  }, [activeSessionId]);

  useEffect(() => {
    if (!discoverDeviceSessions || typeof EventSource === "undefined") {
      return;
    }

    // Device sessions are intentionally one immutable attempt each. Keep a
    // separate unscoped discovery stream alive while the visible instrument is
    // bound to a scoped stream, otherwise the first button press would hide
    // every later Pi-created session from the kiosk.
    let discoverySource: EventSource;
    try {
      discoverySource = new EventSource(resolveEventsUrl(undefined));
    } catch (error) {
      console.warn("Unable to create device discovery stream.", error);
      return;
    }

    const handleCreated = (event: Event) => {
      const sessionEvent = parseSessionEvent(
        event as MessageEvent<string>,
        "session.created",
      );
      if (
        sessionEvent &&
        isSessionEvent(sessionEvent) &&
        sessionEvent.type === "session.created" &&
        sessionEvent.source === "device"
      ) {
        onSessionDiscovered?.(sessionEvent.sessionId);
      }
    };

    discoverySource.addEventListener("session.created", handleCreated);
    return () => {
      discoverySource.removeEventListener("session.created", handleCreated);
      discoverySource.close();
    };
  }, [discoverDeviceSessions, onSessionDiscovered]);

  useEffect(() => {
    setRawState(createInitialEventsState(activeSessionId));
    setRevealStep(0);

    if (typeof EventSource === "undefined") {
      return;
    }
    if (discoverDeviceSessions && !activeSessionId) {
      return;
    }

    let source: EventSource;

    try {
      source = new EventSource(eventsUrl);
    } catch (error) {
      console.warn("Unable to create backend event stream.", error);
      return;
    }

    const acceptEvent = (sessionEvent: IncomingSessionEvent | null) => {
      if (!sessionEvent) {
        return;
      }

      if (isSessionEvent(sessionEvent)) {
        if (!activeSessionId) {
          return;
        }

        setRawState((current) => reduceScopedEventsState(
          current,
          sessionEvent,
          activeSessionId,
        ));
        return;
      }

      setRawState((current) => reduceStreamStatus(current, sessionEvent));
    };

    const handleMessage = (event: MessageEvent<string>) => {
      const sessionEvent = parseSessionEvent(event);
      acceptEvent(sessionEvent);
    };

    const namedListeners = SESSION_EVENT_TYPES.map((type) => {
      const listener = (event: Event) => {
        const sessionEvent = parseSessionEvent(event as MessageEvent<string>, type);
        acceptEvent(sessionEvent);
      };

      source.addEventListener(type, listener);

      return { type, listener };
    });

    source.addEventListener("message", handleMessage);
    source.addEventListener("open", () => {
      acceptEvent({
        type: "server.connected",
        timestamp: Date.now(),
      });
    });
    source.addEventListener("error", () => {
      acceptEvent({
        type: "server.disconnected",
        timestamp: Date.now(),
        message: "SSE disconnected",
      });
    });

    return () => {
      source.removeEventListener("message", handleMessage);

      for (const { type, listener } of namedListeners) {
        source.removeEventListener(type, listener);
      }

      source.close();
    };
  }, [
    activeSessionId,
    discoverDeviceSessions,
    eventsUrl,
    streamRevision,
  ]);

  useEffect(() => {
    if (rawState.transport !== "gap" || !activeSessionId) {
      return;
    }

    const key = `${activeSessionId}:${rawState.lastSequence}`;
    if (gapRecoveryRef.current.key !== key) {
      gapRecoveryRef.current = { key, attempts: 0 };
    }
    if (gapRecoveryRef.current.attempts >= 1) {
      return;
    }

    gapRecoveryRef.current.attempts += 1;
    // A fresh EventSource has no inherited Last-Event-ID, so the scoped server
    // replays the complete in-memory attempt. One bounded retry can repair a
    // dropped/out-of-order delivery; a persistent gap remains visibly failed.
    const reconnect = window.setTimeout(
      () => setStreamRevision((revision) => revision + 1),
      75,
    );
    return () => window.clearTimeout(reconnect);
  }, [activeSessionId, rawState.lastSequence, rawState.transport]);

  useEffect(() => {
    if (revealIdentity) {
      // Reveal the backend's readings in order. The result must never invent a
      // new lamp state after the shared pipeline has already resolved it. The
      // timer is keyed only by result identity, so later TTS/silence events do
      // not cancel an in-flight reveal.
      setTargetLamps(rawState.device.lamps);
      if (prefersReducedMotion) {
        setRevealStep(REVEAL_CHANNELS.length);
        return;
      }

      setRevealStep(1);

      const t2 = setTimeout(() => setRevealStep(2), LOCK_DELAYS[1]);
      const t3 = setTimeout(() => setRevealStep(3), LOCK_DELAYS[2]);

      return () => {
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }

    setRevealStep(0);
  }, [prefersReducedMotion, revealIdentity]);

  return useMemo<DeviceEventsState>(() => {
    if (rawState.transport === "disconnected") {
      return {
        ...rawState,
        device: {
          ...rawState.device,
          phase: "error",
          topTitle: "LINK",
          topSubtitle: "OFFLINE",
          lampMotions: RESTING_LAMPS,
        },
      };
    }

    if (rawState.transport === "gap") {
      return {
        ...rawState,
        device: {
          ...rawState.device,
          phase: "error",
          topTitle: "SYNC",
          topSubtitle: "RECONNECT",
          lampMotions: RESTING_LAMPS,
        },
      };
    }

    if (rawState.device.phase !== "result") {
      return rawState;
    }

    const displayLamps: LampTones = { ...PROCESSING_LAMPS };
    const lampMotions: LampMotions = { ...SPINNING_LAMPS };

    for (let i = 0; i < revealStep; i++) {
      const channel = REVEAL_CHANNELS[i];
      displayLamps[channel] = targetLamps[channel];
      lampMotions[channel] = "locked";
    }

    const fullyLocked = revealStep === REVEAL_CHANNELS.length;

    return {
      ...rawState,
      device: {
        ...rawState.device,
        phase: "result",
        lamps: displayLamps,
        lampMotions: fullyLocked ? LOCKED_LAMPS : lampMotions,
      },
    };
  }, [rawState, revealStep, targetLamps]);
}

function parseSessionEvent(
  event: MessageEvent<string>,
  fallbackType?: string,
): IncomingSessionEvent | null {
  const rawData = typeof event.data === "string" ? event.data.trim() : "";

  if (!rawData) {
    return fallbackType === "server.connected" || fallbackType === "server.disconnected"
      ? { type: fallbackType }
      : null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawData);
  } catch (error) {
    console.warn("Ignored invalid backend event payload.", error);
    return null;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const payloadType = typeof payload.type === "string" ? payload.type : undefined;
  const type = payloadType ?? fallbackType;

  if (!type) {
    return null;
  }

  if (type === "server.connected" || type === "server.disconnected") {
    return { ...payload, type };
  }

  const parsed = SessionEventSchema.safeParse({ ...payload, type });
  if (!parsed.success) {
    console.warn("Ignored invalid session event payload.", parsed.error.issues);
    return null;
  }

  return parsed.data;
}

function reduceScopedEventsState(
  current: DeviceEventsState,
  event: SessionEvent,
  activeSessionId: string,
): DeviceEventsState {
  if (event.sessionId !== activeSessionId) {
    return current;
  }

  const disposition = classifySessionEvent(current, event);
  if (
    disposition === "duplicate" ||
    disposition === "foreign_session"
  ) {
    return current;
  }

  if (disposition !== "apply") {
    return {
      ...current,
      transport: "gap",
      recentEvents: [summarizeEvent(event), ...current.recentEvents].slice(0, 12),
    };
  }

  let session: SessionMachineState;
  try {
    session = reduceSessionEvent(current.session, event);
  } catch (error) {
    console.warn("Rejected an invalid session transition from the event stream.", error);
    return {
      ...current,
      transport: "gap",
      recentEvents: [summarizeEvent(event), ...current.recentEvents].slice(0, 12),
    };
  }

  return {
    device: projectInstrumentScene(session),
    session,
    sessionId: event.sessionId,
    attemptId: event.attemptId,
    lastSequence: event.sequence,
    transport:
      current.transport === "connecting" || current.transport === "gap"
        ? "connected"
        : current.transport,
    resultSequence:
      event.type === "session.result"
        ? event.sequence
        : event.type === "session.created" || event.type === "session.reset"
          ? undefined
          : current.resultSequence,
    recentEvents: [summarizeEvent(event), ...current.recentEvents].slice(0, 12),
  };
}

function reduceStreamStatus(
  current: DeviceEventsState,
  event: StreamStatusEvent,
): DeviceEventsState {
  if (event.type !== "server.connected" && event.type !== "server.disconnected") {
    return current;
  }

  return {
    ...current,
    transport: event.type === "server.connected" ? "connected" : "disconnected",
    recentEvents: [summarizeEvent(event), ...current.recentEvents].slice(0, 12),
  };
}

function summarizeEvent(event: IncomingSessionEvent): DeviceEventSummary {
  return {
    type: event.type,
    sessionId: getSessionId(event),
    attemptId: getAttemptId(event),
    sequence: getSequence(event),
    timestamp: getTimestamp(event),
    message: getEventMessage(event),
  };
}

function getEventMessage(event: IncomingSessionEvent) {
  const message = "message" in event ? event.message : undefined;

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

function getAttemptId(event: IncomingSessionEvent) {
  const attemptId = event.attemptId;
  return typeof attemptId === "string" && attemptId.trim()
    ? attemptId.trim()
    : undefined;
}

function getSequence(event: IncomingSessionEvent) {
  const sequence = event.sequence;
  return typeof sequence === "number" && Number.isInteger(sequence)
    ? sequence
    : undefined;
}

function isSessionEvent(event: IncomingSessionEvent): event is SessionEvent {
  return Boolean(
    getSessionId(event) &&
    getAttemptId(event) &&
    getSequence(event),
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReduced(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
