import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectRuntime, parseLocalHttpUrl } from "../runtime-preflight.mjs";
import { probeServer, probeWeb } from "../runtime-probe.mjs";
import { validateUnits } from "../validate-units.mjs";

test("checked-in systemd units preserve the versioned supervision contract", async () => {
  const result = await validateUnits();
  assert.equal(result.schemaVersion, "jiko_systemd_contract_v1");
  assert.equal(result.outcome, "pass", failedChecks(result));
});

test("server preflight accepts an immutable release with external writable receipt state", async (context) => {
  const fixture = await serverFixture(context);
  const result = await inspectRuntime("server", fixture.environment);

  assert.equal(result.schemaVersion, "jiko_systemd_v1");
  assert.equal(result.outcome, "ready", failedChecks(result));
  assert.equal(statusOf(result, "receipt-state-target"), "pass");
  assert.equal(statusOf(result, "receipt-state-writable"), "pass");
});

test("server preflight rejects a release-owned receipt directory and remote self-hosted endpoint", async (context) => {
  const fixture = await serverFixture(context, { receiptDirectoryInsteadOfLink: true });
  fixture.environment.STT_PROVIDER = "funasr";
  fixture.environment.FUNASR_ENDPOINT = "http://192.168.1.50:10095";
  const result = await inspectRuntime("server", fixture.environment);

  assert.equal(result.outcome, "not_ready");
  assert.equal(statusOf(result, "receipt-state-link"), "fail");
  assert.equal(statusOf(result, "funasr-endpoint"), "fail");
});

test("preflight accepts only credential-free loopback HTTP URLs", () => {
  assert.equal(parseLocalHttpUrl("http://127.0.0.1:4317")?.port, "4317");
  assert.equal(parseLocalHttpUrl("http://localhost:4317/health")?.pathname, "/health");
  assert.equal(parseLocalHttpUrl("https://127.0.0.1:4317"), undefined);
  assert.equal(parseLocalHttpUrl("http://user:secret@127.0.0.1:4317"), undefined);
  assert.equal(parseLocalHttpUrl("http://192.168.1.10:4317"), undefined);
});

test("strict server probe requires ready diagnostics rather than configured labels", async () => {
  const ready = await probeServer({
    environment: {},
    fetchImpl: fakeFetch(healthBody("ready", "ready"))
  });
  assert.equal(ready.outcome, "ready", failedChecks(ready));

  const configuredOnly = await probeServer({
    environment: {},
    fetchImpl: fakeFetch(healthBody("configured", "ready"))
  });
  assert.equal(configuredOnly.outcome, "not_ready");
  assert.equal(statusOf(configuredOnly, "stt"), "fail");
});

test("server probe distinguishes an unavailable process from a failed readiness contract", async () => {
  const unavailable = await probeServer({
    environment: { JIKO_PROBE_ATTEMPTS: "1" },
    fetchImpl: async () => {
      throw new Error("connection refused");
    }
  });
  assert.equal(unavailable.outcome, "unavailable");

  const invalid = await probeServer({
    environment: {},
    fetchImpl: async () => new Response("not json", { status: 200 })
  });
  assert.equal(invalid.outcome, "not_ready");
});

test("web probe validates the built shell and refuses remote probe targets", async () => {
  const ready = await probeWeb({
    environment: {},
    fetchImpl: async () => new Response('<!doctype html><div id="root"></div>', { status: 200 })
  });
  assert.equal(ready.outcome, "ready", failedChecks(ready));

  const remote = await probeWeb({
    url: "http://example.com/",
    environment: {},
    fetchImpl: async () => {
      throw new Error("remote fetch must not run");
    }
  });
  assert.equal(remote.outcome, "not_ready");
  assert.equal(statusOf(remote, "probe-url"), "fail");
});

test("built server accepts SIGTERM and exits cleanly inside the systemd stop bound", async (context) => {
  const port = await availablePort();
  const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: path.resolve(import.meta.dirname, "../../.."),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      STT_PROVIDER: "",
      TTS_PROVIDER: "",
      JIKO_WRITE_RECEIPTS: "0",
      TTS_PLAY_AUDIO: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });

  // This test measures the bounded SIGTERM path, not cold-start latency. Give
  // an overloaded shared development host enough time to schedule the child;
  // target startup/readiness latency is a separate HIL gate.
  await waitForHttp(`http://127.0.0.1:${port}/health`, 20_000);
  const stoppedAt = Date.now();
  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");

  assert.equal(code, 0, `server exit failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.equal(signal, null);
  assert.ok(Date.now() - stoppedAt < 10_000, "server exceeded systemd TimeoutStopSec");
});

async function serverFixture(context, options = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "jiko-runtime-"));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));

  const installRoot = path.join(temporaryRoot, "release");
  const stateRoot = path.join(temporaryRoot, "state");
  const serverRoot = path.join(installRoot, "apps/server");
  const receiptState = path.join(stateRoot, "sessions");
  const clips = path.join(installRoot, "clips");
  const executable = path.join(temporaryRoot, "tool");
  const environmentFile = path.join(temporaryRoot, "server.env");

  await Promise.all([
    mkdir(path.join(serverRoot, "dist"), { recursive: true }),
    mkdir(receiptState, { recursive: true }),
    mkdir(clips, { recursive: true })
  ]);
  await writeFile(path.join(serverRoot, "dist/index.js"), "// fixture\n");
  await writeFile(executable, "#!/bin/sh\nexit 0\n");
  await chmod(executable, 0o755);
  await writeFile(environmentFile, "STT_PROVIDER=funasr\n", { mode: 0o640 });

  if (options.receiptDirectoryInsteadOfLink) {
    await mkdir(path.join(serverRoot, "sessions"));
  } else {
    await symlink(receiptState, path.join(serverRoot, "sessions"));
  }

  return {
    environment: {
      JIKO_DEPLOYMENT_SCHEMA: "jiko_systemd_v1",
      JIKO_INSTALL_ROOT: installRoot,
      JIKO_STATE_DIR: stateRoot,
      JIKO_ENV_FILE: environmentFile,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "4317",
      JIKO_WRITE_RECEIPTS: "1",
      JIKO_READY_REQUIRE_STT: "1",
      JIKO_READY_REQUIRE_TTS: "1",
      FFMPEG_BIN: executable,
      STT_PROVIDER: "funasr",
      FUNASR_ENDPOINT: "http://127.0.0.1:10095",
      TTS_PROVIDER: "clip",
      TTS_CLIP_DIR: clips,
      TTS_PLAY_AUDIO: "0"
    }
  };
}

function healthBody(sttStatus, ttsStatus) {
  return {
    ok: true,
    service: "@jiko/server",
    mode: "local",
    receiptsEnabled: true,
    diagnostics: {
      runtime: {
        ffmpeg: { status: "ready", id: "/usr/bin/ffmpeg" }
      },
      providers: {
        stt: { status: sttStatus, id: "local:test-stt" },
        tts: { status: ttsStatus, id: "local:test-tts" }
      }
    }
  };
}

function fakeFetch(body) {
  return async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function statusOf(result, id) {
  return result.checks.find((entry) => entry.id === id)?.status;
}

function failedChecks(result) {
  return result.checks
    .filter((entry) => entry.status === "fail")
    .map((entry) => `${entry.id}: ${entry.detail}`)
    .join("\n");
}

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForHttp(url, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}
