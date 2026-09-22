import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configurationIdentity } from "../identity.mjs";
import { sha256 } from "../receipt.mjs";
import { runMeasuredSttBenchmark } from "../runner.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

test("an unconfigured host remains not_evaluated without loading a model", async () => {
  const { receipt } = await runMeasuredSttBenchmark({
    configPath: path.join(
      repositoryRoot,
      "benchmarks/stt/config/host-unconfigured-v1.json"
    ),
    repositoryRoot,
    writeReceipt: false
  });

  assert.equal(receipt.corpus.availability, "unavailable");
  assert.equal(receipt.qualification.evidenceLevel, "not_evaluated");
  assert.equal(receipt.qualification.verdict, "not_evaluated");
  assert.ok(receipt.candidates.every((candidate) => candidate.availability === "unavailable"));
});

test("SenseVoice, whisper.cpp, and loopback FunASR run the same verified corpus", async () => {
  const fixture = await createFixture();
  const funasr = await startFakeFunasr();
  try {
    const config = await measuredConfig(fixture, funasr.endpoint);
    await writeFile(fixture.configPath, JSON.stringify(config));

    const { receipt } = await runMeasuredSttBenchmark({
      configPath: fixture.configPath,
      repositoryRoot,
      writeReceipt: false
    });

    assert.deepEqual(receipt.corpus.caseIds, ["en-001"]);
    assert.equal(receipt.qualification.evidenceLevel, "host_measured");
    assert.equal(receipt.qualification.verdict, "not_evaluated");
    assert.equal(receipt.qualification.thresholdsLocked, false);
    assert.deepEqual(
      receipt.candidates.map((candidate) => [candidate.family, candidate.availability]),
      [
        ["sensevoice", "measured"],
        ["whisper_cpp", "measured"],
        ["funasr", "measured"]
      ]
    );
    for (const candidate of receipt.candidates) {
      assert.equal(candidate.metrics.wer, 0);
      assert.equal(candidate.metrics.keywordPreservationRate, 1);
      assert.equal(candidate.cases[0].outcome, "completed");
      assert.deepEqual(candidate.cases[0].slices, ["synthetic", "adapter_contract"]);
      assert.equal(candidate.cases[0].referenceSha256, sha256("hello world"));
      assert.equal(candidate.cases[0].audioSha256, sha256(fixture.wav));
      assert.equal(candidate.cases[0].hypothesisSha256, sha256("hello world"));
    }
    assert.equal(receipt.measurement.rawTranscriptStored, false);
    assert.equal(JSON.stringify(receipt).includes("hello world"), false);
    assert.equal((await readFile(fixture.whisperMarker, "utf8")).trim(), "run");
    assert.equal(funasr.requests, 1);
  } finally {
    await funasr.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("a mismatched model hash is unavailable and never executes the runtime", async () => {
  const fixture = await createFixture();
  try {
    const config = await measuredConfig(fixture, "http://127.0.0.1:1/v1/audio/transcriptions");
    config.candidates = [config.candidates.find((candidate) => candidate.family === "whisper_cpp")];
    config.candidates[0].settings.artifacts.model.sha256 = "0".repeat(64);
    await writeFile(fixture.configPath, JSON.stringify(config));

    const { receipt } = await runMeasuredSttBenchmark({
      configPath: fixture.configPath,
      repositoryRoot,
      writeReceipt: false
    });

    assert.equal(receipt.candidates[0].availability, "unavailable");
    assert.equal(receipt.candidates[0].identity, null);
    assert.equal(receipt.qualification.evidenceLevel, "not_evaluated");
    await assert.rejects(readFile(fixture.whisperMarker), /ENOENT/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-stt-runner-"));
  const audioPath = path.join(directory, "case.wav");
  const manifestPath = path.join(directory, "corpus.json");
  const configPath = path.join(directory, "config.json");
  const whisperRuntime = path.join(directory, "fake-whisper.mjs");
  const whisperMarker = path.join(directory, "whisper-ran.txt");
  const whisperModel = path.join(directory, "whisper-model.bin");
  const senseVoiceWorker = path.join(directory, "fake-sensevoice-worker.mjs");
  const senseVoiceModel = path.join(directory, "sensevoice-model.onnx");
  const senseVoiceTokens = path.join(directory, "tokens.txt");
  const funasrRuntime = path.join(directory, "funasr-runtime.txt");
  const funasrModel = path.join(directory, "funasr-model.bin");
  const funasrIdentity = path.join(directory, "funasr-identity.json");

  const wav = silentWav(100);
  await writeFile(audioPath, wav);
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: "stt_corpus_manifest_v1",
      manifestId: "synthetic-adapter-contract-v1",
      provenance: {
        class: "synthetic",
        description: "Generated unit-test WAV for adapter contract verification only.",
        redistribution: "allowed"
      },
      audioSpec: {
        mediaType: "audio/wav",
        sampleRateHz: 16000,
        channelCount: 1,
        sampleFormat: "pcm_s16le"
      },
      cases: [
        {
          id: "en-001",
          language: "en",
          audio: {
            path: path.basename(audioPath),
            sha256: sha256(wav),
            bytes: wav.byteLength
          },
          reference: "hello world",
          keywords: ["hello", "world"],
          slices: ["synthetic", "adapter_contract"]
        }
      ]
    })
  );
  await writeFile(
    whisperRuntime,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(whisperMarker)}, 'run\\n');`,
      "process.stdout.write('hello world\\n');"
    ].join("\n")
  );
  await chmod(whisperRuntime, 0o755);
  await writeFile(whisperModel, "fake whisper model");
  await writeFile(senseVoiceWorker, fakeSenseVoiceWorkerSource());
  await writeFile(senseVoiceModel, "fake sensevoice model");
  await writeFile(senseVoiceTokens, "<blank>\nhello\nworld\n");
  await writeFile(funasrRuntime, "fake local FunASR runtime");
  await writeFile(funasrModel, "fake FunASR model");

  return {
    directory,
    wav,
    audioPath,
    manifestPath,
    configPath,
    whisperRuntime,
    whisperMarker,
    whisperModel,
    senseVoiceWorker,
    senseVoiceModel,
    senseVoiceTokens,
    funasrRuntime,
    funasrModel,
    funasrIdentity
  };
}

async function measuredConfig(fixture, funasrEndpoint) {
  const sensevoiceId = "sensevoice-test";
  const whisperId = "whisper-test";
  const funasrId = "funasr-test";
  const funasrConfiguration = configurationIdentity(funasrId, {
    model: "sensevoice-test",
    language: "auto"
  });
  await writeFile(
    fixture.funasrIdentity,
    JSON.stringify({
      schemaVersion: "stt_provider_identity_v1",
      providerId: "self-hosted:funasr-http:loopback",
      runtime: "fake-funasr@1.0-test",
      configurationId: funasrConfiguration.configurationId,
      artifacts: [
        await manifestArtifact("runtime", fixture.funasrRuntime),
        await manifestArtifact("model", fixture.funasrModel)
      ]
    })
  );

  return {
    schemaVersion: "stt_benchmark_config_v1",
    profileId: "synthetic-adapter-contract",
    environmentKind: "host",
    corpusManifestPath: path.basename(fixture.manifestPath),
    warmupIterations: 0,
    measuredIterations: 1,
    candidates: [
      {
        id: sensevoiceId,
        family: "sensevoice",
        settings: {
          artifacts: {
            python: await configArtifact(process.execPath),
            worker: await configArtifact(fixture.senseVoiceWorker),
            model: await configArtifact(fixture.senseVoiceModel),
            tokens: await configArtifact(fixture.senseVoiceTokens)
          },
          language: "auto",
          threads: 1,
          executionProvider: "cpu",
          useItn: false,
          timeoutMs: 10000
        }
      },
      {
        id: whisperId,
        family: "whisper_cpp",
        settings: {
          artifacts: {
            runtime: await configArtifact(fixture.whisperRuntime),
            model: await configArtifact(fixture.whisperModel)
          },
          language: "en",
          timeoutMs: 10000
        }
      },
      {
        id: funasrId,
        family: "funasr",
        settings: {
          endpoint: funasrEndpoint,
          model: "sensevoice-test",
          language: "auto",
          identityManifestPath: path.basename(fixture.funasrIdentity),
          timeoutMs: 10000
        }
      }
    ]
  };
}

async function configArtifact(filePath) {
  const bytes = await readFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    sha256: sha256(bytes),
    bytes: bytes.byteLength
  };
}

async function manifestArtifact(role, filePath) {
  const artifact = await configArtifact(filePath);
  return { role, ...artifact, path: path.basename(filePath) };
}

function fakeSenseVoiceWorkerSource() {
  return [
    "import { createHash } from 'node:crypto';",
    "import { readFileSync } from 'node:fs';",
    "import readline from 'node:readline';",
    "const argument = (name) => process.argv[process.argv.indexOf(name) + 1];",
    "const identity = (filePath) => {",
    "  const bytes = readFileSync(filePath);",
    "  return { name: filePath.split('/').at(-1), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };",
    "};",
    "const model = argument('--model');",
    "const tokens = argument('--tokens');",
    "process.stdout.write(`${JSON.stringify({",
    "  type: 'ready', protocolVersion: 1, providerId: 'local:sherpa-onnx-sensevoice',",
    "  runtime: { name: 'fake-sensevoice', version: '1.0-test' },",
    "  artifacts: { model: identity(model), tokens: identity(tokens) },",
    "  configuration: { language: argument('--language'), threads: Number(argument('--threads')), executionProvider: argument('--provider'), useItn: process.argv.includes('--use-itn') },",
    "  loadMs: 1, workerPid: process.pid",
    "})}\\n`);",
    "const lines = readline.createInterface({ input: process.stdin });",
    "lines.on('line', (line) => {",
    "  const request = JSON.parse(line);",
    "  if (request.type === 'shutdown') process.exit(0);",
    "  process.stdout.write(`${JSON.stringify({ type: 'transcript', requestId: request.requestId, text: 'hello world', language: 'en', latencyMs: 1 })}\\n`);",
    "});"
  ].join("\n");
}

async function startFakeFunasr() {
  let requests = 0;
  const server = createServer((request, response) => {
    request.on("data", () => undefined);
    request.on("end", () => {
      requests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ text: "hello world" }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/audio/transcriptions`,
    get requests() {
      return requests;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

function silentWav(durationMs) {
  const samples = Math.round((durationMs / 1000) * 16000);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}
