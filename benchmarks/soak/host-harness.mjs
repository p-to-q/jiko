import { randomUUID } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import net from "node:net";
import { arch, platform, release } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertHostSoakReceipt,
  deriveHostSoftwareIntegrity,
  hostSoakSchemaPath,
  sha256
} from "./receipt.mjs";

const execFileAsync = promisify(execFile);
const soakDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(soakDirectory, "../..");
const harnessPath = fileURLToPath(import.meta.url);
const validatorPath = path.join(soakDirectory, "receipt.mjs");
const lockfilePath = path.join(repositoryRoot, "pnpm-lock.yaml");
const serverEntryPath = path.join(
  repositoryRoot,
  "apps",
  "server",
  "dist",
  "index.js"
);
const sessionReceiptDirectory = path.join(
  repositoryRoot,
  "apps",
  "server",
  "sessions"
);
const outputRoot = path.join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "host-soak-v1"
);
const disclaimer =
  "Host software HTTP/SSE/session/receipt evidence only; not hardware, physical capture, STT-quality, power, or thermal evidence.";
const syntheticTexts = [
  "我在考虑改变，但还想先把边界说清楚。",
  "I want to continue, but I need a smaller next step.",
  "我会先停一下，再决定 whether to change direction."
];

class DeadlineError extends Error {}

const configuration = readConfiguration();
const startedAt = new Date();
const startedMonotonic = performance.now();
const runId = `host-soak-${startedAt
  .toISOString()
  .replaceAll(":", "-")
  .replaceAll(".", "-")}-${randomUUID().slice(0, 8)}`;
const sessionPrefix = `soak-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const outputDirectory = path.join(outputRoot, runId);
const generatedAudio = createSyntheticWav(configuration.syntheticAudio);
const cases = [];
const recordedErrors = [];
let omittedErrorCount = 0;
let server;
let serverPid = null;
let baseUrl = "";
let serverOutput = "";
let serverStartupMs = 0;
let fatalError;
let stoppingServer = false;
const rssSamples = [];
const observedCoverage = {
  nodeHttpServer: false,
  http: false,
  sseLive: false,
  receiptEndpoint: false,
  receiptDisk: false
};
const integrity = {
  sessionsCreated: 0,
  singleFinalSessions: 0,
  duplicateFinalResultCount: 0,
  stuckSessionCount: 0,
  eventLossCount: 0,
  unexpectedSseEventCount: 0,
  duplicateSseEventCount: 0,
  ssePayloadMismatchCount: 0,
  sseOrderViolationCount: 0,
  sseReplayFailureCount: 0,
  sequenceGapCount: 0,
  receiptMismatchCount: 0,
  providerBoundaryViolationCount: 0,
  diskReceiptMissingCount: 0,
  orphanTempReceiptCount: 0,
  serverProcessFailureCount: 0,
  requestFailureCount: 0
};

await run();

async function run() {
  try {
    await access(serverEntryPath);
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const serverStartedAt = performance.now();
    server = startServer(port);
    serverPid = server.pid ?? null;
    await waitForServerReady(server, configuration.startupTimeoutMs);
    serverStartupMs = rounded(performance.now() - serverStartedAt);
    observedCoverage.nodeHttpServer = true;
    observedCoverage.http = true;
    await sampleServerRss();

    const progressEvery = Math.max(
      1,
      Math.ceil(configuration.plannedTurns / 20)
    );
    for (let turn = 1; turn <= configuration.plannedTurns; turn += 1) {
      cases.push(await runTurn(turn));
      if (
        turn % configuration.rssSampleEvery === 0 ||
        turn === configuration.plannedTurns
      ) {
        await sampleServerRss();
      }
      if (turn % progressEvery === 0 || turn === configuration.plannedTurns) {
        console.log(`host soak progress: ${turn}/${configuration.plannedTurns}`);
      }
    }
  } catch (error) {
    fatalError = error;
    recordError(undefined, "harness_fatal", errorMessage(error));
  } finally {
    await sampleServerRss();
    await stopServer();
  }

  const orphanTempReceiptCount = await countGeneratedTempReceipts();
  integrity.orphanTempReceiptCount += orphanTempReceiptCount;
  const receipt = await buildReceipt();
  assertHostSoakReceipt(receipt);

  await mkdir(outputDirectory, { recursive: true });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptPath = path.join(outputDirectory, "receipt.json");
  await Promise.all([
    writeFile(receiptPath, serialized, "utf8"),
    writeFile(path.join(outputRoot, "latest.json"), serialized, "utf8")
  ]);

  if (!configuration.keepSessionReceipts) {
    await removeGeneratedSessionReceipts();
  }

  console.log(
    `host soak ${receipt.qualification.hostSoftwareIntegrity}: ` +
      `${receipt.campaign.resultTurns}/${receipt.campaign.plannedTurns} result turns`
  );
  console.log("hardware/STT/thermal qualification: not_evaluated");
  console.log(`receipt: ${repositoryRelative(receiptPath)}`);

  if (receipt.qualification.hostSoftwareIntegrity !== "pass" || fatalError) {
    process.exitCode = 1;
  }
}

function startServer(port) {
  const child = spawn(process.execPath, [serverEntryPath], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "development",
      JIKO_WRITE_RECEIPTS: "1",
      STT_PROVIDER: "",
      TTS_PROVIDER: "",
      TTS_PLAY_AUDIO: "0",
      FUNASR_ENDPOINT: "",
      WHISPER_CPP_BIN: "",
      WHISPER_MODEL: "",
      SHERPA_ONNX_SENSEVOICE_MODEL: "",
      SHERPA_ONNX_SENSEVOICE_TOKENS: "",
      SESSION_DEADLINE_MS: String(configuration.sessionDeadlineMs),
      SESSION_RESULT_COMMIT_RESERVE_MS: String(
        configuration.resultCommitReserveMs
      )
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const captureOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-64 * 1024);
  };
  child.stdout.on("data", captureOutput);
  child.stderr.on("data", captureOutput);
  child.once("exit", (code, signal) => {
    if (!stoppingServer) {
      integrity.serverProcessFailureCount += 1;
      recordError(
        undefined,
        "server_process_exited",
        `Server exited unexpectedly with code ${String(code)} and signal ${String(signal)}.`
      );
    }
  });
  return child;
}

async function waitForServerReady(child, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Server exited before HTTP readiness: ${boundedServerOutput()}`
      );
    }
    try {
      const { response, payload } = await fetchJson(
        `${baseUrl}/sessions/__soak_readiness_probe__`,
        {
          timeoutMs: Math.min(
            2000,
            Math.max(100, deadline - performance.now())
          )
        }
      );
      if (response.status === 404 && payload?.error === "Session not found") {
        return;
      }
    } catch {
      // Connection failures are expected until the listener is ready.
    }
    await sleep(50);
  }
  throw new Error(
    `Server did not accept the readiness HTTP probe within ${timeoutMs} ms: ${boundedServerOutput()}`
  );
}

async function runTurn(turn) {
  const turnStarted = performance.now();
  const deadline = turnStarted + configuration.turnTimeoutMs;
  const sessionId = `${sessionPrefix}-${String(turn).padStart(5, "0")}`;
  const inputPath = isSyntheticAudioTurn(turn)
    ? "synthetic_audio"
    : "manual";
  const issueCodes = new Set();
  let duplicateCreateProbe = "not_run";
  let duplicateFinalSubmissionProbe = "not_run";
  let sseReplayProbe = "not_run";
  let recordingStartStopProbe = "not_run";
  let observer;
  let session;
  let outcome = "harness_error";
  let finalStatus = "unavailable";
  let providers = emptyProviderObservations();

  const issue = (code, message, counter) => {
    issueCodes.add(code);
    if (counter) {
      integrity[counter] += 1;
    }
    recordError(turn, code, message);
  };

  try {
    const created = await postJson(
      "/sessions",
      { sessionId, source: inputPath === "manual" ? "manual" : "browser" },
      remainingMs(deadline)
    );
    if (created.response.status !== 201 || !created.payload?.session?.attemptId) {
      issue(
        "session_create_failed",
        responseFailure("session create", created),
        "requestFailureCount"
      );
      throw new Error("Session creation did not return a new attempt.");
    }
    integrity.sessionsCreated += 1;
    const attemptId = created.payload.session.attemptId;

    const createReplay = await postJson(
      "/sessions",
      { sessionId, source: inputPath === "manual" ? "manual" : "browser" },
      remainingMs(deadline)
    );
    duplicateCreateProbe =
      createReplay.response.status === 200 &&
      createReplay.payload?.replayed === true &&
      createReplay.payload?.session?.attemptId === attemptId
        ? "passed"
        : "failed";
    if (duplicateCreateProbe === "failed") {
      issue(
        "duplicate_create_probe_failed",
        responseFailure("duplicate create", createReplay),
        "requestFailureCount"
      );
    }

    observer = await createSseObserver(
      `${baseUrl}/events?sessionId=${encodeURIComponent(sessionId)}`,
      {},
      remainingMs(deadline)
    );
    await observer.waitFor(
      (message) => message.type === "server.connected",
      remainingMs(deadline)
    );
    observedCoverage.sseLive = true;

    let submission;
    if (inputPath === "synthetic_audio") {
      recordingStartStopProbe = "failed";
      const monotonicStart = performance.now();
      const started = await postJson(
        `/sessions/${sessionId}/input-event`,
        {
          type: "input.recording.started",
          source: "browser",
          monotonicMs: monotonicStart
        },
        remainingMs(deadline)
      );
      if (!started.response.ok) {
        issue(
          "recording_start_failed",
          responseFailure("recording start", started),
          "requestFailureCount"
        );
        throw new Error("Recording start failed.");
      }

      const stopped = await postJson(
        `/sessions/${sessionId}/input-event`,
        {
          type: "input.recording.stopped",
          source: "browser",
          monotonicMs: performance.now(),
          durationMs: configuration.syntheticAudio.durationMs
        },
        remainingMs(deadline)
      );
      if (!stopped.response.ok) {
        issue(
          "recording_stop_failed",
          responseFailure("recording stop", stopped),
          "requestFailureCount"
        );
        throw new Error("Recording stop failed.");
      }
      recordingStartStopProbe = "passed";

      submission = await postAudio(sessionId, remainingMs(deadline));
    } else {
      submission = await postJson(
        `/sessions/${sessionId}/manual-transcript`,
        {
          transcript: syntheticTexts[(turn - 1) % syntheticTexts.length],
          language: turn % 3 === 2 ? "en" : "zh"
        },
        remainingMs(deadline)
      );
    }

    if (!submission.response.ok) {
      issue(
        "final_submission_failed",
        responseFailure("final submission", submission),
        "requestFailureCount"
      );
    }

    session = await waitForSettledSession(sessionId, deadline);
    if (!session) {
      outcome = "stuck";
      finalStatus = "nonterminal";
      integrity.stuckSessionCount += 1;
      issue("session_stuck", "Session did not reach a terminal state before the turn deadline.");
      return finishTurn();
    }
    finalStatus = terminalStatus(session.status);
    outcome = session.status === "result" ? "result" : "terminal_error";

    await observer.waitFor(
      (message) =>
        message.sessionId === sessionId &&
        message.attemptId === session.attemptId &&
        message.sequence === session.lastSequence,
      remainingMs(deadline)
    );

    const duplicateSubmission =
      inputPath === "synthetic_audio"
        ? await postAudio(sessionId, remainingMs(deadline))
        : await postJson(
            `/sessions/${sessionId}/manual-transcript`,
            {
              transcript: syntheticTexts[(turn - 1) % syntheticTexts.length],
              language: turn % 3 === 2 ? "en" : "zh"
            },
            remainingMs(deadline)
          );
    duplicateFinalSubmissionProbe =
      duplicateSubmission.response.status === 409 ? "passed" : "failed";
    if (duplicateFinalSubmissionProbe === "failed") {
      issue(
        "duplicate_final_submission_probe_failed",
        responseFailure("duplicate final submission", duplicateSubmission),
        "requestFailureCount"
      );
    }

    const refreshed = await getJson(
      `/sessions/${sessionId}`,
      remainingMs(deadline)
    );
    if (!refreshed.response.ok || !refreshed.payload?.session) {
      issue(
        "session_fetch_failed",
        responseFailure("session fetch", refreshed),
        "requestFailureCount"
      );
    } else {
      session = refreshed.payload.session;
    }

    const liveReceiptResponse = await getJson(
      `/sessions/${sessionId}/receipt`,
      remainingMs(deadline)
    );
    const liveReceipt = liveReceiptResponse.response.ok
      ? liveReceiptResponse.payload
      : undefined;
    providers = observeProviderRoutes(inputPath, liveReceipt);
    if (liveReceipt) {
      observedCoverage.receiptEndpoint = true;
    }
    if (!liveReceipt) {
      issue(
        "live_receipt_missing",
        responseFailure("live receipt", liveReceiptResponse),
        "receiptMismatchCount"
      );
    }

    const diskReceipt = await readDiskReceipt(sessionId, session, deadline);
    if (diskReceipt) {
      observedCoverage.receiptDisk = true;
    }
    if (!diskReceipt) {
      issue(
        "disk_receipt_missing",
        "The server did not produce the expected on-disk session receipt.",
        "diskReceiptMissingCount"
      );
    }

    auditCanonicalEvidence({
      session,
      liveReceipt,
      diskReceipt,
      sseEvents: observer.canonicalEvents(),
      inputPath,
      providers,
      issue
    });

    if (shouldProbeReplay(turn)) {
      sseReplayProbe = await auditSseReplay(session, deadline, issue);
    }
  } catch (error) {
    if (isDeadlineError(error)) {
      outcome = "stuck";
      finalStatus = session ? terminalStatus(session.status) : "nonterminal";
      integrity.stuckSessionCount += 1;
      issue("turn_deadline_exceeded", errorMessage(error));
    } else {
      outcome = "harness_error";
      issue("turn_harness_error", errorMessage(error));
    }
  } finally {
    await observer?.close();
  }

  return finishTurn();

  function finishTurn() {
    return {
      turn,
      sessionId,
      path: inputPath,
      outcome,
      latencyMs: rounded(performance.now() - turnStarted),
      finalStatus,
      lastSequence: session?.lastSequence ?? 0,
      eventCount: session?.events?.length ?? 0,
      sseEventCount: observer?.canonicalEvents().length ?? 0,
      recordingStartStopProbe,
      duplicateCreateProbe,
      duplicateFinalSubmissionProbe,
      sseReplayProbe,
      providers,
      issueCodes: [...issueCodes].sort()
    };
  }
}

async function auditSseReplay(session, deadline, issue) {
  const afterSequence = Math.floor(session.lastSequence / 2);
  let replayObserver;
  try {
    replayObserver = await createSseObserver(
      `${baseUrl}/events?sessionId=${encodeURIComponent(session.id)}`,
      { "last-event-id": `${session.attemptId}:${afterSequence}` },
      remainingMs(deadline)
    );
    await replayObserver.waitFor(
      (message) =>
        message.attemptId === session.attemptId &&
        message.sequence === session.lastSequence,
      remainingMs(deadline)
    );
    const expected = session.events.filter(
      (event) => event.sequence > afterSequence
    );
    const replayPassed = auditSseEvents(
      expected,
      replayObserver.canonicalEvents(),
      issue,
      "replay"
    );
    return replayPassed ? "passed" : "failed";
  } catch (error) {
    issue(
      "sse_replay_probe_failed",
      errorMessage(error),
      "sseReplayFailureCount"
    );
    return "failed";
  } finally {
    await replayObserver?.close();
  }
}

function auditCanonicalEvidence({
  session,
  liveReceipt,
  diskReceipt,
  sseEvents,
  inputPath,
  providers,
  issue
}) {
  const events = Array.isArray(session?.events) ? session.events : [];
  let sequenceGaps = 0;
  for (let index = 0; index < events.length; index += 1) {
    if (
      events[index]?.sequence !== index + 1 ||
      events[index]?.sessionId !== session.id ||
      events[index]?.attemptId !== session.attemptId
    ) {
      sequenceGaps += 1;
    }
  }
  if (session.lastSequence !== events.length) {
    sequenceGaps += 1;
  }
  if (sequenceGaps > 0) {
    integrity.sequenceGapCount += sequenceGaps;
    issue("canonical_sequence_gap", `${sequenceGaps} canonical sequence checks failed.`);
  }

  const finalCount = events.filter((event) => event.type === "session.result").length;
  if (finalCount === 1) {
    integrity.singleFinalSessions += 1;
  }
  if (finalCount > 1) {
    const duplicates = finalCount - 1;
    integrity.duplicateFinalResultCount += duplicates;
    issue("duplicate_final_result", `${duplicates} duplicate final result events were stored.`);
  }
  if (session.status === "result" && finalCount !== 1) {
    issue(
      "result_final_count_invalid",
      `A result session contained ${finalCount} session.result events.`,
      "receiptMismatchCount"
    );
  }

  auditSseEvents(events, sseEvents, issue, "live");

  if (!receiptMatchesSession(liveReceipt, session)) {
    issue(
      "live_receipt_mismatch",
      "The canonical receipt endpoint did not match the settled session snapshot.",
      "receiptMismatchCount"
    );
  }
  if (!receiptMatchesSession(diskReceipt, session)) {
    issue(
      "disk_receipt_mismatch",
      "The on-disk canonical receipt did not match the settled session snapshot.",
      "receiptMismatchCount"
    );
  }
  if (
    liveReceipt &&
    diskReceipt &&
    JSON.stringify(liveReceipt) !== JSON.stringify(diskReceipt)
  ) {
    issue(
      "receipt_surfaces_diverged",
      "The endpoint and on-disk receipt snapshots diverged.",
      "receiptMismatchCount"
    );
  }

  if (
    liveReceipt &&
    !providerBoundaryMatches(inputPath, liveReceipt, providers)
  ) {
    issue(
      "provider_boundary_violation",
      "The session receipt did not preserve the soak's disabled-STT and disabled-playback boundary.",
      "providerBoundaryViolationCount"
    );
  }
}

function providerBoundaryMatches(inputPath, receipt, providers) {
  const stt = receipt.providers?.stt;
  if (inputPath === "synthetic_audio") {
    if (
      providers.stt.route !== "disabled" ||
      stt?.outcome !== "provider_unavailable" ||
      stt?.remote !== false ||
      stt?.execution ||
      stt?.remoteExecution ||
      receipt.transcript?.failureCode !== "provider_unavailable"
    ) {
      return false;
    }
  } else if (
    providers.stt.route !== "manual" ||
    stt?.outcome !== "not_run" ||
    stt?.remote !== false ||
    stt?.execution ||
    stt?.remoteExecution
  ) {
    return false;
  }

  const tts = receipt.providers?.tts;
  return (
    providers.tts.route === "not_observed" ||
    (providers.tts.route === "disabled" && tts?.remote === false)
  );
}

function observeProviderRoutes(inputPath, receipt) {
  const stt = receipt?.providers?.stt;
  const tts = receipt?.providers?.tts;
  return {
    stt: providerObservation(stt, classifySttRoute(inputPath, stt), true),
    tts: providerObservation(tts, classifyGenericProviderRoute(tts), false)
  };
}

function emptyProviderObservations() {
  return {
    stt: { route: "not_observed" },
    tts: { route: "not_observed" }
  };
}

function providerObservation(provider, route, includeOutcome) {
  return {
    route,
    ...(typeof provider?.id === "string" && provider.id
      ? { providerId: provider.id }
      : {}),
    ...(includeOutcome && typeof provider?.outcome === "string"
      ? { outcome: provider.outcome }
      : {})
  };
}

function classifySttRoute(inputPath, provider) {
  if (!provider) {
    return "not_observed";
  }
  if (provider.remoteExecution?.mode === "batch") {
    return "remote_batch";
  }
  if (provider.remote === true) {
    return "remote";
  }
  if (provider.execution) {
    return "local";
  }
  if (inputPath === "manual" && provider.outcome === "not_run") {
    return "manual";
  }
  if (provider.outcome === "provider_unavailable") {
    return "disabled";
  }
  return "local";
}

function classifyGenericProviderRoute(provider) {
  if (!provider) {
    return "not_observed";
  }
  if (provider.remote === true) {
    return "remote";
  }
  if (/unconfigured|unavailable|disabled/i.test(provider.id ?? "")) {
    return "disabled";
  }
  return "local";
}

function auditSseEvents(expectedEvents, observedEvents, issue, streamKind) {
  const expectedById = countEvents(expectedEvents);
  const observedById = countEvents(observedEvents);
  let lost = 0;
  let duplicate = 0;
  let unexpected = 0;
  let payloadMismatches = 0;
  let orderViolations = 0;

  for (const [id, expectedCount] of expectedById) {
    const observedCount = observedById.get(id) ?? 0;
    lost += Math.max(0, expectedCount - observedCount);
    duplicate += Math.max(0, observedCount - expectedCount);
  }
  for (const [id, observedCount] of observedById) {
    if (!expectedById.has(id)) {
      unexpected += observedCount;
    }
  }
  const expectedPayloadById = new Map(
    expectedEvents.map((event) => [
      `${event?.attemptId ?? "missing"}:${event?.sequence ?? "missing"}`,
      JSON.stringify(event)
    ])
  );
  for (const event of observedEvents) {
    const id = `${event?.attemptId ?? "missing"}:${event?.sequence ?? "missing"}`;
    const expectedPayload = expectedPayloadById.get(id);
    if (expectedPayload && expectedPayload !== JSON.stringify(event)) {
      payloadMismatches += 1;
    }
  }
  const expectedOrder = expectedEvents.map(
    (event) => `${event?.attemptId ?? "missing"}:${event?.sequence ?? "missing"}`
  );
  const observedOrder = observedEvents.map(
    (event) => `${event?.attemptId ?? "missing"}:${event?.sequence ?? "missing"}`
  );
  if (JSON.stringify(expectedOrder) !== JSON.stringify(observedOrder)) {
    orderViolations = 1;
  }

  if (lost > 0) {
    integrity.eventLossCount += lost;
    issue(`sse_${streamKind}_event_loss`, `${lost} expected SSE events were not observed.`);
  }
  if (duplicate > 0) {
    integrity.duplicateSseEventCount += duplicate;
    issue(`sse_${streamKind}_duplicates`, `${duplicate} duplicate SSE events were observed.`);
  }
  if (unexpected > 0) {
    integrity.unexpectedSseEventCount += unexpected;
    issue(`sse_${streamKind}_unexpected`, `${unexpected} unexpected SSE events were observed.`);
  }
  if (payloadMismatches > 0) {
    integrity.ssePayloadMismatchCount += payloadMismatches;
    issue(
      `sse_${streamKind}_payload_mismatch`,
      `${payloadMismatches} SSE event payloads differed from canonical storage.`
    );
  }
  if (orderViolations > 0) {
    integrity.sseOrderViolationCount += orderViolations;
    issue(
      `sse_${streamKind}_order_violation`,
      "SSE event order differed from canonical sequence order."
    );
  }
  return (
    lost === 0 &&
    duplicate === 0 &&
    unexpected === 0 &&
    payloadMismatches === 0 &&
    orderViolations === 0
  );
}

function countEvents(events) {
  const counts = new Map();
  for (const event of events) {
    const id = `${event?.attemptId ?? "missing"}:${event?.sequence ?? "missing"}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function receiptMatchesSession(receipt, session) {
  return Boolean(
    receipt &&
      receipt.schemaVersion === "session_receipt_v1" &&
      receipt.sessionId === session.id &&
      receipt.attemptId === session.attemptId &&
      receipt.status === session.status &&
      receipt.lastSequence === session.lastSequence &&
      receipt.input?.audioStored === false &&
      JSON.stringify(receipt.events) === JSON.stringify(session.events)
  );
}

async function waitForSettledSession(sessionId, deadline) {
  let latest;
  while (performance.now() < deadline) {
    const response = await getJson(
      `/sessions/${sessionId}`,
      remainingMs(deadline)
    );
    if (response.response.ok && response.payload?.session) {
      latest = response.payload.session;
      if (isSettled(latest)) {
        return latest;
      }
    }
    await sleep(20);
  }
  return undefined;
}

function isSettled(session) {
  if (["error", "reset", "silence"].includes(session.status)) {
    return true;
  }
  if (session.status !== "result") {
    return false;
  }
  if (!session.result?.tts) {
    return true;
  }
  return session.events.some((event) => event.type === "tts.finished");
}

async function readDiskReceipt(sessionId, expectedSession, deadline) {
  const receiptPath = path.join(sessionReceiptDirectory, `${sessionId}.json`);
  let latestReceipt;
  while (performance.now() < deadline) {
    try {
      latestReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
      if (receiptMatchesSession(latestReceipt, expectedSession)) {
        return latestReceipt;
      }
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }
    }
    await sleep(20);
  }
  return latestReceipt;
}

async function createSseObserver(url, headers, timeoutMs) {
  const controller = new AbortController();
  const connectTimer = setTimeout(
    () => controller.abort(new DeadlineError("SSE connection timed out.")),
    timeoutMs
  );
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "text/event-stream", ...headers },
      signal: controller.signal
    });
  } finally {
    clearTimeout(connectTimer);
  }
  if (!response.ok || !response.body) {
    controller.abort();
    throw new Error(`SSE connection failed with HTTP ${response.status}.`);
  }

  const messages = [];
  const waiters = new Set();
  let streamError;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const notify = () => {
    for (const waiter of [...waiters]) {
      const match = messages.find(waiter.predicate);
      if (match) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(match);
      } else if (streamError) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(streamError);
      }
    }
  };

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
        let separator = buffer.indexOf("\n\n");
        while (separator >= 0) {
          const block = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const parsed = parseSseBlock(block);
          if (parsed) {
            messages.push(parsed);
            notify();
          }
          separator = buffer.indexOf("\n\n");
        }
        if (done) {
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        streamError = error;
      }
    } finally {
      notify();
    }
  })();

  return {
    waitFor(predicate, waitTimeoutMs) {
      const existing = messages.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      if (streamError) {
        return Promise.reject(streamError);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new DeadlineError("Timed out waiting for an SSE event."));
          }, waitTimeoutMs)
        };
        waiters.add(waiter);
      });
    },
    canonicalEvents() {
      return messages.filter(
        (message) =>
          typeof message.attemptId === "string" &&
          Number.isInteger(message.sequence)
      );
    },
    async close() {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      await pump.catch(() => undefined);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("SSE observer closed."));
      }
      waiters.clear();
    }
  };
}

function parseSseBlock(block) {
  if (!block || block.startsWith(":")) {
    return undefined;
  }
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return undefined;
  }
  return JSON.parse(dataLines.join("\n"));
}

async function postJson(route, body, timeoutMs) {
  return fetchJson(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs
  });
}

async function postAudio(sessionId, timeoutMs) {
  const durationMs = configuration.syntheticAudio.durationMs;
  return fetchJson(
    `${baseUrl}/sessions/${sessionId}/audio?durationMs=${durationMs}&source=browser`,
    {
      method: "POST",
      headers: { "content-type": "audio/wav" },
      body: generatedAudio,
      timeoutMs
    }
  );
}

async function getJson(route, timeoutMs) {
  return fetchJson(`${baseUrl}${route}`, { timeoutMs });
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = configuration.turnTimeoutMs, ...requestOptions } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new DeadlineError("No time remained for the HTTP request.");
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DeadlineError(`HTTP request timed out: ${url}`)),
    timeoutMs
  );
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...requestOptions,
      signal: controller.signal
    });
    const text = await response.text();
    return {
      response,
      payload: text ? JSON.parse(text) : undefined,
      latencyMs: rounded(performance.now() - started)
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sampleServerRss() {
  if (!serverPid || server?.exitCode !== null || server?.signalCode !== null) {
    return;
  }
  try {
    const { stdout } = await execFileAsync("ps", [
      "-o",
      "rss=",
      "-p",
      String(serverPid)
    ]);
    const kibibytes = Number(stdout.trim());
    if (Number.isFinite(kibibytes) && kibibytes >= 0) {
      rssSamples.push(Math.round(kibibytes * 1024));
    }
  } catch (error) {
    if (rssSamples.length === 0) {
      recordError(undefined, "rss_unavailable", errorMessage(error));
    }
  }
}

async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) {
    return;
  }
  stoppingServer = true;
  server.kill("SIGTERM");
  const exited = once(server, "exit").then(() => true);
  const graceful = await Promise.race([exited, sleep(4000).then(() => false)]);
  if (!graceful && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit").catch(() => undefined);
    recordError(undefined, "server_forced_shutdown", "Server required SIGKILL after the soak.");
    integrity.serverProcessFailureCount += 1;
  }
}

async function buildReceipt() {
  const finishedAt = new Date();
  const campaign = campaignSummary(cases, configuration.plannedTurns);
  const coverage = coverageSummary(cases);
  const provisional = {
    campaign,
    integrity,
    coverage,
    configuration,
    cases
  };
  const hostSoftwareIntegrity = deriveHostSoftwareIntegrity(provisional);
  const harnessStatus =
    campaign.attemptedTurns !== campaign.plannedTurns
      ? "error"
      : hostSoftwareIntegrity === "pass"
        ? "completed"
        : "failed";
  const configBytes = Buffer.from(`${JSON.stringify(configuration, null, 2)}\n`);
  const [lockfile, schema, validator, harness, serverEntry] = await Promise.all([
    readFile(lockfilePath),
    readFile(hostSoakSchemaPath),
    readFile(validatorPath),
    readFile(harnessPath),
    readFile(serverEntryPath)
  ]);

  return {
    schema: "host_soak_v1",
    schemaVersion: 1,
    runId,
    evidenceClass: "host_software",
    harnessStatus,
    disclaimer,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMonotonicMs: rounded(performance.now() - startedMonotonic),
    source: {
      git: gitIdentity(),
      lockfileSha256: sha256(lockfile),
      schemaSha256: sha256(schema),
      validatorSha256: sha256(validator),
      harnessSha256: sha256(harness),
      serverEntrySha256: sha256(serverEntry),
      configurationSha256: sha256(configBytes)
    },
    environment: {
      kind: "host",
      platform: platform(),
      release: release(),
      arch: arch(),
      node: process.version,
      serverPid
    },
    configuration,
    coverage,
    campaign,
    integrity,
    measurements: {
      serverStartupMs,
      turnLatencyMs: latencyDistribution(
        cases.map((item) => item.latencyMs),
        "host monotonic clock; full harness turn"
      ),
      manualTurnLatencyMs: latencyDistribution(
        cases.filter((item) => item.path === "manual").map((item) => item.latencyMs),
        "host monotonic clock; manual turn"
      ),
      syntheticAudioTurnLatencyMs: latencyDistribution(
        cases
          .filter((item) => item.path === "synthetic_audio")
          .map((item) => item.latencyMs),
        "host monotonic clock; generated-WAV turn"
      ),
      latencyDrift: latencyDrift(cases.map((item) => item.latencyMs)),
      serverRss: rssMeasurement(rssSamples)
    },
    cases,
    qualification: {
      hostSoftwareIntegrity,
      performance: "not_evaluated",
      hardwareReliability: "not_evaluated",
      physicalAudioCapture: "not_evaluated",
      sttQuality: "not_evaluated",
      power: "not_evaluated",
      thermal: "not_evaluated",
      release: "not_evaluated",
      reasons: [
        "The host-software verdict covers only the configured HTTP, SSE, session, and receipt integrity campaign.",
        "Latency and RSS are observational because release thresholds are not locked.",
        "Generated PCM exercises codec and software plumbing, not a microphone, acoustic fixture, or STT model.",
        "Provider route labels are receipt provenance only; this default campaign disables STT and does not qualify either local inference or a remote batch API."
      ]
    },
    privacy: {
      stimulus: "fixed_synthetic_text_and_generated_pcm",
      realPersonContent: false,
      rawAudioRetainedByHarness: false,
      serverTempAudioResidueAudited: false,
      transcriptContentInSoakReceipt: false,
      sessionReceiptsRetained: configuration.keepSessionReceipts
    },
    errors: recordedErrors,
    omittedErrorCount
  };
}

function campaignSummary(caseResults, plannedTurns) {
  return {
    plannedTurns,
    attemptedTurns: caseResults.length,
    resultTurns: caseResults.filter((item) => item.outcome === "result").length,
    terminalErrorTurns: caseResults.filter(
      (item) => item.outcome === "terminal_error"
    ).length,
    stuckTurns: caseResults.filter((item) => item.outcome === "stuck").length,
    harnessErrorTurns: caseResults.filter(
      (item) => item.outcome === "harness_error"
    ).length
  };
}

function coverageSummary(caseResults) {
  const replayProbes = caseResults.filter(
    (item) => item.sseReplayProbe !== "not_run"
  ).length;
  return {
    nodeHttpServer: observedCoverage.nodeHttpServer,
    http: observedCoverage.http,
    sseLive: observedCoverage.sseLive,
    sseReplay: replayProbes > 0,
    receiptEndpoint: observedCoverage.receiptEndpoint,
    receiptDisk: observedCoverage.receiptDisk,
    manualTurns: caseResults.filter((item) => item.path === "manual").length,
    syntheticAudioTurns: caseResults.filter(
      (item) => item.path === "synthetic_audio"
    ).length,
    recordingStartStopTurns: caseResults.filter(
      (item) => item.recordingStartStopProbe === "passed"
    ).length,
    duplicateCreateProbes: caseResults.filter(
      (item) => item.duplicateCreateProbe !== "not_run"
    ).length,
    duplicateFinalSubmissionProbes: caseResults.filter(
      (item) => item.duplicateFinalSubmissionProbe !== "not_run"
    ).length,
    sseReplayProbes: replayProbes,
    excluded: {
      hardwarePresent: false,
      physicalControls: false,
      realMicrophone: false,
      realSpeech: false,
      sttQuality: false,
      speakerPlayback: false,
      power: false,
      thermal: false
    }
  };
}

function latencyDistribution(samples, source) {
  if (samples.length === 0) {
    return unavailableMeasurement("No matching completed harness turn was recorded.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    availability: "measured",
    unit: "ms",
    sampleCount: sorted.length,
    p50: rounded(percentile(sorted, 0.5)),
    p95: rounded(percentile(sorted, 0.95)),
    max: rounded(sorted.at(-1) ?? 0),
    source
  };
}

function latencyDrift(samples) {
  if (samples.length < 2) {
    return unavailableMeasurement("At least two turns are required for drift observation.");
  }
  const windowSize = Math.max(1, Math.floor(samples.length / 5));
  const first = [...samples.slice(0, windowSize)].sort((a, b) => a - b);
  const last = [...samples.slice(-windowSize)].sort((a, b) => a - b);
  const firstP50 = percentile(first, 0.5);
  const lastP50 = percentile(last, 0.5);
  const delta = lastP50 - firstP50;
  return {
    availability: "measured",
    unit: "ms",
    windowSize,
    firstWindowP50: rounded(firstP50),
    lastWindowP50: rounded(lastP50),
    delta: rounded(delta),
    percent: firstP50 === 0 ? null : rounded((delta / firstP50) * 100),
    source: "first-versus-last window of full host harness turn latency"
  };
}

function rssMeasurement(samples) {
  if (samples.length === 0) {
    return {
      availability: "unsupported",
      reason: "The host ps command did not return RSS for the spawned server PID."
    };
  }
  return {
    availability: "measured",
    unit: "bytes",
    sampleCount: samples.length,
    start: samples[0],
    end: samples.at(-1),
    peak: Math.max(...samples),
    delta: samples.at(-1) - samples[0],
    source: "host ps RSS for spawned server PID"
  };
}

function unavailableMeasurement(reason) {
  return { availability: "not_applicable", reason };
}

function percentile(sorted, quantile) {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function readConfiguration() {
  const plannedTurns = readInteger("JIKO_SOAK_TURNS", 6, 1, 10_000);
  const audioEvery = readInteger("JIKO_SOAK_AUDIO_EVERY", 3, 0, 10_000);
  const replayEvery = readInteger("JIKO_SOAK_REPLAY_EVERY", 3, 0, 10_000);
  return {
    plannedTurns,
    audioEvery,
    replayEvery,
    startupTimeoutMs: readInteger(
      "JIKO_SOAK_STARTUP_TIMEOUT_MS",
      60_000,
      1000,
      120_000
    ),
    turnTimeoutMs: readInteger(
      "JIKO_SOAK_TURN_TIMEOUT_MS",
      90_000,
      1000,
      120_000
    ),
    sessionDeadlineMs: readInteger(
      "JIKO_SOAK_SESSION_DEADLINE_MS",
      60_000,
      250,
      60_000
    ),
    resultCommitReserveMs: readInteger(
      "JIKO_SOAK_RESULT_COMMIT_RESERVE_MS",
      1000,
      1,
      59_999
    ),
    rssSampleEvery: readInteger(
      "JIKO_SOAK_RSS_SAMPLE_EVERY",
      Math.max(1, Math.ceil(plannedTurns / 100)),
      1,
      10_000
    ),
    keepSessionReceipts: readBoolean("JIKO_SOAK_KEEP_SESSION_RECEIPTS", false),
    server: {
      runtime: "spawned_node_process",
      transport: "localhost_http_sse",
      receiptWriting: true,
      stt: "disabled",
      ttsPlayback: "disabled"
    },
    syntheticAudio: {
      generatedInMemory: true,
      mediaType: "audio/wav",
      durationMs: 400,
      sampleRateHz: 16000,
      channelCount: 1,
      sampleFormat: "pcm_s16le"
    }
  };
}

function readInteger(name, fallback, minimum, maximum) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function readBoolean(name, fallback) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  throw new Error(`${name} must be 1, 0, true, or false.`);
}

function isSyntheticAudioTurn(turn) {
  return configuration.audioEvery > 0 && turn % configuration.audioEvery === 0;
}

function shouldProbeReplay(turn) {
  return configuration.replayEvery > 0 && turn % configuration.replayEvery === 0;
}

function createSyntheticWav(audioConfiguration) {
  const frameCount = Math.round(
    (audioConfiguration.sampleRateHz * audioConfiguration.durationMs) / 1000
  );
  const dataBytes = frameCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(audioConfiguration.sampleRateHz, 24);
  wav.writeUInt32LE(audioConfiguration.sampleRateHz * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const envelope = Math.min(1, frame / 160, (frameCount - frame) / 160);
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * frame) / audioConfiguration.sampleRateHz) *
        8000 *
        envelope
    );
    wav.writeInt16LE(sample, 44 + frame * 2);
  }
  return wav;
}

async function countGeneratedTempReceipts() {
  try {
    const entries = await readdir(sessionReceiptDirectory);
    return entries.filter(
      (entry) => entry.startsWith(`${sessionPrefix}-`) && entry.endsWith(".tmp")
    ).length;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

async function removeGeneratedSessionReceipts() {
  let entries;
  try {
    entries = await readdir(sessionReceiptDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const ownedEntries = entries.filter((entry) =>
    entry.startsWith(`${sessionPrefix}-`)
  );
  await Promise.all(
    ownedEntries.map((entry) =>
      rm(path.join(sessionReceiptDirectory, entry), { force: true })
    )
  );
}

function gitIdentity() {
  try {
    const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const dirty = Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim()
    );
    return { availability: "identified", sha: gitSha, dirty };
  } catch (error) {
    return {
      availability: "unavailable",
      reason: `Git identity unavailable: ${errorMessage(error)}`.slice(0, 300)
    };
  }
}

function recordError(turn, code, message) {
  if (recordedErrors.length >= 200) {
    omittedErrorCount += 1;
    return;
  }
  recordedErrors.push({
    ...(turn === undefined ? {} : { turn }),
    code,
    message: String(message).replace(/\s+/g, " ").slice(0, 500) || "Unknown error"
  });
}

function responseFailure(label, result) {
  return `${label} returned HTTP ${result.response.status}: ${JSON.stringify(result.payload)}`;
}

function terminalStatus(status) {
  return ["result", "error", "reset", "silence"].includes(status)
    ? status
    : "nonterminal";
}

function remainingMs(deadline) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) {
    throw new DeadlineError("The host soak turn deadline expired.");
  }
  return remaining;
}

function isDeadlineError(error) {
  return error instanceof DeadlineError || error?.name === "TimeoutError";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function boundedServerOutput() {
  return serverOutput.trim().slice(-500) || "no server output";
}

function repositoryRelative(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function rounded(value) {
  return Number(value.toFixed(4));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close(() => reject(new Error("Unable to allocate a host-soak port.")));
        return;
      }
      listener.close(() => resolve(address.port));
    });
  });
}
