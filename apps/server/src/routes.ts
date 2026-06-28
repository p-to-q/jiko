import { parseSessionEvent, type RuntimeSource } from "@jiko/protocol";
import type { EventBus } from "./eventBus.js";
import { buildMockFeatures, buildReadings, buildResult } from "./mockPipeline.js";
import type { ReceiptWriter } from "./receipts.js";
import { sanitizeSessionId, SessionStore } from "./sessionStore.js";
import type { JsonValue, SessionEvent, SessionRecord } from "./types.js";

type RouteDependencies = {
  bus: EventBus;
  receipts: ReceiptWriter;
  store: SessionStore;
};

type ParsedBody = Record<string, unknown>;
type EventPatch = {
  type: string;
  source?: RuntimeSource;
  [key: string]: unknown;
};

const maxBodyBytes = 64 * 1024;
const maxAudioBodyBytes = 12 * 1024 * 1024;
const allowedDemoEventTypes = new Set([
  "input.recording.started",
  "input.recording.stopped",
  "session.silence",
  "session.reset",
  "session.error"
]);

export function createRequestHandler(dependencies: RouteDependencies) {
  return async function handleRequest(request: any, response: any): Promise<void> {
    try {
      applyCors(response);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          service: "@jiko/server",
          mode: "mock",
          uptimeSeconds: Math.round(process.uptime()),
          sessions: dependencies.store.listSessions().length,
          sseClients: dependencies.bus.listenerCount,
          receiptsEnabled: dependencies.receipts.enabled,
          providers: {
            stt: "local:manual",
            tts: "local:mock-clip"
          }
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/events") {
        handleEvents(request, response, dependencies);
        return;
      }

      if (request.method === "POST" && url.pathname === "/sessions") {
        await handleCreateSession(request, response, dependencies);
        return;
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "manual-transcript") {
        await handleManualTranscript(parts[1], request, response, dependencies);
        return;
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "audio") {
        await handleAudioUpload(parts[1], request, response, url, dependencies);
        return;
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "sessions" && parts[2] === "demo-event") {
        await handleDemoEvent(parts[1], request, response, dependencies);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      sendJson(response, 500, { error: message });
    }
  };
}

async function handleCreateSession(request: any, response: any, dependencies: RouteDependencies): Promise<void> {
  const body = await readJsonBody(request, false);
  const session = dependencies.store.createSession({
    sessionId: sanitizeSessionId(body?.sessionId),
    source: sourceValue(body?.source) ?? "server"
  });

  const event = await emitSessionEvent(dependencies, session, {
    type: "session.created",
    source: session.source,
  });

  sendJson(response, 201, {
    session,
    event
  });
}

async function handleAudioUpload(
  sessionId: string,
  request: any,
  response: any,
  url: URL,
  dependencies: RouteDependencies
): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  const contentType = contentTypeValue(request.headers?.["content-type"]);
  if (!contentType || contentType.startsWith("application/json")) {
    sendJson(response, 415, {
      error: "Expected a raw audio request body",
      supportedContentTypes: ["audio/webm", "audio/ogg", "audio/wav", "audio/mp4"]
    });
    return;
  }

  const byteSize = await readRawBodyByteSize(request, maxAudioBodyBytes);
  if (byteSize === 0) {
    sendJson(response, 400, { error: "Expected non-empty audio body" });
    return;
  }

  const durationMs = numberValue(url.searchParams.get("durationMs")) ?? numberValue(request.headers?.["x-audio-duration-ms"]);
  const source = sourceValue(url.searchParams.get("source")) ?? "browser";
  const audio = {
    source,
    mediaType: contentType,
    byteSize,
    durationMs
  };

  const events: SessionEvent[] = [];

  if (durationMs !== undefined) {
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "input.recording.stopped",
        source,
        durationMs
      })
    );
  }

  dependencies.store.updateAnalysis(session.id, {
    uploadedAudio: audio
  });

  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "audio.uploaded",
      source,
      audio
    })
  );

  sendJson(response, 202, {
    session: dependencies.store.getSession(sessionId),
    events,
    next: "audio normalization and local STT are not wired yet"
  });
}

async function handleManualTranscript(
  sessionId: string,
  request: any,
  response: any,
  dependencies: RouteDependencies
): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  const body = await readJsonBody(request, true);
  const transcript = stringValue(body.transcript)?.trim();
  if (!transcript) {
    sendJson(response, 400, { error: "Expected non-empty JSON string field: transcript" });
    return;
  }

  if (transcript.length > 5000) {
    sendJson(response, 413, { error: "Transcript is too large for the mock route" });
    return;
  }

  const language = stringValue(body.language) ?? guessLanguage(transcript);
  const events = await runManualTranscriptLoop(dependencies, session, transcript, language, "manual");
  sendJson(response, 200, {
    session: dependencies.store.getSession(sessionId),
    events
  });
}

async function handleDemoEvent(sessionId: string, request: any, response: any, dependencies: RouteDependencies): Promise<void> {
  const session = dependencies.store.getSession(sessionId);
  if (!session) {
    sendJson(response, 404, { error: "Session not found" });
    return;
  }

  const body = await readJsonBody(request, true);
  const transcript = stringValue(body.transcript)?.trim();
  if (transcript) {
    const language = stringValue(body.language) ?? guessLanguage(transcript);
    const events = await runManualTranscriptLoop(dependencies, session, transcript, language, "operator");
    sendJson(response, 200, { session: dependencies.store.getSession(sessionId), events });
    return;
  }

  const type = stringValue(body.type);
  if (!type || !allowedDemoEventTypes.has(type)) {
    sendJson(response, 400, {
      error: "Expected demo event type or transcript",
      allowedTypes: [...allowedDemoEventTypes]
    });
    return;
  }

  const payload = objectValue(body.payload);
  if (type === "session.error" && typeof payload.message !== "string") {
    payload.message = "Operator demo error";
  }

  if (type === "session.error" && typeof payload.recoverable !== "boolean") {
    payload.recoverable = true;
  }

  const event = await emitSessionEvent(dependencies, session, {
    type,
    source: "operator",
    ...payload
  });

  sendJson(response, 200, {
    session: dependencies.store.getSession(sessionId),
    event
  });
}

async function runManualTranscriptLoop(
  dependencies: RouteDependencies,
  session: SessionRecord,
  transcript: string,
  language: string,
  source: RuntimeSource
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const features = buildMockFeatures(transcript);
  const transcriptResult = {
    text: transcript,
    language,
    provider: "local:manual",
    confidence: 0.86,
    latencyMs: 0
  };
  const readings = buildReadings(transcript, language, features);
  const result = buildResult(session.id, readings);

  dependencies.store.updateAnalysis(session.id, {
    transcript: transcriptResult,
    features,
    readings,
    result
  });

  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "audio.transcribed",
      source,
      transcript: transcriptResult
    })
  );

  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "audio.features.extracted",
      source,
      features
    })
  );

  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "reading.started",
      source
    })
  );

  for (const reading of readings) {
    events.push(
      await emitSessionEvent(dependencies, session, {
        type: "reading.channel.resolved",
        source,
        reading
      })
    );
  }

  events.push(
    await emitSessionEvent(dependencies, session, {
      type: "session.result",
      source,
      result
    })
  );

  return events;
}

async function readRawBodyByteSize(request: any, byteLimit: number): Promise<number> {
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunkByteLength(chunk);
    if (totalBytes > byteLimit) {
      throw new Error("Audio body is too large");
    }
  }

  return totalBytes;
}

async function emitSessionEvent(
  dependencies: RouteDependencies,
  session: SessionRecord,
  eventPatch: EventPatch
): Promise<SessionEvent> {
  const event = parseSessionEvent({
    sessionId: session.id,
    timestamp: Date.now(),
    ...eventPatch
  });

  const updated = dependencies.store.addEvent(event);
  dependencies.bus.publish(event);
  if (updated) {
    await dependencies.receipts.write(updated);
  }

  return event;
}

function handleEvents(request: any, response: any, dependencies: RouteDependencies): void {
  response.writeHead(200, {
    "access-control-allow-origin": "*",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream"
  });

  writeSse(response, {
    type: "server.connected",
    timestamp: Date.now(),
    sessionCount: dependencies.store.listSessions().length
  });

  const unsubscribe = dependencies.bus.subscribe((event) => {
    writeSse(response, event);
  });

  const heartbeat = setInterval(() => {
    response.write(": keep-alive\n\n");
  }, 20000);

  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeSse(
  response: any,
  event: SessionEvent | { type: string; timestamp: number; [key: string]: unknown }
): void {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJsonBody(request: any, requireBody: true): Promise<ParsedBody>;
async function readJsonBody(request: any, requireBody: false): Promise<ParsedBody | undefined>;
async function readJsonBody(request: any, requireBody: boolean): Promise<ParsedBody | undefined> {
  const chunks: string[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    totalBytes += text.length;
    if (totalBytes > maxBodyBytes) {
      throw new Error("Request body is too large");
    }
    chunks.push(text);
  }

  const raw = chunks.join("").trim();
  if (!raw) {
    if (requireBody) {
      throw new Error("Expected a JSON body");
    }
    return undefined;
  }

  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object body");
  }

  return value as ParsedBody;
}

function applyCors(response: any): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(response: any, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function contentTypeValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }

  return raw.split(";")[0]?.trim().toLowerCase() || undefined;
}

function chunkByteLength(value: unknown): number {
  if (typeof value === "string") {
    return Buffer.byteLength(value);
  }

  if (value && typeof value === "object" && "byteLength" in value && typeof value.byteLength === "number") {
    return value.byteLength;
  }

  return Buffer.byteLength(String(value));
}

function numberValue(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || raw === null || raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function sourceValue(value: unknown): RuntimeSource | undefined {
  if (
    value === "browser" ||
    value === "device" ||
    value === "operator" ||
    value === "server" ||
    value === "manual"
  ) {
    return value;
  }

  return undefined;
}

function objectValue(value: unknown): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const safeEntries = Object.entries(value).filter(([, entryValue]) => isJsonValue(entryValue));
  return Object.fromEntries(safeEntries) as Record<string, JsonValue>;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object") {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function guessLanguage(transcript: string): string {
  return /[\u3400-\u9fff]/.test(transcript) ? "zh" : "en";
}
