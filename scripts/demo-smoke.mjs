import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const port = process.env.PORT ?? "4397";
const baseUrl = `http://localhost:${port}`;

await main();

async function main() {
  ensureBuiltServer();
  ensureFfmpeg();

  const server = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: port,
      JIKO_WRITE_RECEIPTS: "0",
      STT_PROVIDER: process.env.STT_PROVIDER ?? "",
      TTS_PROVIDER: process.env.TTS_PROVIDER ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await waitForHealth();
    await smokeManualTranscript();
    await smokeAudioUpload();
    console.log("demo smoke passed");
  } catch (error) {
    console.error("demo smoke failed");
    console.error(error instanceof Error ? error.message : error);
    if (serverOutput.trim()) {
      console.error("");
      console.error(serverOutput.trim());
    }
    process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => undefined);
  }
}

function ensureBuiltServer() {
  const result = spawnSync("pnpm", ["--filter", "@jiko/server", "build"], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("Unable to build @jiko/server.");
  }
}

function ensureFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], {
    cwd: root,
    stdio: "ignore",
  });

  if (result.status !== 0) {
    throw new Error("ffmpeg is required for audio smoke testing.");
  }
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await sleep(100);
    }
  }

  throw new Error(`Server did not become healthy at ${baseUrl}/health.`);
}

async function smokeManualTranscript() {
  const sessionId = "smoke-manual";
  await createSession(sessionId);

  const response = await fetch(`${baseUrl}/sessions/${sessionId}/manual-transcript`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transcript: "我在考虑辞职，但还想先把这件事说清楚。",
      language: "zh",
    }),
  });

  const payload = await readJson(response);
  assertOk(response, payload, "manual transcript");
  assertSessionResult(payload, "manual transcript");
}

async function smokeAudioUpload() {
  const sessionId = "smoke-audio";
  const tempDir = await mkdtemp(path.join(tmpdir(), "jiko-demo-smoke-"));
  const wavPath = path.join(tempDir, "tone.wav");

  try {
    const ffmpeg = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1.2",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        wavPath,
      ],
      { cwd: root, stdio: "inherit" },
    );

    if (ffmpeg.status !== 0) {
      throw new Error("Unable to generate synthetic smoke WAV.");
    }

    await createSession(sessionId);
    const audio = await readFile(wavPath);
    const response = await fetch(`${baseUrl}/sessions/${sessionId}/audio?durationMs=1200`, {
      method: "POST",
      headers: {
        "content-type": "audio/wav",
      },
      body: audio,
    });

    const payload = await readJson(response);
    assertOk(response, payload, "audio upload");
    assertSessionResult(payload, "audio upload");

    const session = payload?.session;
    if (!session?.normalizedAudio || session.normalizedAudio.sampleRateHz !== 16000) {
      throw new Error("Audio smoke did not produce 16 kHz normalized audio.");
    }

    if (!session?.features || typeof session.features.rmsMean !== "number") {
      throw new Error("Audio smoke did not produce RMS features.");
    }

    if (typeof session.features.pitchMeanHz !== "number") {
      throw new Error("Audio smoke did not produce pitch features.");
    }

    if (!session?.transcript?.provider?.includes("unavailable")) {
      throw new Error("Audio smoke should record local STT unavailable when no provider is configured.");
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createSession(sessionId) {
  const response = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sessionId,
      source: "manual",
    }),
  });
  const payload = await readJson(response);
  assertOk(response, payload, "create session");
}

function assertSessionResult(payload, label) {
  const session = payload?.session;

  if (!session?.result) {
    throw new Error(`${label} did not produce a session result.`);
  }

  if (!Array.isArray(session.readings) || session.readings.length !== 3) {
    throw new Error(`${label} did not produce three readings.`);
  }

  const resultEvent = session.events?.find?.((event) => event.type === "session.result");
  if (!resultEvent) {
    throw new Error(`${label} did not emit session.result.`);
  }
}

function assertOk(response, payload, label) {
  if (response.ok) {
    return;
  }

  throw new Error(`${label} failed with ${response.status}: ${JSON.stringify(payload)}`);
}

async function readJson(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
