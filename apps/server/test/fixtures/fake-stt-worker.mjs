import readline from "node:readline";

const mode = process.argv[2] || "ready";
let requestCount = 0;

const ready = {
  type: "ready",
  protocolVersion: 1,
  providerId: process.env.FAKE_STT_PROVIDER_ID || "local:test-persistent-stt",
  runtime: {
    name: "fake-stt",
    version: "1.0.0-test"
  },
  artifacts: {
    model: {
      name: "fake-model.onnx",
      sha256: "a".repeat(64),
      bytes: 123
    },
    tokens: {
      name: "fake-tokens.txt",
      sha256: "b".repeat(64),
      bytes: 45
    }
  },
  configuration: {
    language: "auto",
    threads: 1,
    executionProvider: "cpu",
    useItn: false
  },
  loadMs: 2.5,
  workerPid: process.pid
};

if (mode === "invalid-readiness") {
  delete ready.artifacts.model.sha256;
}

process.stdout.write(`${JSON.stringify(ready)}\n`);

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "shutdown") {
    process.exit(0);
  }

  requestCount += 1;
  if (request.audioPath === "hang.wav") {
    return;
  }

  if (request.audioPath === "crash.wav") {
    process.stderr.write("fake worker crash\n");
    process.exit(17);
  }

  process.stdout.write(`${JSON.stringify({
    type: "transcript",
    requestId: request.requestId,
    text: process.env.FAKE_STT_TRANSCRIPT ?? `fake transcript ${requestCount}`,
    language: process.env.FAKE_STT_LANGUAGE ?? "en",
    latencyMs: requestCount
  })}\n`);
});
