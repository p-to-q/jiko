import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";

import { EventBus } from "../dist/eventBus.js";
import { ReceiptWriter } from "../dist/receipts.js";
import { createRequestHandler } from "../dist/routes.js";
import { SessionStore } from "../dist/sessionStore.js";

test("SSE preserves exact browser Origin while native clients omit CORS headers", async () => {
  const bus = new EventBus();
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "sse-origin-policy",
    source: "browser"
  });
  const server = http.createServer(
    createRequestHandler({
      allowedOrigins: ["http://trusted.local"],
      bus,
      receipts: new ReceiptWriter(false),
      store
    })
  );
  const baseUrl = await listen(server);
  const streamUrl = `${baseUrl}/events?sessionId=${session.id}`;
  let trustedStream;
  let nativeStream;

  try {
    trustedStream = await openEventStream(streamUrl, {
      origin: "http://trusted.local"
    });
    assert.equal(
      trustedStream.headers.get("access-control-allow-origin"),
      "http://trusted.local"
    );
    assert.equal(trustedStream.headers.get("vary"), "Origin");
    await trustedStream.close();
    trustedStream = undefined;
    await waitForCondition(
      () => bus.listenerCount === 0,
      "trusted SSE listener cleanup"
    );

    const rejected = await fetch(streamUrl, {
      headers: { origin: "http://untrusted.local" }
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
    await rejected.text();
    assert.equal(bus.listenerCount, 0);

    nativeStream = await openEventStream(streamUrl);
    assert.equal(
      nativeStream.headers.get("access-control-allow-origin"),
      null
    );
  } finally {
    await nativeStream?.close();
    await trustedStream?.close();
    await waitForCondition(
      () => bus.listenerCount === 0,
      "Origin-policy SSE listener cleanup"
    );
    await closeServer(server);
  }
});

test("scoped SSE replay resumes one session and filters other live sessions", async () => {
  const bus = new EventBus();
  const store = new SessionStore();
  const server = http.createServer(
    createRequestHandler({
      bus,
      receipts: new ReceiptWriter(false),
      store
    })
  );
  const baseUrl = await listen(server);
  let initialStream;
  let resumedStream;

  try {
    const createdA = await postJson(baseUrl, "/sessions", {
      sessionId: "sse-a",
      source: "browser"
    });
    const createdB = await postJson(baseUrl, "/sessions", {
      sessionId: "sse-b",
      source: "browser"
    });
    const attemptA = createdA.session.attemptId;
    const attemptB = createdB.session.attemptId;

    await postJson(baseUrl, "/sessions/sse-a/input-event", {
      type: "input.recording.started",
      source: "browser"
    });
    await postJson(baseUrl, "/sessions/sse-b/input-event", {
      type: "input.recording.started",
      source: "browser"
    });

    initialStream = await openEventStream(`${baseUrl}/events?sessionId=sse-a`);
    await initialStream.waitFor(
      (frames) => sessionFrames(frames).length === 2,
      "initial scoped replay"
    );

    assert.deepEqual(
      sessionFrames(initialStream.frames).map(summarizeFrame),
      [
        {
          event: "session.created",
          id: `${attemptA}:1`,
          sessionId: "sse-a",
          attemptId: attemptA,
          sequence: 1
        },
        {
          event: "input.recording.started",
          id: `${attemptA}:2`,
          sessionId: "sse-a",
          attemptId: attemptA,
          sequence: 2
        }
      ]
    );
    assert.equal(
      sessionFrames(initialStream.frames).some(
        (frame) => frame.data.sessionId === "sse-b" || frame.data.attemptId === attemptB
      ),
      false
    );

    await initialStream.close();
    await waitForCondition(
      () => bus.listenerCount === 0,
      "initial SSE listener cleanup"
    );

    await postJson(baseUrl, "/sessions/sse-a/input-event", {
      type: "input.recording.stopped",
      source: "browser",
      durationMs: 800
    });
    await postJson(baseUrl, "/sessions/sse-b/input-event", {
      type: "input.recording.stopped",
      source: "browser",
      durationMs: 900
    });

    resumedStream = await openEventStream(
      `${baseUrl}/events?sessionId=sse-a`,
      { "last-event-id": `${attemptA}:2` }
    );
    await resumedStream.waitFor(
      (frames) => sessionFrames(frames).length === 1,
      "missing event replay after Last-Event-ID"
    );

    assert.deepEqual(
      sessionFrames(resumedStream.frames).map(summarizeFrame),
      [
        {
          event: "input.recording.stopped",
          id: `${attemptA}:3`,
          sessionId: "sse-a",
          attemptId: attemptA,
          sequence: 3
        }
      ]
    );

    await postJson(baseUrl, "/sessions/sse-b/demo-event", {
      type: "session.error",
      payload: { message: "foreign live event" }
    });
    await postJson(baseUrl, "/sessions/sse-a/demo-event", {
      type: "session.error",
      payload: { message: "active live event" }
    });
    await resumedStream.waitFor(
      (frames) => sessionFrames(frames).some(
        (frame) => frame.data.sessionId === "sse-a" && frame.data.sequence === 4
      ),
      "live event for the scoped session"
    );

    assert.deepEqual(
      sessionFrames(resumedStream.frames).map(summarizeFrame),
      [
        {
          event: "input.recording.stopped",
          id: `${attemptA}:3`,
          sessionId: "sse-a",
          attemptId: attemptA,
          sequence: 3
        },
        {
          event: "session.error",
          id: `${attemptA}:4`,
          sessionId: "sse-a",
          attemptId: attemptA,
          sequence: 4
        }
      ]
    );
    assert.equal(
      sessionFrames(resumedStream.frames).some(
        (frame) => frame.data.sessionId === "sse-b" || frame.data.attemptId === attemptB
      ),
      false
    );
  } finally {
    await resumedStream?.close();
    await initialStream?.close();
    await waitForCondition(
      () => bus.listenerCount === 0,
      "SSE listener cleanup"
    );
    await closeServer(server);
  }
});

test("SSE connection admission rejects excess clients and reopens after cleanup", async () => {
  const bus = new EventBus();
  const store = new SessionStore();
  store.createSession({ sessionId: "sse-capacity", source: "browser" });
  const server = http.createServer(
    createRequestHandler({
      bus,
      maxSseConnections: 1,
      receipts: new ReceiptWriter(false),
      store
    })
  );
  const baseUrl = await listen(server);
  let first;
  let reused;

  try {
    const url = `${baseUrl}/events?sessionId=sse-capacity`;
    first = await openEventStream(url);
    const rejected = await fetch(url);
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), {
      error: "SSE connection capacity (1) was exceeded",
      code: "sse_capacity_exceeded",
      maxConnections: 1
    });

    await first.close();
    first = undefined;
    await waitForCondition(
      () => bus.listenerCount === 0,
      "SSE capacity cleanup"
    );
    reused = await openEventStream(url);
    assert.equal(reused.headers.get("content-type"), "text/event-stream");
  } finally {
    await reused?.close();
    await first?.close();
    await closeServer(server);
  }
});

test("SSE closes a slow client immediately when response backpressure begins", async () => {
  const bus = new EventBus();
  const store = new SessionStore();
  const session = store.createSession({
    sessionId: "sse-backpressure",
    source: "browser"
  });
  const handler = createRequestHandler({
    bus,
    maxSseConnections: 1,
    receipts: new ReceiptWriter(false),
    store
  });
  const request = new EventEmitter();
  request.method = "GET";
  request.url = `/events?sessionId=${session.id}`;
  request.headers = {};
  const response = new EventEmitter();
  let writes = 0;
  let ended = false;
  response.setHeader = () => undefined;
  response.writeHead = () => undefined;
  response.write = () => {
    writes += 1;
    return writes === 1;
  };
  response.end = () => {
    ended = true;
    response.emit("close");
  };

  await handler(request, response);
  assert.equal(bus.listenerCount, 1);
  bus.publish({
    type: "session.created",
    sessionId: session.id,
    attemptId: session.attemptId,
    sequence: 1,
    source: "browser",
    timestamp: Date.now()
  });

  assert.equal(ended, true);
  assert.equal(bus.listenerCount, 0);
  assert.equal(writes, 2);
});

test("SSE connection policy fails closed for a present invalid environment value", () => {
  const previous = process.env.JIKO_SSE_MAX_CONNECTIONS;
  process.env.JIKO_SSE_MAX_CONNECTIONS = "";
  try {
    assert.throws(
      () => createRequestHandler({
        bus: new EventBus(),
        receipts: new ReceiptWriter(false),
        store: new SessionStore()
      }),
      /JIKO_SSE_MAX_CONNECTIONS must be a positive safe integer/
    );
  } finally {
    if (previous === undefined) {
      delete process.env.JIKO_SSE_MAX_CONNECTIONS;
    } else {
      process.env.JIKO_SSE_MAX_CONNECTIONS = previous;
    }
  }
});

async function listen(server) {
  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections?.();
  });
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(
    response.ok,
    true,
    `POST ${path} failed with ${response.status}: ${JSON.stringify(payload)}`
  );
  return payload;
}

async function openEventStream(url, headers = {}) {
  const controller = new AbortController();
  const response = await fetch(url, {
    headers,
    signal: controller.signal
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream\b/);
  assert.ok(response.body);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buffered = "";
  let pumpError;
  let closed = false;

  const pump = (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          buffered += decoder.decode();
          break;
        }

        buffered += decoder.decode(chunk.value, { stream: true });
        buffered = drainFrames(buffered, frames);
      }
      buffered = drainFrames(buffered, frames);
    } catch (error) {
      if (!controller.signal.aborted) {
        pumpError = error;
      }
    }
  })();

  return {
    frames,
    headers: response.headers,
    async waitFor(predicate, label) {
      await waitForCondition(() => {
        if (pumpError) {
          throw pumpError;
        }
        return predicate(frames);
      }, label);
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      controller.abort();
      await reader.cancel().catch(() => undefined);
      await pump;
    }
  };
}

function drainFrames(buffer, frames) {
  while (true) {
    const separator = /\r?\n\r?\n/.exec(buffer);
    if (!separator) {
      return buffer;
    }

    const block = buffer.slice(0, separator.index);
    buffer = buffer.slice(separator.index + separator[0].length);
    const frame = parseFrame(block);
    if (frame) {
      frames.push(frame);
    }
  }
}

function parseFrame(block) {
  let id;
  let event = "message";
  const data = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "id") {
      id = value;
    } else if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  if (data.length === 0) {
    return undefined;
  }

  return {
    id,
    event,
    data: JSON.parse(data.join("\n"))
  };
}

function sessionFrames(frames) {
  return frames.filter(
    (frame) => typeof frame.data.sessionId === "string" && frame.data.attemptId
  );
}

function summarizeFrame(frame) {
  return {
    event: frame.event,
    id: frame.id,
    sessionId: frame.data.sessionId,
    attemptId: frame.data.attemptId,
    sequence: frame.data.sequence
  };
}

async function waitForCondition(condition, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`Timed out waiting for ${label}`);
}
