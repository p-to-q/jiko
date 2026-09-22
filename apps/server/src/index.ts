import http from "node:http";
import { AttemptDeadlineRegistry } from "./attemptDeadline.js";
import { AttemptWorkRegistry } from "./attemptWork.js";
import {
  assertAudioPipelineConfiguration,
  runAudioPipeline
} from "./audioPipeline.js";
import { AudioResourceAdmission } from "./audioResourceAdmission.js";
import { EventBus } from "./eventBus.js";
import { attachOrderedPcmWebSocketServer } from "./orderedPcmWebSocket.js";
import { OutputScheduler } from "./outputScheduler.js";
import { stopConfiguredSherpaSenseVoiceWorker } from "./persistentSttWorker.js";
import { ReceiptWriter } from "./receipts.js";
import { createRequestHandler } from "./routes.js";
import { resolveServerHost } from "./runtimeConfig.js";
import { SessionStore } from "./sessionStore.js";

const port = readPort(process.env.PORT);
// The local instrument has no LAN authentication boundary yet. Keep source
// defaults aligned with the production systemd profile and require an explicit
// deployment decision before exposing the write API off-device.
const host = resolveServerHost(process.env.HOST);
assertAudioPipelineConfiguration();

const bus = new EventBus();
const audioAdmission = new AudioResourceAdmission();
const attemptDeadlines = new AttemptDeadlineRegistry();
const attemptWork = new AttemptWorkRegistry();
const outputs = new OutputScheduler();
const receipts = new ReceiptWriter();
const store = new SessionStore();

const dependencies = {
  audioAdmission,
  attemptDeadlines,
  attemptWork,
  bus,
  outputs,
  pipelineRunner: runAudioPipeline,
  receipts,
  store
};
const server = http.createServer(createRequestHandler(dependencies));
server.headersTimeout = readPositiveInteger(
  process.env.JIKO_HTTP_HEADERS_TIMEOUT_MS,
  10_000,
  "JIKO_HTTP_HEADERS_TIMEOUT_MS"
);
server.requestTimeout = readPositiveInteger(
  process.env.JIKO_HTTP_REQUEST_TIMEOUT_MS,
  15_000,
  "JIKO_HTTP_REQUEST_TIMEOUT_MS"
);
server.keepAliveTimeout = readPositiveInteger(
  process.env.JIKO_HTTP_KEEP_ALIVE_TIMEOUT_MS,
  5_000,
  "JIKO_HTTP_KEEP_ALIVE_TIMEOUT_MS"
);
server.maxRequestsPerSocket = readPositiveInteger(
  process.env.JIKO_HTTP_MAX_REQUESTS_PER_SOCKET,
  100,
  "JIKO_HTTP_MAX_REQUESTS_PER_SOCKET"
);
const orderedPcm = attachOrderedPcmWebSocketServer(server, dependencies);

server.listen(port, host, () => {
  console.log(`jiko mock server listening on http://${host}:${port}`);
  console.log(`receipts ${receipts.enabled ? "enabled" : "disabled"}`);
});

let shuttingDown = false;

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  attemptDeadlines.close(new Error(`Server is shutting down after ${signal}`));
  attemptWork.close(new Error(`Server is shutting down after ${signal}`));
  outputs.close(new Error(`Server is shutting down after ${signal}`));
  await orderedPcm.close();
  await Promise.all([
    closeServer(),
    stopConfiguredSherpaSenseVoiceWorker(),
    waitForOutputDrain(3_000)
  ]);
  process.exitCode = 0;
}

function closeServer(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceClose);
      resolve();
    };
    const forceClose = setTimeout(() => {
      server.closeAllConnections();
      finish();
    }, 1_500);
    forceClose.unref?.();
    server.close(finish);
  });
}

async function waitForOutputDrain(timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
    timeout.unref?.();
  });

  await Promise.race([outputs.waitForIdle(), deadline]);
  if (timeout) {
    clearTimeout(timeout);
  }
}

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? "4317");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return 4317;
  }

  return parsed;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) {
    return fallback;
  }
  const raw = value.trim();
  const parsed = Number(raw);
  if (!raw || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}
