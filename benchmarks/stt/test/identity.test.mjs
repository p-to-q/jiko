import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertLoopbackEndpoint,
  configurationIdentity,
  verifyFunasrIdentityManifest
} from "../identity.mjs";
import { sha256 } from "../receipt.mjs";

test("FunASR accepts only credential-free loopback HTTP endpoints", () => {
  assert.equal(
    assertLoopbackEndpoint("http://127.0.0.1:8000/v1/audio/transcriptions"),
    "http://127.0.0.1:8000/v1/audio/transcriptions"
  );
  assert.equal(
    assertLoopbackEndpoint("http://localhost:8000/v1/audio/transcriptions"),
    "http://localhost:8000/v1/audio/transcriptions"
  );
  assert.equal(
    assertLoopbackEndpoint("http://[::1]:8000/v1/audio/transcriptions"),
    "http://[::1]:8000/v1/audio/transcriptions"
  );

  for (const endpoint of [
    "https://api.example.com/v1/audio/transcriptions",
    "http://user:secret@127.0.0.1:8000/transcribe",
    "file:///tmp/funasr.sock",
    "http://127.0.0.1:8000/transcribe#remote"
  ]) {
    assert.throws(() => assertLoopbackEndpoint(endpoint), /loopback/);
  }
});

test("FunASR identity rejects ambiguous duplicate artifact role/name pairs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-funasr-identity-"));
  try {
    const runtimePath = path.join(directory, "runtime.bin");
    const modelPath = path.join(directory, "model.bin");
    await writeFile(runtimePath, "runtime");
    await writeFile(modelPath, "model");
    const runtime = await artifact("runtime", runtimePath);
    const model = await artifact("model", modelPath);
    const manifestPath = path.join(directory, "identity.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "stt_provider_identity_v1",
        providerId: "self-hosted:funasr-http:loopback",
        runtime: "funasr@test",
        configurationId: configurationIdentity("funasr-test", {
          model: "sensevoice",
          language: "auto"
        }).configurationId,
        artifacts: [runtime, runtime, model]
      })
    );

    await assert.rejects(
      verifyFunasrIdentityManifest(manifestPath, directory),
      /role\/name pairs must be unique/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function artifact(role, filePath) {
  const bytes = await readFile(filePath);
  return {
    role,
    name: path.basename(filePath),
    path: path.basename(filePath),
    sha256: sha256(bytes),
    bytes: bytes.byteLength
  };
}
