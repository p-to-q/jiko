#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { deploymentSchemaVersion, parseLocalHttpUrl } from "./runtime-preflight.mjs";

const probeSchemaVersion = "jiko_runtime_probe_v1";

export async function probeServer(options = {}) {
  const environment = options.environment || process.env;
  const url = parseProbeUrl(
    options.url || environment.JIKO_PROBE_URL || "http://127.0.0.1:4317/health",
    "/health"
  );
  if (!url) {
    return result("server", "not_ready", [failed("probe-url", "Probe URL must be loopback HTTP /health.")]);
  }

  const response = await fetchProbe(url, options.fetchImpl || fetch, environment);
  if (response.outcome !== "received") {
    return result("server", response.outcome, [failed("http", response.detail)]);
  }

  const checks = [
    checked("http-status", response.status === 200, `HTTP ${response.status}.`),
    checked("service", response.body?.service === "@jiko/server", "Expected @jiko/server."),
    checked("health-ok", response.body?.ok === true, "Health response must set ok=true."),
    checked("mode", response.body?.mode === "local", "Server must report local mode."),
    checked(
      "ffmpeg",
      response.body?.diagnostics?.runtime?.ffmpeg?.status === "ready",
      diagnosticDetail(response.body?.diagnostics?.runtime?.ffmpeg)
    )
  ];

  if (required(environment.JIKO_READY_REQUIRE_STT, true)) {
    checks.push(checked(
      "stt",
      response.body?.diagnostics?.providers?.stt?.status === "ready",
      diagnosticDetail(response.body?.diagnostics?.providers?.stt)
    ));
  }

  if (required(environment.JIKO_READY_REQUIRE_TTS, true)) {
    checks.push(checked(
      "tts",
      response.body?.diagnostics?.providers?.tts?.status === "ready",
      diagnosticDetail(response.body?.diagnostics?.providers?.tts)
    ));
  }

  if (required(environment.JIKO_READY_REQUIRE_RECEIPTS, true)) {
    checks.push(checked(
      "receipts",
      response.body?.receiptsEnabled === true,
      "Canonical receipt persistence must be enabled."
    ));
  }

  return result(
    "server",
    checks.every((entry) => entry.status === "pass") ? "ready" : "not_ready",
    checks
  );
}

export async function probeWeb(options = {}) {
  const environment = options.environment || process.env;
  const url = parseProbeUrl(
    options.url || environment.JIKO_WEB_PROBE_URL || "http://127.0.0.1:4173/",
    "/"
  );
  if (!url) {
    return result("web", "not_ready", [failed("probe-url", "Probe URL must be loopback HTTP root.")]);
  }

  const response = await fetchProbe(url, options.fetchImpl || fetch, environment);
  if (response.outcome !== "received") {
    return result("web", response.outcome, [failed("http", response.detail)]);
  }

  const checks = [
    checked("http-status", response.status === 200, `HTTP ${response.status}.`),
    checked(
      "web-shell",
      typeof response.text === "string" && response.text.includes('<div id="root"></div>'),
      "Expected the built Jiko root shell."
    )
  ];

  return result(
    "web",
    checks.every((entry) => entry.status === "pass") ? "ready" : "not_ready",
    checks
  );
}

async function fetchProbe(url, fetchImpl, environment) {
  const attempts = boundedInteger(environment.JIKO_PROBE_ATTEMPTS, 1, 1, 50);
  const retryMs = boundedInteger(environment.JIKO_PROBE_RETRY_MS, 100, 25, 5_000);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs(environment))
      });
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      return {
        outcome: "received",
        status: response.status,
        text,
        body
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await delay(retryMs);
      }
    }
  }

  return {
    outcome: "unavailable",
    detail: lastError instanceof Error ? lastError.message : String(lastError)
  };
}

function parseProbeUrl(value, expectedPath) {
  const url = parseLocalHttpUrl(value);
  if (!url || url.pathname !== expectedPath || url.search || url.hash) {
    return undefined;
  }
  return url;
}

function timeoutMs(environment) {
  const parsed = Number(environment.JIKO_PROBE_TIMEOUT_MS || "5000");
  return Number.isInteger(parsed) && parsed >= 250 && parsed <= 80_000 ? parsed : 5_000;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function required(value, defaultValue) {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  return !["0", "false", "no"].includes(value.trim().toLowerCase());
}

function diagnosticDetail(value) {
  if (!value || typeof value !== "object") {
    return "Diagnostic is missing.";
  }
  const id = typeof value.id === "string" ? value.id : "unknown";
  const status = typeof value.status === "string" ? value.status : "unknown";
  return `${id}: ${status}.`;
}

function checked(id, passed, detail) {
  return { id, status: passed ? "pass" : "fail", detail };
}

function failed(id, detail) {
  return checked(id, false, detail);
}

function result(target, outcome, checks) {
  return {
    schemaVersion: probeSchemaVersion,
    deploymentSchemaVersion,
    target,
    outcome,
    checkedAt: new Date().toISOString(),
    checks
  };
}

async function main() {
  const target = process.argv[2];
  const probe = target === "server"
    ? await probeServer()
    : target === "web"
      ? await probeWeb()
      : result(target || "unknown", "not_ready", [failed("target", "Use server or web.")]);
  const output = `${JSON.stringify(probe)}\n`;
  if (probe.outcome === "ready") {
    process.stdout.write(output);
    return;
  }
  process.stderr.write(output);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
