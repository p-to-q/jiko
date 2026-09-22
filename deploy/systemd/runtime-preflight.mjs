#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const deploymentSchemaVersion = "jiko_systemd_v1";

const localSttProviders = new Set([
  "sherpa-onnx",
  "sherpa",
  "sensevoice",
  "whisper.cpp",
  "whisper_cpp",
  "whisper-cpp",
  "funasr"
]);
const localTtsProviders = new Set(["clip", "clips", "local-clip", "piper"]);

export async function inspectRuntime(target, environment = process.env) {
  const checks = [];
  const check = (id, passed, detail) => {
    checks.push({ id, status: passed ? "pass" : "fail", detail });
  };

  check(
    "deployment-schema",
    environment.JIKO_DEPLOYMENT_SCHEMA === deploymentSchemaVersion,
    environment.JIKO_DEPLOYMENT_SCHEMA === deploymentSchemaVersion
      ? deploymentSchemaVersion
      : `Expected ${deploymentSchemaVersion}.`
  );

  const installRoot = environment.JIKO_INSTALL_ROOT || "/opt/jiko/current";
  const stateRoot = environment.JIKO_STATE_DIR || "/var/lib/jiko";
  const environmentFile = environment.JIKO_ENV_FILE;

  check("install-root-absolute", path.isAbsolute(installRoot), "Install root must be absolute.");
  check("state-root-absolute", path.isAbsolute(stateRoot), "State root must be absolute.");

  if (environmentFile) {
    await inspectEnvironmentFile(environmentFile, check);
  } else {
    check("environment-file", false, "JIKO_ENV_FILE must name the systemd EnvironmentFile.");
  }

  if (target === "server") {
    await inspectServer(installRoot, stateRoot, environment, check);
  } else if (target === "web") {
    await inspectWeb(installRoot, check);
  } else if (target === "device") {
    await inspectDevice(installRoot, stateRoot, environment, check);
  } else {
    check("target", false, `Unsupported runtime target: ${target || "(missing)"}.`);
  }

  return {
    schemaVersion: deploymentSchemaVersion,
    target,
    outcome: checks.every((entry) => entry.status === "pass") ? "ready" : "not_ready",
    checks
  };
}

async function inspectEnvironmentFile(filePath, check) {
  if (!path.isAbsolute(filePath)) {
    check("environment-file", false, "Environment file path must be absolute.");
    return;
  }

  try {
    const metadata = await stat(filePath);
    check("environment-file", metadata.isFile(), "Environment file must be a regular file.");
    check(
      "environment-file-mode",
      (metadata.mode & 0o022) === 0,
      "Environment file must not be writable by group or other users."
    );
  } catch (error) {
    check("environment-file", false, `Environment file is unavailable: ${shortReason(error)}`);
  }
}

async function inspectServer(installRoot, stateRoot, environment, check) {
  await inspectRegularFile(
    path.join(installRoot, "apps/server/dist/index.js"),
    "server-artifact",
    check
  );

  check(
    "node-environment",
    environment.NODE_ENV === "production",
    "NODE_ENV must be production."
  );
  check(
    "loopback-bind",
    isLoopbackHost(environment.HOST || ""),
    "The unauthenticated server must bind only to loopback."
  );
  check(
    "port",
    isPort(environment.PORT),
    "PORT must be an integer from 1 through 65535."
  );
  check(
    "receipts-enabled",
    parseBoolean(environment.JIKO_WRITE_RECEIPTS) === true,
    "The supervised profile requires canonical receipt persistence."
  );

  await inspectReceiptState(installRoot, stateRoot, check);
  await inspectExecutable(environment.FFMPEG_BIN, "ffmpeg", check);
  await inspectStt(environment, check);
  await inspectTts(environment, check);
}

async function inspectWeb(installRoot, check) {
  await inspectRegularFile(path.join(installRoot, "apps/web/dist/index.html"), "web-index", check);
  await inspectRegularFile(path.join(installRoot, "apps/web/dist/demo.html"), "web-device-shell", check);
}

async function inspectDevice(installRoot, stateRoot, environment, check) {
  await inspectRegularFile(
    path.join(installRoot, "apps/device/pi_button_adapter.py"),
    "device-adapter",
    check
  );

  const serverUrl = parseLocalHttpUrl(environment.JIKO_SERVER_URL);
  check(
    "device-server-loopback",
    Boolean(serverUrl),
    "The supervised device adapter may call only a loopback HTTP server."
  );

  const outboxPath = environment.JIKO_DEVICE_OUTBOX_PATH;
  check(
    "device-outbox-path",
    isPathInside(outboxPath, stateRoot),
    "JIKO_DEVICE_OUTBOX_PATH must be absolute and remain inside JIKO_STATE_DIR."
  );
  try {
    await access(stateRoot, fsConstants.W_OK);
    check(
      "device-state-writable",
      true,
      "Device StateDirectory is writable by the service user."
    );
  } catch (error) {
    check(
      "device-state-writable",
      false,
      `Device StateDirectory is not writable by the service user: ${shortReason(error)}`
    );
  }
}

async function inspectReceiptState(installRoot, stateRoot, check) {
  const receiptPath = path.join(installRoot, "apps/server/sessions");

  try {
    const link = await lstat(receiptPath);
    check(
      "receipt-state-link",
      link.isSymbolicLink(),
      "apps/server/sessions must be a symlink so releases do not own mutable receipts."
    );
    const [resolvedReceiptPath, resolvedStateRoot] = await Promise.all([
      realpath(receiptPath),
      realpath(stateRoot)
    ]);
    check(
      "receipt-state-target",
      isPathInside(resolvedReceiptPath, resolvedStateRoot),
      "Receipt storage must resolve inside the systemd StateDirectory."
    );
    try {
      await access(resolvedReceiptPath, fsConstants.W_OK);
      check("receipt-state-writable", true, "Receipt storage is writable by the service user.");
    } catch (error) {
      check(
        "receipt-state-writable",
        false,
        `Receipt storage is not writable by the service user: ${shortReason(error)}`
      );
    }
  } catch (error) {
    check("receipt-state-link", false, `Receipt state is unavailable: ${shortReason(error)}`);
  }
}

async function inspectStt(environment, check) {
  const required = parseBoolean(environment.JIKO_READY_REQUIRE_STT) !== false;
  const provider = environment.STT_PROVIDER?.trim().toLowerCase() || "";

  if (!provider) {
    check("stt-provider", !required, required ? "A local STT provider is required." : "STT is optional.");
    return;
  }

  check(
    "stt-provider",
    localSttProviders.has(provider),
    localSttProviders.has(provider) ? `Local provider ${provider}.` : "Cloud or unknown STT providers are rejected."
  );

  if (["sherpa-onnx", "sherpa", "sensevoice"].includes(provider)) {
    await inspectExecutable(environment.SHERPA_ONNX_PYTHON, "sherpa-python", check);
    await inspectRegularFile(environment.SHERPA_ONNX_SENSEVOICE_MODEL, "sherpa-model", check);
    await inspectRegularFile(environment.SHERPA_ONNX_SENSEVOICE_TOKENS, "sherpa-tokens", check);
    if (environment.SHERPA_ONNX_WORKER_SCRIPT) {
      await inspectRegularFile(environment.SHERPA_ONNX_WORKER_SCRIPT, "sherpa-worker", check);
    }
  }

  if (["whisper.cpp", "whisper_cpp", "whisper-cpp"].includes(provider)) {
    await inspectExecutable(environment.WHISPER_CPP_BIN, "whisper-binary", check);
    await inspectRegularFile(environment.WHISPER_MODEL, "whisper-model", check);
  }

  if (provider === "funasr") {
    check(
      "funasr-endpoint",
      Boolean(parseLocalHttpUrl(environment.FUNASR_ENDPOINT)),
      "The supervised profile permits only a loopback self-hosted FunASR endpoint."
    );
  }
}

async function inspectTts(environment, check) {
  const required = parseBoolean(environment.JIKO_READY_REQUIRE_TTS) !== false;
  const provider = environment.TTS_PROVIDER?.trim().toLowerCase() || "";

  if (!provider) {
    check("tts-provider", !required, required ? "A local TTS provider is required." : "TTS is optional.");
    return;
  }

  check(
    "tts-provider",
    localTtsProviders.has(provider),
    localTtsProviders.has(provider) ? `Local provider ${provider}.` : "Cloud or unknown TTS providers are rejected."
  );

  if (["clip", "clips", "local-clip"].includes(provider)) {
    await inspectDirectory(environment.TTS_CLIP_DIR, "tts-clips", check);
  }

  if (provider === "piper") {
    await inspectExecutable(environment.PIPER_BIN, "piper-binary", check);
    await inspectRegularFile(environment.PIPER_VOICE, "piper-voice", check);
  }

  if (parseBoolean(environment.TTS_PLAY_AUDIO) === true) {
    await inspectExecutable(environment.TTS_PLAY_COMMAND, "tts-play-command", check);
  }
}

async function inspectRegularFile(filePath, id, check) {
  if (!filePath || !path.isAbsolute(filePath)) {
    check(id, false, `${id} path must be absolute.`);
    return;
  }

  try {
    const metadata = await stat(filePath);
    check(id, metadata.isFile(), `${id} must be a regular file.`);
  } catch (error) {
    check(id, false, `${id} is unavailable: ${shortReason(error)}`);
  }
}

async function inspectDirectory(directoryPath, id, check) {
  if (!directoryPath || !path.isAbsolute(directoryPath)) {
    check(id, false, `${id} path must be absolute.`);
    return;
  }

  try {
    const metadata = await stat(directoryPath);
    check(id, metadata.isDirectory(), `${id} must be a directory.`);
  } catch (error) {
    check(id, false, `${id} is unavailable: ${shortReason(error)}`);
  }
}

async function inspectExecutable(filePath, id, check) {
  if (!filePath || !path.isAbsolute(filePath)) {
    check(id, false, `${id} path must be absolute.`);
    return;
  }

  try {
    await access(filePath, fsConstants.X_OK);
    const metadata = await stat(filePath);
    check(id, metadata.isFile(), `${id} must be an executable regular file.`);
  } catch (error) {
    check(id, false, `${id} is unavailable or not executable: ${shortReason(error)}`);
  }
}

export function parseLocalHttpUrl(value) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !isLoopbackHost(url.hostname) || url.username || url.password) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function isLoopbackHost(value) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function isPort(value) {
  if (!value || !/^\d+$/.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535;
}

function isPathInside(candidate, parent) {
  if (!candidate || !parent || !path.isAbsolute(candidate) || !path.isAbsolute(parent)) {
    return false;
  }
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseBoolean(value) {
  if (value === undefined) {
    return undefined;
  }
  if (["1", "true", "yes"].includes(value.trim().toLowerCase())) {
    return true;
  }
  if (["0", "false", "no"].includes(value.trim().toLowerCase())) {
    return false;
  }
  return undefined;
}

function shortReason(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const target = process.argv[2] || "";
  const result = await inspectRuntime(target);
  const output = `${JSON.stringify(result)}\n`;
  if (result.outcome === "ready") {
    process.stdout.write(output);
    return;
  }
  process.stderr.write(output);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
