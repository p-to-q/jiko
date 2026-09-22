import { readFile, realpath, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { sha256 } from "./receipt.mjs";

const sttDirectory = path.dirname(fileURLToPath(import.meta.url));
const providerIdentitySchema = JSON.parse(
  readFileSync(
    path.join(sttDirectory, "schema", "stt-provider-identity-v1.schema.json"),
    "utf8"
  )
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateProviderIdentitySchema = ajv.compile(providerIdentitySchema);

export async function verifyConfiguredArtifact(descriptor, role, configDirectory) {
  if (
    !descriptor ||
    typeof descriptor.path !== "string" ||
    !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
    !Number.isInteger(descriptor.bytes) ||
    descriptor.bytes < 1
  ) {
    throw new Error(`missing frozen ${role} artifact identity`);
  }
  const requestedPath = path.isAbsolute(descriptor.path)
    ? descriptor.path
    : path.resolve(configDirectory, descriptor.path);
  const filePath = await realpath(requestedPath);
  const metadata = await stat(filePath);
  if (!metadata.isFile()) {
    throw new Error(`${role} artifact is not a regular file`);
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) {
    throw new Error(`${role} artifact identity mismatch`);
  }
  return {
    filePath,
    receipt: {
      role,
      name: descriptor.name || path.basename(filePath),
      sha256: descriptor.sha256,
      bytes: descriptor.bytes
    }
  };
}

export function configurationIdentity(candidateId, value) {
  const bytes = Buffer.from(stableStringify(value), "utf8");
  return {
    configurationId: sha256(bytes),
    artifact: {
      role: "configuration",
      name: `${candidateId}.configuration.json`,
      sha256: sha256(bytes),
      bytes: bytes.byteLength
    }
  };
}

export async function verifyFunasrIdentityManifest(manifestPath, configDirectory) {
  const requestedPath = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.resolve(configDirectory, manifestPath);
  const absoluteManifestPath = await realpath(requestedPath);
  const manifestBytes = await readFile(absoluteManifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (!validateProviderIdentitySchema(manifest)) {
    const detail = (validateProviderIdentitySchema.errors ?? [])
      .map((error) => `${error.instancePath || "/"}: ${error.message}`)
      .join("; ");
    throw new Error(`invalid FunASR identity manifest: ${detail}`);
  }

  const manifestDirectory = await realpath(path.dirname(absoluteManifestPath));
  const artifacts = [];
  const roles = new Set();
  const artifactKeys = new Set();
  for (const artifact of manifest.artifacts) {
    const verified = await verifyManifestArtifact(
      artifact,
      manifestDirectory
    );
    const artifactKey = `${verified.role}:${verified.name}`;
    if (artifactKeys.has(artifactKey)) {
      throw new Error("FunASR identity artifact role/name pairs must be unique");
    }
    artifactKeys.add(artifactKey);
    artifacts.push(verified);
    roles.add(verified.role);
  }
  if (!roles.has("runtime") || !roles.has("model")) {
    throw new Error("FunASR identity manifest requires runtime and model artifacts");
  }
  artifacts.push({
    role: "identity_manifest",
    name: path.basename(absoluteManifestPath),
    sha256: sha256(manifestBytes),
    bytes: manifestBytes.byteLength
  });

  return {
    providerId: manifest.providerId,
    runtime: manifest.runtime,
    configurationId: manifest.configurationId,
    artifacts
  };
}

export function assertLoopbackEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("FunASR endpoint must be a valid loopback URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  if (
    !loopback ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("FunASR endpoint must be credential-free HTTP(S) on loopback");
  }
  return url.toString();
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function verifyManifestArtifact(artifact, manifestDirectory) {
  if (
    path.isAbsolute(artifact.path) ||
    artifact.path.includes("\\") ||
    artifact.path.split("/").includes("..")
  ) {
    throw new Error("FunASR identity artifact paths must stay below the manifest directory");
  }
  const filePath = await realpath(path.resolve(manifestDirectory, artifact.path));
  const relative = path.relative(manifestDirectory, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("FunASR identity artifact escapes the manifest directory");
  }
  const metadata = await stat(filePath);
  if (!metadata.isFile()) {
    throw new Error("FunASR identity artifact is not a regular file");
  }
  const bytes = await readFile(filePath);
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
    throw new Error(`FunASR ${artifact.role} artifact identity mismatch`);
  }
  return {
    role: artifact.role,
    name: artifact.name,
    sha256: artifact.sha256,
    bytes: artifact.bytes
  };
}
