import { SessionStatusSchema, type SessionStatus } from "@jiko/protocol";

const DEFAULT_API_BASE_URL = "http://localhost:4317";
export const DEFAULT_EVENTS_URL = `${DEFAULT_API_BASE_URL}/events`;

export type SessionDebugSnapshot =
  | {
      status: "idle" | "loading";
      endpoint?: undefined;
      payload?: undefined;
      message?: string;
    }
  | {
      status: "ok";
      endpoint: string;
      payload: unknown;
      message?: undefined;
    }
  | {
      status: "missing" | "error";
      endpoint?: string;
      payload?: undefined;
      message: string;
    };

export type BrowserSessionRegistration = {
  sessionId: string;
  attemptId: string;
};

export type BrowserSessionState = {
  sessionId: string;
  attemptId: string;
  status: SessionStatus;
  hasResult: boolean;
  orderedPcmCoverageComplete: boolean;
  errorMessage?: string;
};

export function resolveApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();

  if (configuredUrl) {
    return withoutTrailingSlash(configuredUrl);
  }

  const configuredEventsUrl = import.meta.env.VITE_EVENTS_URL?.trim();

  if (configuredEventsUrl) {
    return inferApiBaseUrl(configuredEventsUrl);
  }

  const browserHostUrl = inferApiBaseUrlFromWindow();

  if (browserHostUrl) {
    return browserHostUrl;
  }

  return DEFAULT_API_BASE_URL;
}

export function resolveEventsUrl(sessionId?: string) {
  const configuredUrl = import.meta.env.VITE_EVENTS_URL?.trim();
  const eventsUrl = configuredUrl || `${resolveApiBaseUrl()}/events`;

  if (!sessionId) {
    return eventsUrl;
  }

  const url = new URL(eventsUrl, window.location.href);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

export async function createBrowserSession(
  apiBaseUrl: string,
  options: {
    requestedSessionId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<BrowserSessionRegistration> {
  const response = await fetch(`${apiBaseUrl}/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      source: "browser",
      ...(options.requestedSessionId
        ? { sessionId: options.requestedSessionId }
        : {}),
    }),
    signal: options.signal,
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to create session."));
  }

  const registration = getSessionRegistration(payload);

  if (!registration) {
    throw new Error("Session response did not include a session and attempt id.");
  }

  return registration;
}

export async function postRecordingStopped(
  apiBaseUrl: string,
  sessionId: string,
  durationMs: number,
  monotonicMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/input-event`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "input.recording.stopped",
        source: "browser",
        durationMs: Math.max(0, Math.round(durationMs)),
        monotonicMs: Math.max(0, monotonicMs),
      }),
      signal,
    },
  );

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to emit recording stop."));
  }
}

export async function postRecordingStarted(
  apiBaseUrl: string,
  sessionId: string,
  monotonicMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/input-event`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "input.recording.started",
        source: "browser",
        monotonicMs,
      }),
      signal,
    },
  );

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to emit recording start."));
  }
}

export async function postSessionError(
  apiBaseUrl: string,
  sessionId: string,
  error: {
    message: string;
    code?: string;
    recoverable?: boolean;
  },
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/input-event`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "session.error",
        source: "browser",
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
        recoverable: error.recoverable ?? true,
      }),
      signal,
    },
  );

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to report session error."));
  }
}

export async function uploadSessionAudio(
  apiBaseUrl: string,
  sessionId: string,
  blob: Blob,
  durationMs: number,
  monotonicMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const uploadUrl = new URL(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/audio`,
  );

  uploadUrl.searchParams.set("durationMs", String(Math.max(0, Math.round(durationMs))));
  uploadUrl.searchParams.set("source", "browser");
  uploadUrl.searchParams.set("monotonicMs", String(Math.max(0, monotonicMs)));

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": blob.type || "audio/webm",
    },
    body: blob,
    signal,
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to upload audio."));
  }

  return payload;
}

export async function submitManualTranscript(
  apiBaseUrl: string,
  sessionId: string,
  transcript: string,
  language = "zh",
): Promise<unknown> {
  const response = await fetch(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/manual-transcript`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        transcript,
        language,
      }),
    },
  );

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to submit manual transcript."));
  }

  return payload;
}

export async function fetchSessionDebugSnapshot(
  apiBaseUrl: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionDebugSnapshot> {
  const endpoints = [
    `/sessions/${encodeURIComponent(sessionId)}/receipt`,
    `/sessions/${encodeURIComponent(sessionId)}`,
  ];

  for (const endpoint of endpoints) {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, { signal });

    if (response.status === 404) {
      continue;
    }

    const payload = await readJsonResponse(response);

    if (!response.ok) {
      return {
        status: "error",
        endpoint,
        message: getResponseError(payload, `Debug fetch failed with ${response.status}.`),
      };
    }

    return {
      status: "ok",
      endpoint,
      payload,
    };
  }

  return {
    status: "missing",
    message: "Debug receipt endpoint pending.",
  };
}

export async function fetchBrowserSessionState(
  apiBaseUrl: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<BrowserSessionState> {
  const response = await fetch(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}`,
    { signal },
  );
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to reconcile session state."));
  }
  if (!isRecord(payload) || !isRecord(payload.session)) {
    throw new Error("Session reconciliation response was malformed.");
  }

  const session = payload.session;
  const status = SessionStatusSchema.safeParse(session.status);
  if (
    typeof session.id !== "string" ||
    typeof session.attemptId !== "string" ||
    !status.success
  ) {
    throw new Error("Session reconciliation identity was malformed.");
  }
  const events = Array.isArray(session.events) ? session.events : [];
  const lastError = [...events].reverse().find(
    (event) => isRecord(event) && event.type === "session.error",
  );

  return {
    sessionId: session.id,
    attemptId: session.attemptId,
    status: status.data,
    hasResult: events.some(
      (event) => isRecord(event) && event.type === "session.result",
    ) && isRecord(session.result),
    orderedPcmCoverageComplete:
      isRecord(session.orderedPcm) &&
      session.orderedPcm.coverageComplete === true,
    ...(isRecord(lastError) && typeof lastError.message === "string"
      ? { errorMessage: lastError.message }
      : {}),
  };
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected browser recording error.";
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function getResponseError(payload: unknown, fallback: string) {
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function getSessionId(payload: unknown) {
  if (isRecord(payload)) {
    if (typeof payload.sessionId === "string") {
      return payload.sessionId;
    }

    if (typeof payload.id === "string") {
      return payload.id;
    }

    if (isRecord(payload.session) && typeof payload.session.id === "string") {
      return payload.session.id;
    }
  }

  return undefined;
}

function getSessionRegistration(
  payload: unknown,
): BrowserSessionRegistration | undefined {
  const sessionId = getSessionId(payload);
  if (!sessionId || !isRecord(payload)) {
    return undefined;
  }

  const attemptId = typeof payload.attemptId === "string"
    ? payload.attemptId
    : isRecord(payload.session) && typeof payload.session.attemptId === "string"
      ? payload.session.attemptId
      : undefined;
  if (!attemptId) {
    return undefined;
  }
  return { sessionId, attemptId };
}

function inferApiBaseUrl(rawEventsUrl: string) {
  try {
    const url = new URL(rawEventsUrl, window.location.href);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/events\/?$/, "");

    return withoutTrailingSlash(url.toString());
  } catch {
    return DEFAULT_API_BASE_URL;
  }
}

function inferApiBaseUrlFromWindow() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const { hostname, protocol } = window.location;

  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1") {
    return undefined;
  }

  const apiProtocol = protocol === "https:" ? "https:" : "http:";

  return `${apiProtocol}//${hostname}:4317`;
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
