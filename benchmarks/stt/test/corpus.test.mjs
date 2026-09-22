import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  inspectCanonicalWav,
  validateSttCorpusManifest,
  verifySttCorpusManifest
} from "../corpus.mjs";
import { sha256 } from "../receipt.mjs";

test("verifies manifest schema, audio identity, path containment, and WAV format", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-stt-corpus-"));
  try {
    const wav = silentWav(100);
    await writeFile(path.join(directory, "case.wav"), wav);
    const manifest = validManifest(wav);
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const verified = await verifySttCorpusManifest(manifestPath);

    assert.equal(verified.cases.length, 1);
    assert.equal(verified.cases[0].audioDurationMs, 100);

    manifest.cases[0].audio.sha256 = "0".repeat(64);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifySttCorpusManifest(manifestPath),
      /audio identity mismatch/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects escaped corpus audio even when the symlink resolves to a valid WAV", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-stt-corpus-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "jiko-stt-corpus-outside-"));
  try {
    const wav = silentWav(100);
    await writeFile(path.join(outside, "outside.wav"), wav);
    await symlink(path.join(outside, "outside.wav"), path.join(directory, "linked.wav"));
    const manifest = validManifest(wav);
    manifest.cases[0].audio.path = "linked.wav";
    const manifestPath = path.join(directory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    await assert.rejects(
      verifySttCorpusManifest(manifestPath),
      /escapes the manifest directory/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("corpus semantics reject false silence, missing keywords, and fake code-switch labels", () => {
  const wav = silentWav(100);
  const silence = validManifest(wav);
  silence.cases[0].language = "silence";
  const missingKeyword = validManifest(wav);
  missingKeyword.cases[0].keywords = ["absent"];
  const fakeSwitch = validManifest(wav);
  fakeSwitch.cases[0].language = "code_switch";

  assert.equal(validateSttCorpusManifest(silence).ok, false);
  assert.equal(validateSttCorpusManifest(missingKeyword).ok, false);
  assert.equal(validateSttCorpusManifest(fakeSwitch).ok, false);
});

test("canonical WAV validation rejects a false RIFF byte count", () => {
  const wav = silentWav(100);
  wav.writeUInt32LE(wav.readUInt32LE(4) - 2, 4);

  assert.throws(() => inspectCanonicalWav(wav), /RIFF size/);
});

function validManifest(wav) {
  return {
    schemaVersion: "stt_corpus_manifest_v1",
    manifestId: "synthetic-test-v1",
    provenance: {
      class: "synthetic",
      description: "Generated unit-test silence with synthetic reference text.",
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
          path: "case.wav",
          sha256: sha256(wav),
          bytes: wav.byteLength
        },
        reference: "hello world",
        keywords: ["hello"],
        slices: ["synthetic"]
      }
    ]
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
