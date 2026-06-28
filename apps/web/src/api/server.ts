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

export function resolveEventsUrl() {
  const configuredUrl = import.meta.env.VITE_EVENTS_URL?.trim();

  return configuredUrl || `${resolveApiBaseUrl()}/events`;
}

export async function createBrowserSession(apiBaseUrl: string): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      source: "browser",
    }),
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to create session."));
  }

  const sessionId = getSessionId(payload);

  if (!sessionId) {
    throw new Error("Session response did not include a session id.");
  }

  return sessionId;
}

export async function postRecordingStarted(
  apiBaseUrl: string,
  sessionId: string,
): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/demo-event`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "input.recording.started",
        payload: {
          source: "browser",
        },
      }),
    },
  );

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to emit recording start."));
  }
}

export async function uploadSessionAudio(
  apiBaseUrl: string,
  sessionId: string,
  blob: Blob,
  durationMs: number,
): Promise<unknown> {
  const uploadUrl = new URL(
    `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/audio`,
  );

  uploadUrl.searchParams.set("durationMs", String(Math.max(0, Math.round(durationMs))));
  uploadUrl.searchParams.set("source", "browser");

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": blob.type || "audio/webm",
    },
    body: blob,
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getResponseError(payload, "Unable to upload audio."));
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
