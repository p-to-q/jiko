import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { evaluateTranscript, languageRuns, unitsForLanguage } from "./metrics.mjs";

const sttDirectory = path.dirname(fileURLToPath(import.meta.url));
export const sttCorpusSchemaPath = path.join(
  sttDirectory,
  "schema",
  "stt-corpus-manifest-v1.schema.json"
);
export const canonicalAudioSpec = Object.freeze({
  mediaType: "audio/wav",
  sampleRateHz: 16000,
  channelCount: 1,
  sampleFormat: "pcm_s16le"
});

const schema = JSON.parse(readFileSync(sttCorpusSchemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

export function validateSttCorpusManifest(manifest) {
  const issues = [];
  if (!validateSchema(manifest)) {
    for (const error of validateSchema.errors ?? []) {
      issues.push({
        path: error.instancePath || "/",
        message: `schema: ${error.message ?? "invalid value"}`
      });
    }
  }

  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.cases)) {
    return { ok: issues.length === 0, issues };
  }

  const ids = new Set();
  for (const [index, corpusCase] of manifest.cases.entries()) {
    const pointer = `/cases/${index}`;
    if (!corpusCase || typeof corpusCase !== "object") {
      continue;
    }
    if (ids.has(corpusCase.id)) {
      issues.push({ path: `${pointer}/id`, message: "must be unique" });
    }
    ids.add(corpusCase.id);

    const referenceUnits = unitsForLanguage(
      corpusCase.reference,
      corpusCase.language === "silence" ? "en" : corpusCase.language
    );
    if (corpusCase.language === "silence") {
      if (referenceUnits.length !== 0 || corpusCase.keywords?.length !== 0) {
        issues.push({
          path: pointer,
          message: "silence cases require an empty reference and no keywords"
        });
      }
    } else if (referenceUnits.length === 0) {
      issues.push({ path: `${pointer}/reference`, message: "must contain reference units" });
    }

    if (
      corpusCase.language === "code_switch" &&
      languageRuns(referenceUnits).length < 2
    ) {
      issues.push({
        path: `${pointer}/reference`,
        message: "code_switch reference must contain at least two language runs"
      });
    }

    if (Array.isArray(corpusCase.keywords)) {
      const evaluated = evaluateTranscript({
        language: corpusCase.language,
        reference: corpusCase.reference,
        hypothesis: corpusCase.reference,
        keywords: corpusCase.keywords
      });
      if (evaluated.keywordHits !== evaluated.keywordTotal) {
        issues.push({
          path: `${pointer}/keywords`,
          message: "every keyword must occur in its case reference after normalization"
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

export async function verifySttCorpusManifest(manifestPath) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestBytes = await readFile(absoluteManifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const validation = validateSttCorpusManifest(manifest);
  if (!validation.ok) {
    throw new Error(formatIssues("Invalid stt_corpus_manifest_v1", validation.issues));
  }

  const manifestDirectory = await realpath(path.dirname(absoluteManifestPath));
  const cases = [];
  for (const corpusCase of manifest.cases) {
    const audioPath = await resolveCorpusAudioPath(
      manifestDirectory,
      corpusCase.audio.path
    );
    const metadata = await stat(audioPath);
    if (!metadata.isFile()) {
      throw new Error(`Corpus audio is not a regular file: ${corpusCase.id}`);
    }
    const audioBytes = await readFile(audioPath);
    if (
      audioBytes.byteLength !== corpusCase.audio.bytes ||
      sha256(audioBytes) !== corpusCase.audio.sha256
    ) {
      throw new Error(`Corpus audio identity mismatch: ${corpusCase.id}`);
    }
    const wav = inspectCanonicalWav(audioBytes);
    cases.push({
      ...corpusCase,
      audioPath,
      audioDurationMs: wav.durationMs
    });
  }

  return {
    manifest,
    manifestPath: absoluteManifestPath,
    manifestSha256: sha256(manifestBytes),
    cases
  };
}

export function inspectCanonicalWav(bytes) {
  if (
    bytes.byteLength < 44 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("Corpus audio must be a RIFF/WAVE file");
  }
  if (bytes.readUInt32LE(4) + 8 !== bytes.byteLength) {
    throw new Error("Corpus WAV RIFF size does not match the file bytes");
  }

  let offset = 12;
  let format;
  let dataBytes;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = bytes.toString("ascii", offset, offset + 4);
    const chunkBytes = bytes.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    if (contentOffset + chunkBytes > bytes.byteLength) {
      throw new Error("Corpus WAV contains a truncated chunk");
    }
    if (chunkId === "fmt ") {
      if (format) {
        throw new Error("Corpus WAV contains duplicate fmt chunks");
      }
      if (chunkBytes < 16) {
        throw new Error("Corpus WAV fmt chunk is too short");
      }
      format = {
        audioFormat: bytes.readUInt16LE(contentOffset),
        channelCount: bytes.readUInt16LE(contentOffset + 2),
        sampleRateHz: bytes.readUInt32LE(contentOffset + 4),
        byteRate: bytes.readUInt32LE(contentOffset + 8),
        blockAlign: bytes.readUInt16LE(contentOffset + 12),
        bitsPerSample: bytes.readUInt16LE(contentOffset + 14)
      };
    } else if (chunkId === "data") {
      if (dataBytes !== undefined) {
        throw new Error("Corpus WAV contains duplicate data chunks");
      }
      dataBytes = chunkBytes;
    }
    offset = contentOffset + chunkBytes + (chunkBytes % 2);
  }

  if (!format || dataBytes === undefined) {
    throw new Error("Corpus WAV requires fmt and data chunks");
  }
  if (
    format.audioFormat !== 1 ||
    format.channelCount !== 1 ||
    format.sampleRateHz !== 16000 ||
    format.bitsPerSample !== 16 ||
    format.blockAlign !== 2 ||
    format.byteRate !== 32000 ||
    dataBytes < 2 ||
    dataBytes % format.blockAlign !== 0
  ) {
    throw new Error("Corpus WAV must be mono 16 kHz PCM s16le with non-empty frames");
  }

  return {
    durationMs: (dataBytes / format.blockAlign / format.sampleRateHz) * 1000
  };
}

async function resolveCorpusAudioPath(manifestDirectory, requestedPath) {
  if (
    typeof requestedPath !== "string" ||
    path.isAbsolute(requestedPath) ||
    requestedPath.includes("\\") ||
    requestedPath.split("/").includes("..")
  ) {
    throw new Error("Corpus audio paths must stay below the manifest directory");
  }
  const resolved = await realpath(path.resolve(manifestDirectory, requestedPath));
  const relative = path.relative(manifestDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Corpus audio path escapes the manifest directory");
  }
  return resolved;
}

function formatIssues(prefix, issues) {
  return `${prefix}:\n${issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("\n")}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
