import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SttExecutionIdentity } from "@jiko/protocol";

const workerProtocolVersion = 1 as const;
const defaultStartupTimeoutMs = 60_000;
const defaultMaxPendingRequests = 1;
const maxStdoutBufferLength = 256 * 1024;
const maxStderrTailLength = 4 * 1024;
export const sherpaSenseVoiceProviderId = "local:sherpa-onnx-sensevoice";
const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

type WorkerPipe = {
  on(event: "data", listener: (chunk: unknown) => void): void;
};

type WorkerInput = {
  write(value: string): boolean;
  on(event: "error", listener: (error: Error) => void): void;
};

type WorkerChild = {
  pid?: number;
  stdin?: WorkerInput;
  stdout?: WorkerPipe;
  stderr?: WorkerPipe;
  kill(signal?: string): boolean;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number | null, signal?: string | null) => void): void;
};

export type SttWorkerArtifactIdentity = {
  name: string;
  sha256: string;
  bytes: number;
};

export type SttWorkerReadiness = {
  status: "ready";
  protocolVersion: typeof workerProtocolVersion;
  providerId: string;
  runtime: {
    name: string;
    version: string;
  };
  artifacts: {
    model: SttWorkerArtifactIdentity;
    tokens: SttWorkerArtifactIdentity;
  };
  configuration: {
    language: string;
    threads: number;
    executionProvider: string;
    useItn: boolean;
  };
  loadMs: number;
  workerPid?: number;
};

export type SttWorkerSnapshot =
  | { status: "not_started" | "starting" | "stopped"; providerId: string; detail?: string }
  | { status: "failed"; providerId: string; detail: string }
  | SttWorkerReadiness;

export type PersistentSttTranscript = {
  text: string;
  language?: string;
  confidence?: number;
  latencyMs: number;
  providerId: string;
  artifacts: SttWorkerReadiness["artifacts"];
};

export type PersistentSttWorkerOptions = {
  command: string;
  args: string[];
  providerId: string;
  startupTimeoutMs?: number;
  maxPendingRequests?: number;
};

type PendingRequest = {
  resolve(value: PersistentSttTranscript): void;
  reject(error: Error): void;
  readiness: SttWorkerReadiness;
  signal?: AbortSignal;
  handleAbort?: () => void;
};

type StopState = {
  promise: Promise<void>;
  resolve(): void;
  snapshot: Exclude<SttWorkerSnapshot, SttWorkerReadiness>;
};

export class PersistentSttWorkerError extends Error {
  constructor(
    public readonly code:
      | "invalid_configuration"
      | "protocol_error"
      | "queue_full"
      | "request_failed"
      | "startup_timeout"
      | "worker_exited",
    message: string
  ) {
    super(message);
    this.name = "PersistentSttWorkerError";
  }
}

/**
 * Owns one local worker process and one loaded model instance.
 *
 * The worker is intentionally single-flight by default. SenseVoice decoding is
 * synchronous in the Python adapter, so accepting an unbounded request queue
 * would hide latency and retain audio paths after their attempts have ended.
 */
export class PersistentSttWorker {
  private readonly startupTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private child?: WorkerChild;
  private startupPromise?: Promise<SttWorkerReadiness>;
  private resolveStartup?: (readiness: SttWorkerReadiness) => void;
  private rejectStartup?: (error: Error) => void;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private forceKillTimer?: ReturnType<typeof setTimeout>;
  private stopState?: StopState;
  private stdoutBuffer = "";
  private stderrTail = "";
  private requestSequence = 0;
  private generation = 0;
  private pending = new Map<string, PendingRequest>();
  private snapshotValue: SttWorkerSnapshot;

  constructor(private readonly options: PersistentSttWorkerOptions) {
    if (!options.command.trim() || !options.providerId.trim()) {
      throw new PersistentSttWorkerError(
        "invalid_configuration",
        "Persistent STT worker command and providerId are required."
      );
    }

    this.startupTimeoutMs = positiveInteger(
      options.startupTimeoutMs,
      defaultStartupTimeoutMs
    );
    this.maxPendingRequests = positiveInteger(
      options.maxPendingRequests,
      defaultMaxPendingRequests
    );
    this.snapshotValue = {
      status: "not_started",
      providerId: options.providerId
    };
  }

  snapshot(): SttWorkerSnapshot {
    return this.snapshotValue;
  }

  async start(): Promise<SttWorkerReadiness> {
    if (this.stopState) {
      await this.stopState.promise;
    }

    if (this.snapshotValue.status === "ready") {
      return this.snapshotValue;
    }

    if (this.startupPromise) {
      return this.startupPromise;
    }

    return this.launch();
  }

  async transcribe(input: {
    audioPath: string;
    signal?: AbortSignal;
    onExecutionReady?: (identity: SttExecutionIdentity) => void;
  }): Promise<PersistentSttTranscript> {
    if (!input.audioPath.trim()) {
      throw new PersistentSttWorkerError(
        "invalid_configuration",
        "Persistent STT worker audioPath is required."
      );
    }

    throwIfAborted(input.signal);
    const readiness = await this.waitForStartup(input.signal);
    throwIfAborted(input.signal);

    if (this.pending.size >= this.maxPendingRequests) {
      throw new PersistentSttWorkerError(
        "queue_full",
        `Persistent STT worker queue is full (${this.maxPendingRequests}).`
      );
    }

    const child = this.child;
    if (!child?.stdin || this.snapshotValue.status !== "ready") {
      throw new PersistentSttWorkerError(
        "worker_exited",
        "Persistent STT worker exited before the request was sent."
      );
    }

    // Capture identity only after this request has passed readiness and
    // admission. Environment paths alone are not proof that a model loaded.
    input.onExecutionReady?.(executionIdentityForReadiness(readiness));

    const requestId = `${this.generation}:${++this.requestSequence}`;

    return new Promise<PersistentSttTranscript>((resolve, reject) => {
      const pending: PendingRequest = {
        resolve,
        reject,
        readiness,
        signal: input.signal
      };
      pending.handleAbort = () => {
        if (!this.pending.delete(requestId)) {
          return;
        }

        cleanupPending(pending);
        const reason = abortReason(input.signal);
        reject(reason);
        void this.terminate(reason, {
          status: "stopped",
          providerId: this.options.providerId,
          detail: "Worker stopped because its active request was cancelled."
        });
      };

      this.pending.set(requestId, pending);
      input.signal?.addEventListener("abort", pending.handleAbort, { once: true });

      try {
        child.stdin?.write(`${JSON.stringify({
          type: "transcribe",
          requestId,
          audioPath: input.audioPath
        })}\n`);
      } catch (error) {
        this.pending.delete(requestId);
        cleanupPending(pending);
        const workerError = normalizeError(error, "Failed to write to persistent STT worker.");
        reject(workerError);
        void this.fail(workerError);
      }
    });
  }

  stop(): Promise<void> {
    return this.terminate(
      new PersistentSttWorkerError("worker_exited", "Persistent STT worker was stopped."),
      { status: "stopped", providerId: this.options.providerId }
    );
  }

  private launch(): Promise<SttWorkerReadiness> {
    this.generation += 1;
    const generation = this.generation;
    this.stdoutBuffer = "";
    this.stderrTail = "";
    this.snapshotValue = {
      status: "starting",
      providerId: this.options.providerId
    };

    this.startupPromise = new Promise<SttWorkerReadiness>((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
    });

    const child = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "pipe"]
    }) as unknown as WorkerChild;
    this.child = child;

    child.stdout?.on("data", (chunk) => this.handleStdoutChunk(generation, String(chunk)));
    child.stderr?.on("data", (chunk) => {
      if (generation !== this.generation) {
        return;
      }
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-maxStderrTailLength);
    });
    child.stdin?.on("error", (error) => {
      if (generation === this.generation) {
        void this.fail(normalizeError(error, "Persistent STT worker stdin failed."));
      }
    });
    child.on("error", (error) => {
      if (generation === this.generation) {
        void this.fail(normalizeError(error, "Persistent STT worker failed to start."));
      }
    });
    child.on("close", (code, signal) => {
      this.handleClose(generation, code, signal);
    });

    this.startupTimer = setTimeout(() => {
      if (generation !== this.generation || this.snapshotValue.status !== "starting") {
        return;
      }

      void this.fail(
        new PersistentSttWorkerError(
          "startup_timeout",
          `Persistent STT worker did not become ready within ${this.startupTimeoutMs} ms.`
        )
      );
    }, this.startupTimeoutMs);
    this.startupTimer.unref?.();

    return this.startupPromise;
  }

  private async waitForStartup(signal?: AbortSignal): Promise<SttWorkerReadiness> {
    const startup = this.start();
    if (!signal) {
      return startup;
    }

    if (signal.aborted) {
      throw abortReason(signal);
    }

    return new Promise<SttWorkerReadiness>((resolve, reject) => {
      const handleAbort = () => {
        signal.removeEventListener("abort", handleAbort);
        const reason = abortReason(signal);
        reject(reason);
        void this.terminate(reason, {
          status: "stopped",
          providerId: this.options.providerId,
          detail: "Worker stopped while model readiness was cancelled."
        });
      };
      signal.addEventListener("abort", handleAbort, { once: true });
      startup.then(
        (readiness) => {
          signal.removeEventListener("abort", handleAbort);
          resolve(readiness);
        },
        (error) => {
          signal.removeEventListener("abort", handleAbort);
          reject(error);
        }
      );
    });
  }

  private handleStdoutChunk(generation: number, chunk: string): void {
    if (generation !== this.generation) {
      return;
    }

    this.stdoutBuffer += chunk;
    if (this.stdoutBuffer.length > maxStdoutBufferLength) {
      void this.fail(
        new PersistentSttWorkerError(
          "protocol_error",
          "Persistent STT worker emitted an oversized response."
        )
      );
      return;
    }

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        void this.fail(
          new PersistentSttWorkerError(
            "protocol_error",
            "Persistent STT worker emitted invalid NDJSON."
          )
        );
        return;
      }

      this.handleMessage(payload);
    }
  }

  private handleMessage(payload: unknown): void {
    if (!isRecord(payload)) {
      void this.fail(protocolError("Worker message must be a JSON object."));
      return;
    }

    if (payload.type === "ready") {
      if (this.snapshotValue.status !== "starting") {
        void this.fail(protocolError("Worker emitted duplicate readiness."));
        return;
      }

      try {
        const readiness = parseReadiness(payload, this.options.providerId);
        clearTimer(this.startupTimer);
        this.startupTimer = undefined;
        this.snapshotValue = readiness;
        this.resolveStartup?.(readiness);
        this.resolveStartup = undefined;
        this.rejectStartup = undefined;
      } catch (error) {
        void this.fail(normalizeError(error, "Invalid persistent STT readiness."));
      }
      return;
    }

    if (payload.type === "startup_error") {
      const error = parseWorkerError(payload, "Persistent STT worker failed during startup.");
      void this.fail(error);
      return;
    }

    if (payload.type !== "transcript" && payload.type !== "error") {
      void this.fail(protocolError("Worker emitted an unknown message type."));
      return;
    }

    const requestId = stringField(payload, "requestId");
    if (!requestId) {
      void this.fail(protocolError("Worker response is missing requestId."));
      return;
    }

    const pending = this.pending.get(requestId);
    if (!pending) {
      // A response may race with cancellation. The cancelled request cannot
      // commit, and its worker generation is already being terminated.
      return;
    }

    this.pending.delete(requestId);
    cleanupPending(pending);

    if (payload.type === "error") {
      pending.reject(parseWorkerError(payload, "Persistent STT request failed."));
      return;
    }

    try {
      if (this.snapshotValue.status !== "ready") {
        throw protocolError("Worker returned a transcript before readiness.");
      }
      const text = stringField(payload, "text");
      const latencyMs = finiteNumberField(payload, "latencyMs");
      if (text === undefined || latencyMs === undefined || latencyMs < 0) {
        throw protocolError("Worker transcript has invalid text or latencyMs.");
      }

      const language = stringField(payload, "language");
      const confidence = finiteNumberField(payload, "confidence");
      pending.resolve({
        text,
        ...(language ? { language } : {}),
        ...(confidence !== undefined ? { confidence } : {}),
        latencyMs,
        providerId: pending.readiness.providerId,
        artifacts: pending.readiness.artifacts
      });
    } catch (error) {
      const workerError = normalizeError(error, "Invalid persistent STT transcript.");
      pending.reject(workerError);
      void this.fail(workerError);
    }
  }

  private handleClose(
    generation: number,
    code: number | null,
    signal?: string | null
  ): void {
    if (generation !== this.generation) {
      return;
    }

    clearTimer(this.startupTimer);
    clearTimer(this.forceKillTimer);
    this.startupTimer = undefined;
    this.forceKillTimer = undefined;

    const stopState = this.stopState;
    const detailParts = [
      `code=${code ?? "null"}`,
      signal ? `signal=${signal}` : "",
      this.stderrTail.trim() ? `stderr=${singleLine(this.stderrTail)}` : ""
    ].filter(Boolean);
    const exitError = new PersistentSttWorkerError(
      "worker_exited",
      `Persistent STT worker exited (${detailParts.join(", ")}).`
    );

    this.rejectStartup?.(exitError);
    this.rejectStartup = undefined;
    this.resolveStartup = undefined;
    this.rejectAllPending(exitError);
    this.child = undefined;
    this.startupPromise = undefined;
    this.stdoutBuffer = "";

    if (stopState) {
      this.snapshotValue = stopState.snapshot;
      this.stopState = undefined;
      stopState.resolve();
      return;
    }

    this.snapshotValue = {
      status: "failed",
      providerId: this.options.providerId,
      detail: exitError.message
    };
  }

  private fail(error: Error): Promise<void> {
    return this.terminate(error, {
      status: "failed",
      providerId: this.options.providerId,
      detail: error.message
    });
  }

  private terminate(
    reason: Error,
    snapshot: Exclude<SttWorkerSnapshot, SttWorkerReadiness>
  ): Promise<void> {
    if (this.stopState) {
      return this.stopState.promise;
    }

    const child = this.child;
    if (!child) {
      clearTimer(this.startupTimer);
      this.startupTimer = undefined;
      this.rejectStartup?.(reason);
      this.rejectStartup = undefined;
      this.resolveStartup = undefined;
      this.startupPromise = undefined;
      this.rejectAllPending(reason);
      this.snapshotValue = snapshot;
      return Promise.resolve();
    }

    let resolveStop: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    this.stopState = { promise, resolve: resolveStop, snapshot };
    this.rejectStartup?.(reason);
    this.rejectAllPending(reason);
    child.kill("SIGTERM");
    this.forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 250);
    this.forceKillTimer.unref?.();
    return promise;
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      cleanupPending(pending);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function executionIdentityForReadiness(
  readiness: SttWorkerReadiness
): SttExecutionIdentity {
  return {
    runtime: { ...readiness.runtime },
    configuration: { ...readiness.configuration },
    artifacts: {
      model: { ...readiness.artifacts.model },
      tokens: { ...readiness.artifacts.tokens }
    }
  };
}

type SharedSherpaWorker = {
  configurationKey: string;
  worker: PersistentSttWorker;
};

let sharedSherpaWorker: SharedSherpaWorker | undefined;

/**
 * Returns the process-wide SenseVoice worker selected by the local runtime
 * configuration. STT calls and health diagnostics deliberately share this
 * instance so a readiness probe warms the same recognizer used by sessions.
 */
export function getConfiguredSherpaSenseVoiceWorker(): PersistentSttWorker {
  const python = process.env.SHERPA_ONNX_PYTHON?.trim() || ".venv/bin/python";
  const script = process.env.SHERPA_ONNX_WORKER_SCRIPT?.trim()
    || path.join(serverRoot, "scripts", "sherpa-sensevoice-worker.py");
  const model = process.env.SHERPA_ONNX_SENSEVOICE_MODEL?.trim();
  const tokens = process.env.SHERPA_ONNX_SENSEVOICE_TOKENS?.trim();

  if (!model || !tokens) {
    throw new PersistentSttWorkerError(
      "invalid_configuration",
      "SHERPA_ONNX_SENSEVOICE_MODEL and SHERPA_ONNX_SENSEVOICE_TOKENS are required."
    );
  }

  const args = [
    script,
    "--model",
    model,
    "--tokens",
    tokens,
    "--language",
    process.env.SHERPA_ONNX_LANGUAGE?.trim() || "auto",
    "--threads",
    process.env.SHERPA_ONNX_THREADS?.trim() || "4",
    "--provider",
    process.env.SHERPA_ONNX_PROVIDER?.trim() || "cpu",
    ...(truthyEnvironmentValue(process.env.SHERPA_ONNX_USE_ITN) ? ["--use-itn"] : [])
  ];
  const configurationKey = JSON.stringify([python, ...args]);

  if (sharedSherpaWorker?.configurationKey === configurationKey) {
    return sharedSherpaWorker.worker;
  }

  if (sharedSherpaWorker) {
    void sharedSherpaWorker.worker.stop();
  }

  const worker = new PersistentSttWorker({
    command: python,
    args,
    providerId: sherpaSenseVoiceProviderId,
    startupTimeoutMs: boundedEnvironmentInteger(
      process.env.SHERPA_ONNX_STARTUP_TIMEOUT_MS,
      defaultStartupTimeoutMs,
      1_000,
      300_000
    ),
    maxPendingRequests: boundedEnvironmentInteger(
      process.env.SHERPA_ONNX_MAX_PENDING_REQUESTS,
      defaultMaxPendingRequests,
      1,
      8
    )
  });
  sharedSherpaWorker = { configurationKey, worker };
  return worker;
}

export async function stopConfiguredSherpaSenseVoiceWorker(): Promise<void> {
  const current = sharedSherpaWorker;
  sharedSherpaWorker = undefined;
  await current?.worker.stop();
}

function parseReadiness(
  payload: Record<string, unknown>,
  expectedProviderId: string
): SttWorkerReadiness {
  if (payload.protocolVersion !== workerProtocolVersion) {
    throw protocolError(`Unsupported worker protocolVersion: ${String(payload.protocolVersion)}.`);
  }

  const providerId = stringField(payload, "providerId");
  if (providerId !== expectedProviderId) {
    throw protocolError(
      `Worker providerId ${providerId ?? "<missing>"} does not match ${expectedProviderId}.`
    );
  }

  const runtime = recordField(payload, "runtime");
  const artifacts = recordField(payload, "artifacts");
  const configuration = recordField(payload, "configuration");
  const model = recordField(artifacts, "model");
  const tokens = recordField(artifacts, "tokens");
  const runtimeName = stringField(runtime, "name");
  const runtimeVersion = stringField(runtime, "version");
  const language = stringField(configuration, "language");
  const executionProvider = stringField(configuration, "executionProvider");
  const threads = finiteNumberField(configuration, "threads");
  const loadMs = finiteNumberField(payload, "loadMs");

  if (
    !runtimeName ||
    !runtimeVersion ||
    !language ||
    !executionProvider ||
    threads === undefined ||
    !Number.isInteger(threads) ||
    threads < 1 ||
    loadMs === undefined ||
    loadMs < 0 ||
    typeof configuration.useItn !== "boolean"
  ) {
    throw protocolError("Worker readiness is missing runtime or configuration identity.");
  }

  const workerPid = finiteNumberField(payload, "workerPid");
  if (workerPid !== undefined && (!Number.isInteger(workerPid) || workerPid < 1)) {
    throw protocolError("Worker readiness has invalid workerPid.");
  }

  return {
    status: "ready",
    protocolVersion: workerProtocolVersion,
    providerId,
    runtime: {
      name: runtimeName,
      version: runtimeVersion
    },
    artifacts: {
      model: parseArtifact(model, "model"),
      tokens: parseArtifact(tokens, "tokens")
    },
    configuration: {
      language,
      threads,
      executionProvider,
      useItn: configuration.useItn
    },
    loadMs,
    ...(workerPid !== undefined ? { workerPid } : {})
  };
}

function parseArtifact(
  value: Record<string, unknown>,
  label: string
): SttWorkerArtifactIdentity {
  const name = stringField(value, "name");
  const sha256 = stringField(value, "sha256");
  const bytes = finiteNumberField(value, "bytes");

  if (
    !name ||
    !sha256 ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    bytes === undefined ||
    !Number.isInteger(bytes) ||
    bytes <= 0
  ) {
    throw protocolError(`Worker readiness has invalid ${label} artifact identity.`);
  }

  return { name, sha256, bytes };
}

function parseWorkerError(
  payload: Record<string, unknown>,
  fallback: string
): PersistentSttWorkerError {
  const error = recordField(payload, "error", false);
  const code = error ? stringField(error, "code") : undefined;
  const message = error ? stringField(error, "message") : undefined;
  return new PersistentSttWorkerError(
    "request_failed",
    `${code ? `${code}: ` : ""}${message || fallback}`
  );
}

function protocolError(message: string): PersistentSttWorkerError {
  return new PersistentSttWorkerError("protocol_error", message);
}

function recordField(
  record: Record<string, unknown>,
  field: string,
  required = true
): Record<string, unknown> {
  const value = record[field];
  if (isRecord(value)) {
    return value;
  }

  if (!required) {
    return {};
  }

  throw protocolError(`Worker message is missing ${field}.`);
}

function stringField(record: Record<string, unknown>, field: string): string | undefined {
  return typeof record[field] === "string" ? record[field] : undefined;
}

function finiteNumberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function boundedEnvironmentInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.round(parsed)))
    : fallback;
}

function truthyEnvironmentValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function cleanupPending(pending: PendingRequest): void {
  if (pending.handleAbort) {
    pending.signal?.removeEventListener("abort", pending.handleAbort);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Persistent STT request was cancelled.");
}

function clearTimer(timer?: ReturnType<typeof setTimeout>): void {
  if (timer) {
    clearTimeout(timer);
  }
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}
