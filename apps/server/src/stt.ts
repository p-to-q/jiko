import { isIP } from "node:net";
import path from "node:path";
import type {
  SttExecutionIdentity,
  SttProviderReceipt,
  SttRemoteExecution,
  TranscriptResult
} from "@jiko/protocol";
import {
  getConfiguredSherpaSenseVoiceWorker,
  PersistentSttWorkerError,
  sherpaSenseVoiceProviderId
} from "./persistentSttWorker.js";
import { ProcessTimeoutError, runProcess } from "./process.js";

export type RemoteAudioConsent = "deepgram";

type SttInput = {
  audioPath: string;
  signal?: AbortSignal;
  /** Per-attempt budget. It may shorten, but never extend, STT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Provider-specific consent copied from this audio upload request only. */
  remoteAudioConsent?: RemoteAudioConsent;
};

type SttProviderInput = SttInput & {
  onExecutionReady(identity: SttExecutionIdentity): void;
  onRemoteExecutionReady(identity: SttRemoteExecution): void;
};

type SttProvider = {
  id: string;
  remote: boolean;
  transcribe(input: SttProviderInput): Promise<TranscriptResult>;
};

export type SttTranscription = {
  transcript: TranscriptResult;
  providerReceipt: SttProviderReceipt;
  /** Resolves only after provider work and its abort cleanup have actually settled. */
  resourceSettlement: Promise<void>;
};

export async function transcribeAudio(input: SttInput): Promise<SttTranscription> {
  const provider = getConfiguredProvider();
  const startedAt = performance.now();
  const timeoutMs = sttTimeoutMs(input.timeoutMs);
  let execution: SttExecutionIdentity | undefined;
  let remoteExecution: SttRemoteExecution | undefined;
  throwIfAborted(input.signal);

  if (timeoutMs <= 0) {
    const transcript = unavailableTranscript(
      provider.id,
      startedAt,
      sttTimeoutError(timeoutMs)
    );
    return withProviderReceipt(transcript, provider, undefined, undefined, Promise.resolve());
  }

  const deadline = createDeadlineSignal(input.signal, timeoutMs);
  const providerWork = Promise.resolve().then(() => provider.transcribe({
    ...input,
    signal: deadline.signal,
    onExecutionReady(identity) {
      execution = identity;
    },
    onRemoteExecutionReady(identity) {
      remoteExecution = identity;
    }
  }));
  const resourceSettlement = providerWork.then(
    () => undefined,
    () => undefined
  );

  try {
    throwIfAborted(input.signal);
    const result = await raceWithSignal(
      providerWork,
      deadline.signal
    );
    throwIfAborted(input.signal);
    if (performance.now() >= deadline.expiresAtMs) {
      throw sttTimeoutError(timeoutMs);
    }
    throwIfAborted(deadline.signal);

    const transcript = {
      ...result,
      latencyMs: result.latencyMs ?? elapsedMs(startedAt)
    };
    return withProviderReceipt(
      transcript,
      provider,
      execution,
      remoteExecution,
      resourceSettlement
    );
  } catch (error) {
    if (input.signal?.aborted) {
      // A cancelled attempt has no useful partial result to return. Keep the
      // outer pipeline alive so its admission lease reflects real provider
      // ownership until child/fetch/worker cleanup has completed.
      await resourceSettlement;
      throw abortReason(input.signal);
    }

    return withProviderReceipt(
      unavailableTranscript(provider.id, startedAt, error),
      provider,
      execution,
      remoteExecution,
      resourceSettlement
    );
  } finally {
    deadline.dispose();
  }
}

// Retained for the benchmark harness and older local-only callers. New server
// code uses the boundary-neutral name above.
export const transcribeLocalAudio = transcribeAudio;

function getConfiguredProvider(): SttProvider {
  const provider = process.env.STT_PROVIDER?.trim().toLowerCase();

  if (provider === "whisper.cpp" || provider === "whisper_cpp" || provider === "whisper-cpp") {
    return whisperCppProvider();
  }

  if (provider === "funasr") {
    return funasrHttpProvider(process.env.FUNASR_ENDPOINT?.trim() || "");
  }

  if (provider === "deepgram") {
    return deepgramBatchProvider();
  }

  if (provider === "sherpa-onnx" || provider === "sherpa" || provider === "sensevoice") {
    return sherpaSenseVoiceProvider();
  }

  return unavailableProvider(provider ? `local:${provider}` : "local:stt-unconfigured");
}

function whisperCppProvider(): SttProvider {
  return {
    id: "local:whisper.cpp",
    remote: false,
    async transcribe(input) {
      const bin = process.env.WHISPER_CPP_BIN?.trim();
      const model = process.env.WHISPER_MODEL?.trim();

      if (!bin || !model) {
        throw new Error("WHISPER_CPP_BIN and WHISPER_MODEL are required for whisper.cpp STT.");
      }

      // Default to language auto-detect; pin with WHISPER_LANGUAGE=zh for Chinese.
      const language = process.env.WHISPER_LANGUAGE?.trim() || "auto";
      const { stdout, stderr } = await runProcess(
        bin,
        ["-m", model, "-f", input.audioPath, "-l", language, "-nt", "-np"],
        { signal: input.signal }
      );
      const text = stripWhisperOutput(stdout || stderr);

      return {
        text,
        language: text ? guessLanguage(text) : undefined,
        provider: "local:whisper.cpp"
      };
    }
  };
}

function funasrHttpProvider(endpoint: string): SttProvider {
  const boundary = describeFunAsrEndpoint(endpoint);
  const acceptedBoundary = boundary?.scope === "loopback" || boundary?.scope === "lan"
    ? boundary
    : undefined;
  const providerId = acceptedBoundary
    ? `self-hosted:funasr-http:${acceptedBoundary.scope}`
    : boundary?.scope === "network"
      ? "self-hosted:funasr-http:network-blocked"
      : "self-hosted:funasr-http:invalid";

  return {
    id: providerId,
    remote: false,
    async transcribe(input) {
      if (!acceptedBoundary) {
        throw new SttConfigurationError(
          "FUNASR_ENDPOINT must use loopback or a literal private LAN address."
        );
      }

      const body = new FormData();
      body.append(
        "file",
        new Blob([await readFileAsArrayBuffer(input.audioPath)], { type: "audio/wav" }),
        path.basename(input.audioPath)
      );
      throwIfAborted(input.signal);

      // FunASR's current local HTTP server exposes the OpenAI-compatible
      // transcription route, which requires an explicit model form field.
      // Older self-hosted adapters may ignore this extra field.
      body.append("model", process.env.FUNASR_MODEL?.trim() || "sensevoice");
      const language = process.env.FUNASR_LANGUAGE?.trim();
      if (language && language !== "auto") {
        body.append("language", language);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        body,
        redirect: "error",
        signal: input.signal
      });

      if (!response.ok) {
        throw new Error(
          `FunASR endpoint returned ${response.status} ${response.statusText}.`
        );
      }

      const payload = await response.json();
      const text = extractText(payload);

      return {
        text,
        language: text ? guessLanguage(text) : undefined,
        provider: providerId,
        ...(confidenceValue(payload) !== undefined
          ? { confidence: confidenceValue(payload) }
          : {})
      };
    }
  };
}

export type FunAsrEndpointScope = "loopback" | "lan" | "network";

export type FunAsrEndpointBoundary = {
  origin: string;
  scope: FunAsrEndpointScope;
};

export function describeFunAsrEndpoint(
  endpoint: string
): FunAsrEndpointBoundary | undefined {
  try {
    const url = new URL(endpoint);
    const hostnameLiteral = rawEndpointHostname(endpoint);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.hash ||
      !hostnameLiteral
    ) {
      return undefined;
    }

    return {
      origin: url.origin,
      scope: selfHostedEndpointScope(hostnameLiteral)
    };
  } catch {
    return undefined;
  }
}

function rawEndpointHostname(endpoint: string): string | undefined {
  if (endpoint !== endpoint.trim()) {
    return undefined;
  }
  const authority = /^[a-z][a-z\d+.-]*:\/\/([^/?#]+)/i.exec(endpoint)?.[1];
  if (!authority || authority.includes("@")) {
    return undefined;
  }
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    return closingBracket > 1
      ? authority.slice(1, closingBracket)
      : undefined;
  }

  const portSeparator = authority.lastIndexOf(":");
  return portSeparator === -1
    ? authority
    : authority.slice(0, portSeparator);
}

const deepgramProviderId = "remote:deepgram-batch";
const defaultDeepgramEndpoint = "https://api.deepgram.com/v1/listen";

type DeepgramRuntimeConfiguration = {
  apiKey: string;
  endpoint: URL;
  language: string;
  model: string;
  region: SttRemoteExecution["region"];
  version: string;
};

type DeepgramConfiguration =
  | {
      status: "configured";
      value: DeepgramRuntimeConfiguration;
    }
  | {
      status: "disabled" | "missing";
      detail: string;
    };

export function getDeepgramConfigurationDiagnostic(): {
  status: "configured" | "disabled" | "missing";
  id: string;
  detail: string;
} {
  const configuration = readDeepgramConfiguration();
  if (configuration.status !== "configured") {
    return {
      status: configuration.status,
      id: deepgramProviderId,
      detail: configuration.detail
    };
  }

  const { endpoint, model, region, version } = configuration.value;
  return {
    status: "configured",
    id: deepgramProviderId,
    detail: [
      "Deepgram pre-recorded batch",
      `region=${region}`,
      `endpoint=${endpoint.origin}`,
      `model=${model}`,
      `version=${version}`,
      "mip_opt_out=true",
      "per-request consent required"
    ].join("; ")
  };
}

function deepgramBatchProvider(): SttProvider {
  return {
    id: deepgramProviderId,
    remote: true,
    async transcribe(input) {
      const configured = readDeepgramConfiguration();
      if (configured.status !== "configured") {
        throw new SttConfigurationError(configured.detail);
      }
      if (input.remoteAudioConsent !== "deepgram") {
        throw new SttConfigurationError(
          "Explicit per-request Deepgram audio consent is required."
        );
      }

      const { apiKey, endpoint, language, model, region, version } = configured.value;
      const requestReceipt: SttRemoteExecution = {
        provider: "deepgram",
        model,
        version,
        region,
        mode: "batch",
        trustBoundary: "deepgram_api",
        endpointOrigin: endpoint.origin,
        mipOptOut: true
      };
      input.onRemoteExecutionReady(requestReceipt);

      const requestUrl = new URL(endpoint.toString());
      requestUrl.searchParams.set("model", model);
      requestUrl.searchParams.set("version", version);
      requestUrl.searchParams.set("language", language);
      // This adapter deliberately has no setting that can turn MIP opt-out off.
      requestUrl.searchParams.set("mip_opt_out", "true");

      const audio = await readFileAsArrayBuffer(input.audioPath);
      throwIfAborted(input.signal);
      const response = await fetch(requestUrl.toString(), {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "content-type": "audio/wav"
        },
        body: audio,
        redirect: "error",
        signal: input.signal
      });

      if (!response.ok) {
        throw new Error(
          `Deepgram endpoint returned ${response.status} ${response.statusText}.`
        );
      }

      const parsed = parseDeepgramResponse(await response.json());
      input.onRemoteExecutionReady({
        ...requestReceipt,
        requestId: parsed.requestId,
        resolvedModel: parsed.resolvedModel,
        resolvedVersion: parsed.resolvedVersion
      });

      return {
        text: parsed.text,
        language: parsed.language || (parsed.text ? guessLanguage(parsed.text) : undefined),
        provider: deepgramProviderId,
        ...(parsed.confidence !== undefined
          ? { confidence: parsed.confidence }
          : {})
      };
    }
  };
}

function readDeepgramConfiguration(): DeepgramConfiguration {
  if (process.env.JIKO_ALLOW_REMOTE_AUDIO !== "1") {
    return {
      status: "disabled",
      detail: "Remote audio is disabled; JIKO_ALLOW_REMOTE_AUDIO=1 is required."
    };
  }

  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "missing",
      detail: "DEEPGRAM_API_KEY is required when the remote provider is enabled."
    };
  }

  const endpoint = parseDeepgramEndpoint(
    process.env.DEEPGRAM_ENDPOINT?.trim() || defaultDeepgramEndpoint
  );
  if (!endpoint) {
    return {
      status: "missing",
      detail: "DEEPGRAM_ENDPOINT must be an HTTPS URL without credentials, query, or fragment."
    };
  }

  const model = safeProviderSelector(process.env.DEEPGRAM_MODEL, "nova-3", 128);
  const version = safeProviderSelector(process.env.DEEPGRAM_VERSION, "", 128);
  const language = safeProviderSelector(process.env.DEEPGRAM_LANGUAGE, "multi", 32);
  if (!model || !version || version.toLowerCase() === "latest" || !language) {
    return {
      status: "missing",
      detail: "DEEPGRAM_VERSION must be an explicit pinned version (not latest); model and language must be safe selectors."
    };
  }

  return {
    status: "configured",
    value: {
      apiKey,
      endpoint,
      language,
      model,
      region: deepgramRegion(endpoint.hostname),
      version
    }
  };
}

function parseDeepgramEndpoint(raw: string): URL | undefined {
  try {
    const endpoint = new URL(raw);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      return undefined;
    }
    return endpoint;
  } catch {
    return undefined;
  }
}

function safeProviderSelector(
  configured: string | undefined,
  fallback: string,
  maxLength: number
): string | undefined {
  const value = configured?.trim() || fallback;
  return value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

function deepgramRegion(hostname: string): SttRemoteExecution["region"] {
  switch (hostname.toLowerCase()) {
    case "api.deepgram.com":
      return "global";
    case "api.eu.deepgram.com":
      return "eu";
    case "api.au.deepgram.com":
      return "au";
    case "api.in.deepgram.com":
      return "in";
    default:
      return "custom";
  }
}

function parseDeepgramResponse(payload: unknown): {
  text: string;
  language?: string;
  confidence?: number;
  requestId: string;
  resolvedModel: string;
  resolvedVersion: string;
} {
  const root = recordValue(payload);
  const metadata = recordValue(root?.metadata);
  const results = recordValue(root?.results);
  const channels = Array.isArray(results?.channels) ? results.channels : [];
  const channel = recordValue(channels[0]);
  const alternatives = Array.isArray(channel?.alternatives)
    ? channel.alternatives
    : [];
  const alternative = recordValue(alternatives[0]);
  const text = stringValue(alternative?.transcript);
  const requestId = stringValue(metadata?.request_id);
  const modelIds = Array.isArray(metadata?.models)
    ? metadata.models.filter((value): value is string => typeof value === "string")
    : [];
  const modelInfoById = recordValue(metadata?.model_info);
  const resolved = modelIds
    .map((id) => recordValue(modelInfoById?.[id]))
    .find(Boolean);
  const resolvedModel = stringValue(resolved?.name);
  const resolvedVersion = stringValue(resolved?.version);

  if (
    text === undefined ||
    !requestId ||
    !resolvedModel ||
    !resolvedVersion
  ) {
    throw new Error(
      "Deepgram response did not include transcript and auditable request/model identity."
    );
  }

  const confidence = alternative?.confidence;
  return {
    text: text.trim(),
    requestId,
    resolvedModel,
    resolvedVersion,
    ...(typeof channel?.detected_language === "string"
      ? { language: channel.detected_language }
      : {}),
    ...(typeof confidence === "number" && Number.isFinite(confidence)
      ? { confidence: Math.max(0, Math.min(1, confidence)) }
      : {})
  };
}

function selfHostedEndpointScope(hostname: string): FunAsrEndpointScope {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const addressFamily = isIP(host);

  if (
    (addressFamily === 4 && isLoopbackIpv4(host)) ||
    (addressFamily === 6 && host === "::1")
  ) {
    return "loopback";
  }

  if (
    (addressFamily === 4 && isPrivateIpv4(host)) ||
    (addressFamily === 6 && isUniqueLocalIpv6(host))
  ) {
    return "lan";
  }

  return "network";
}

function isLoopbackIpv4(hostname: string): boolean {
  return Number(hostname.split(".")[0]) === 127;
}

function isUniqueLocalIpv6(hostname: string): boolean {
  const firstHextet = Number.parseInt(hostname.split(":", 1)[0] ?? "", 16);
  return Number.isInteger(firstHextet) && (firstHextet & 0xfe00) === 0xfc00;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }

  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function sherpaSenseVoiceProvider(): SttProvider {
  return {
    id: sherpaSenseVoiceProviderId,
    remote: false,
    async transcribe(input) {
      const payload = await getConfiguredSherpaSenseVoiceWorker().transcribe({
        audioPath: input.audioPath,
        signal: input.signal,
        onExecutionReady: input.onExecutionReady
      });

      return {
        text: payload.text,
        language: payload.language || (payload.text ? guessLanguage(payload.text) : undefined),
        provider: sherpaSenseVoiceProviderId,
        ...(typeof payload.confidence === "number"
          ? { confidence: payload.confidence }
          : {}),
        latencyMs: payload.latencyMs
      };
    }
  };
}

function withProviderReceipt(
  transcript: TranscriptResult,
  provider: SttProvider,
  execution?: SttExecutionIdentity,
  remoteExecution?: SttRemoteExecution,
  resourceSettlement: Promise<void> = Promise.resolve()
): SttTranscription {
  return {
    transcript,
    resourceSettlement,
    providerReceipt: {
      id: transcript.provider,
      latencyMs: transcript.latencyMs,
      remote: provider.remote,
      outcome: transcript.failureCode ?? "completed",
      ...(execution ? { execution } : {}),
      ...(remoteExecution ? { remoteExecution } : {})
    }
  };
}

function unavailableProvider(id: string): SttProvider {
  return {
    id,
    remote: false,
    async transcribe() {
      throw new Error("No local STT provider is configured.");
    }
  };
}

function unavailableTranscript(providerId: string, startedAt: number, error: unknown): TranscriptResult {
  const failureCode = failureCodeForError(error);
  const suffix = failureCode === "provider_unavailable" ? "unavailable" : failureCode;

  return {
    text: "",
    language: undefined,
    provider: `${providerId}:${suffix}`,
    failureCode,
    latencyMs: elapsedMs(startedAt)
  };
}

function failureCodeForError(error: unknown): NonNullable<TranscriptResult["failureCode"]> {
  if (error instanceof SttConfigurationError) {
    return "provider_unavailable";
  }

  if (
    error instanceof ProcessTimeoutError ||
    (error instanceof PersistentSttWorkerError && error.code === "startup_timeout") ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return "timed_out";
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("required") || message.includes("No local STT provider")) {
    return "provider_unavailable";
  }

  return "failed";
}

function sttTimeoutMs(attemptBudgetMs?: number): number {
  const configured = Number(process.env.STT_TIMEOUT_MS);
  const safetyCeiling = Number.isFinite(configured)
    ? Math.max(1_000, Math.min(90_000, Math.round(configured)))
    : 15_000;
  if (attemptBudgetMs === undefined || !Number.isFinite(attemptBudgetMs)) {
    return safetyCeiling;
  }

  return Math.max(0, Math.min(safetyCeiling, Math.floor(attemptBudgetMs)));
}

async function readFileAsArrayBuffer(path: string): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  const buffer = await readFile(path);
  const bytes = buffer as unknown as { length: number; [index: number]: number };
  const output = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    output[index] = bytes[index];
  }

  return output;
}

function stripWhisperOutput(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function extractText(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.trim();
  }

  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const direct = stringValue(record.text) ?? stringValue(record.result) ?? stringValue(record.transcript);
  if (direct) {
    return direct.trim();
  }

  if (Array.isArray(record.sentences)) {
    return record.sentences
      .map((item) => (item && typeof item === "object" ? stringValue((item as Record<string, unknown>).text) : undefined))
      .filter(Boolean)
      .join("")
      .trim();
  }

  return "";
}

function confidenceValue(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = (payload as Record<string, unknown>).confidence;

  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function guessLanguage(transcript: string): string {
  return /[\u3400-\u9fff]/.test(transcript) ? "zh" : "en";
}

function createDeadlineSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; expiresAtMs: number; dispose(): void } {
  const controller = new AbortController();
  const expiresAtMs = performance.now() + timeoutMs;
  const handleParentAbort = () => {
    controller.abort(parent ? abortReason(parent) : undefined);
  };
  if (parent?.aborted) {
    handleParentAbort();
  } else {
    parent?.addEventListener("abort", handleParentAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(sttTimeoutError(timeoutMs));
  }, timeoutMs);
  timeout.unref?.();

  return {
    signal: controller.signal,
    expiresAtMs,
    dispose() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", handleParentAbort);
    }
  };
}

function raceWithSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      signal.removeEventListener("abort", handleAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

function sttTimeoutError(timeoutMs: number): Error {
  const error = new Error(`STT timed out after ${timeoutMs} ms`);
  error.name = "TimeoutError";
  return error;
}

function elapsedMs(startedAtMs: number): number {
  return Number((performance.now() - startedAtMs).toFixed(3));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("STT was cancelled");
}

class SttConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttConfigurationError";
  }
}
