import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionRecord } from "./types.js";

const serverRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptDir = path.join(serverRoot, "sessions");

export class ReceiptWriter {
  readonly enabled: boolean;

  constructor(enabled = defaultReceiptState()) {
    this.enabled = enabled;
  }

  async write(session: SessionRecord): Promise<void> {
    if (!this.enabled) {
      return;
    }

    await mkdir(receiptDir, { recursive: true });
    const receipt = {
      sessionId: session.id,
      startedAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      source: session.source,
      input: {
        audio: session.uploadedAudio,
        audioStored: false,
        transcript: session.transcript?.text,
        language: session.transcript?.language
      },
      features: session.features,
      readings: session.readings,
      result: session.result,
      events: session.events
    };

    await writeFile(path.join(receiptDir, `${safeFilePart(session.id)}.json`), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  }
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
