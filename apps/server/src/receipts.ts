import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SessionReceiptSchema,
  type SessionReceipt,
  type SttProviderReceipt,
  type TranscriptResult
} from "@jiko/protocol";
import type { SessionRecord } from "./types.js";

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptDir = path.join(serverRoot, "sessions");

type ReceiptFileOperations = {
  mkdir(directory: string, mode: number): Promise<void>;
  chmod(filePath: string, mode: number): Promise<void>;
  writeFile(filePath: string, contents: string, mode: number): Promise<void>;
  rename(sourcePath: string, targetPath: string): Promise<void>;
  rm(filePath: string): Promise<void>;
  readFile?(filePath: string, maxBytes: number): Promise<string>;
  listFiles?(directory: string): Promise<ReceiptFileEntry[]>;
};

type ReceiptFileEntry = {
  filePath: string;
  name: string;
  bytes: number;
  mtimeMs: number;
};

type ReceiptWriterOptions = {
  directory?: string;
  fileOperations?: ReceiptFileOperations;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  retentionMs?: number;
  now?: () => number;
};

const defaultFileOperations: ReceiptFileOperations = {
  async mkdir(directory, mode) {
    const mkdirWithMode = mkdir as unknown as (
      target: string,
      options: { recursive: boolean; mode: number }
    ) => Promise<void>;
    await mkdirWithMode(directory, { recursive: true, mode });
  },
  async chmod(filePath, mode) {
    await chmod(filePath, mode);
  },
  async writeFile(filePath, contents, mode) {
    const writeFileWithMode = writeFile as unknown as (
      target: string,
      data: string,
      options: { encoding: "utf8"; flag: "wx"; mode: number }
    ) => Promise<void>;
    await writeFileWithMode(filePath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode
    });
  },
  async rename(sourcePath, targetPath) {
    await rename(sourcePath, targetPath);
  },
  async rm(filePath) {
    await rm(filePath, { force: true });
  },
  async readFile(filePath, maxBytes) {
    const handle = await open(filePath, "r");
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > maxBytes) {
        throw new Error("Receipt identity file exceeds its configured read boundary");
      }

      const bytes = Buffer.alloc(metadata.size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await handle.read(
          bytes,
          offset,
          bytes.byteLength - offset,
          offset
        );
        if (result.bytesRead === 0) {
          throw new Error("Receipt identity file changed during its bounded read");
        }
        offset += result.bytesRead;
      }
      const extra = Buffer.alloc(1);
      const extraRead = await handle.read(extra, 0, 1, offset);
      if (extraRead.bytesRead !== 0) {
        throw new Error("Receipt identity file changed during its bounded read");
      }
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      await handle.close();
    }
  },
  async listFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: ReceiptFileEntry[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      const metadata = await stat(filePath);
      files.push({
        filePath,
        name: entry.name,
        bytes: metadata.size,
        mtimeMs: metadata.mtimeMs
      });
    }
    return files;
  }
};

export type PersistedSessionIdentity = {
  sessionId: string;
  attemptId: string;
  source: SessionReceipt["source"];
  updatedAt: string;
};

export class ReceiptIdentityReadError extends Error {
  readonly code = "session_identity_check_failed";

  constructor(readonly sessionId: string) {
    super(`Persisted session identity could not be verified: ${sessionId}`);
    this.name = "ReceiptIdentityReadError";
  }
}

export class ReceiptWriter {
  readonly enabled: boolean;
  private readonly directory: string;
  private readonly fileOperations: ReceiptFileOperations;
  private readonly sessionWriteTails = new Map<string, Promise<void>>();
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private maintenanceTail: Promise<void> = Promise.resolve();

  constructor(
    enabled = defaultReceiptState(),
    options: ReceiptWriterOptions = {}
  ) {
    this.enabled = enabled;
    this.directory = options.directory ?? receiptDir;
    this.fileOperations = options.fileOperations ?? defaultFileOperations;
    this.maxFiles = resolvedPositiveInteger(
      options.maxFiles,
      configuredPositiveInteger("JIKO_RECEIPT_MAX_FILES") ?? 512,
      "maxFiles"
    );
    this.maxFileBytes = resolvedPositiveInteger(
      options.maxFileBytes,
      configuredPositiveInteger("JIKO_RECEIPT_MAX_FILE_BYTES") ?? 1_048_576,
      "maxFileBytes"
    );
    this.maxTotalBytes = resolvedPositiveInteger(
      options.maxTotalBytes,
      configuredPositiveInteger("JIKO_RECEIPT_MAX_TOTAL_BYTES") ?? 67_108_864,
      "maxTotalBytes"
    );
    this.retentionMs = resolvedPositiveInteger(
      options.retentionMs,
      configuredPositiveInteger("JIKO_RECEIPT_RETENTION_MS") ?? 604_800_000,
      "retentionMs"
    );
    this.now = options.now ?? Date.now;
    if (this.maxFileBytes > this.maxTotalBytes) {
      throw new Error("Receipt maxFileBytes cannot exceed maxTotalBytes");
    }
  }

  async write(session: SessionRecord): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const receipt = buildSessionReceipt(session);
    // Serialize before the first await so later events cannot leak into an
    // earlier sequence's persisted snapshot through mutable object references.
    const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
    const serializedBytes = Buffer.byteLength(serialized, "utf8");
    if (serializedBytes > this.maxFileBytes || serializedBytes > this.maxTotalBytes) {
      throw new Error(
        `Session receipt exceeds the configured ${this.maxFileBytes} byte file limit`
      );
    }
    const targetPath = path.join(
      this.directory,
      `${safeFilePart(session.id)}.json`
    );
    const tempPath = `${targetPath}.${randomUUID()}.tmp`;

    const previousTail =
      this.sessionWriteTails.get(session.id) ?? Promise.resolve();
    const writeAttempt = previousTail.then(async () => {
      await this.persistReceipt(targetPath, tempPath, serialized);
      await this.schedulePrune(targetPath);
    });
    // A failed write must reject its own caller without poisoning later writes
    // for the same session.
    const recoveredTail = writeAttempt.catch(() => undefined);
    this.sessionWriteTails.set(session.id, recoveredTail);

    try {
      await writeAttempt;
    } finally {
      if (this.sessionWriteTails.get(session.id) === recoveredTail) {
        this.sessionWriteTails.delete(session.id);
      }
    }
  }

  async lookupSessionIdentity(
    sessionId: string
  ): Promise<PersistedSessionIdentity | undefined> {
    if (!this.enabled) {
      return undefined;
    }
    if (!isSafeSessionId(sessionId)) {
      throw new ReceiptIdentityReadError(sessionId);
    }

    const readFile = this.fileOperations.readFile;
    if (!readFile) {
      throw new ReceiptIdentityReadError(sessionId);
    }

    const targetPath = path.join(this.directory, `${sessionId}.json`);
    let serialized: string;
    try {
      serialized = await readFile(targetPath, this.maxFileBytes);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") {
        return undefined;
      }
      throw new ReceiptIdentityReadError(sessionId);
    }

    try {
      const receipt = SessionReceiptSchema.parse(JSON.parse(serialized));
      if (receipt.sessionId !== sessionId) {
        throw new Error("Receipt identity does not match its filename");
      }
      return {
        sessionId: receipt.sessionId,
        attemptId: receipt.attemptId,
        source: receipt.source,
        updatedAt: receipt.updatedAt
      };
    } catch {
      throw new ReceiptIdentityReadError(sessionId);
    }
  }

  private schedulePrune(protectedPath: string): Promise<void> {
    if (!this.fileOperations.listFiles) {
      return Promise.resolve();
    }
    const maintenance = this.maintenanceTail.then(() =>
      this.pruneReceiptFiles(protectedPath)
    );
    this.maintenanceTail = maintenance.catch(() => undefined);
    return maintenance;
  }

  private async pruneReceiptFiles(protectedPath: string): Promise<void> {
    const listFiles = this.fileOperations.listFiles;
    if (!listFiles) {
      return;
    }
    const nowMs = this.now();
    const entries = await listFiles(this.directory);
    for (const entry of entries) {
      if (entry.name.endsWith(".tmp") && nowMs - entry.mtimeMs >= 3_600_000) {
        await this.fileOperations.rm(entry.filePath);
      }
    }

    const receipts = entries
      .filter((entry) => entry.name.endsWith(".json"))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    const retained: ReceiptFileEntry[] = [];
    for (const entry of receipts) {
      if (
        entry.filePath !== protectedPath &&
        nowMs - entry.mtimeMs >= this.retentionMs
      ) {
        await this.fileOperations.rm(entry.filePath);
      } else {
        retained.push(entry);
      }
    }

    let totalBytes = retained.reduce((sum, entry) => sum + entry.bytes, 0);
    let totalFiles = retained.length;
    for (const entry of [...retained].reverse()) {
      if (totalFiles <= this.maxFiles && totalBytes <= this.maxTotalBytes) {
        break;
      }
      if (entry.filePath === protectedPath) {
        continue;
      }
      await this.fileOperations.rm(entry.filePath);
      totalFiles -= 1;
      totalBytes -= entry.bytes;
    }
    if (totalFiles > this.maxFiles || totalBytes > this.maxTotalBytes) {
      throw new Error("Receipt retention could not satisfy the configured disk budget");
    }
  }

  private async persistReceipt(
    targetPath: string,
    tempPath: string,
    serialized: string
  ): Promise<void> {
    await this.fileOperations.mkdir(this.directory, 0o700);
    // mkdir's mode only applies to newly-created directories. Correct an
    // existing receipt directory as well so private data never inherits a
    // permissive deployment or developer umask.
    await this.fileOperations.chmod(this.directory, 0o700);
    try {
      await this.fileOperations.writeFile(tempPath, serialized, 0o600);
      await this.fileOperations.chmod(tempPath, 0o600);
      await this.fileOperations.rename(tempPath, targetPath);
      await this.fileOperations.chmod(targetPath, 0o600);
    } finally {
      await this.fileOperations.rm(tempPath);
    }
  }
}

export function buildSessionReceipt(session: SessionRecord): SessionReceipt {
  return SessionReceiptSchema.parse({
    schemaVersion: "session_receipt_v1",
    sessionId: session.id,
    attemptId: session.attemptId,
    lastSequence: session.lastSequence,
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    source: session.source,
    input: {
      audio: session.uploadedAudio,
      normalizedAudio: session.normalizedAudio,
      orderedPcm: session.orderedPcm,
      audioStored: false
    },
    providers: {
      stt: session.sttProviderReceipt ??
        fallbackSttProviderReceipt(session.transcript),
      tts: latestTtsProvider(session)
    },
    transcript: session.transcript,
    pipeline: session.pipeline,
    features: session.features,
    readings: session.readings,
    result: session.result,
    events: session.events,
    errors: session.events.flatMap((event) =>
      event.type === "session.error" ? [event.message] : []
    )
  });
}

function fallbackSttProviderReceipt(
  transcript?: TranscriptResult
): SttProviderReceipt | undefined {
  if (!transcript) {
    return undefined;
  }

  return {
    id: transcript.provider,
    latencyMs: transcript.latencyMs,
    remote: false,
    outcome: transcript.failureCode ??
      (transcript.provider === "local:manual" ? "not_run" : "completed")
  };
}

function latestTtsProvider(session: SessionRecord) {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index];
    if (event.type === "tts.finished") {
      return event.provider;
    }
  }

  return undefined;
}

function defaultReceiptState(): boolean {
  const explicit = process.env.JIKO_WRITE_RECEIPTS;
  if (explicit === "0" || explicit === "false") {
    return false;
  }

  if (explicit === "1" || explicit === "true") {
    return true;
  }

  return process.env.NODE_ENV !== "production";
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function isSafeSessionId(value: string): boolean {
  return value.length >= 1 &&
    value.length <= 96 &&
    value !== "." &&
    value !== ".." &&
    /^[a-zA-Z0-9._:-]+$/.test(value);
}

function nodeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function configuredPositiveInteger(name: string): number | undefined {
  const configured = process.env[name];
  if (configured === undefined) {
    return undefined;
  }
  const rawValue = configured.trim();
  const parsed = Number(rawValue);
  if (!rawValue || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function resolvedPositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}
