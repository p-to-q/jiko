import test from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SessionReceiptSchema } from "../../../packages/protocol/dist/index.js";
import {
  buildSessionReceipt,
  ReceiptIdentityReadError,
  ReceiptWriter
} from "../dist/receipts.js";

test("receipt distinguishes no STT, manual/mock input, timeout, and failure", () => {
  const none = buildSessionReceipt(makeSession("no-stt", 0, "created"));
  assert.equal(none.providers.stt, undefined);

  const manual = buildSessionReceipt({
    ...makeSession("manual-stt", 1, "result"),
    transcript: {
      text: "operator fixture",
      provider: "local:manual",
      latencyMs: 0
    }
  });
  assert.equal(manual.providers.stt?.outcome, "not_run");
  assert.equal(manual.providers.stt?.execution, undefined);

  for (const failureCode of ["timed_out", "failed"]) {
    const provider = `local:sherpa-onnx-sensevoice:${failureCode}`;
    const receipt = buildSessionReceipt({
      ...makeSession(`stt-${failureCode}`, 2, "processing"),
      transcript: {
        text: "",
        provider,
        failureCode,
        latencyMs: 30
      },
      sttProviderReceipt: {
        id: provider,
        latencyMs: 30,
        remote: false,
        outcome: failureCode,
        execution: sttExecutionIdentity()
      }
    });

    assert.equal(receipt.providers.stt?.outcome, failureCode);
    assert.equal(
      receipt.providers.stt?.execution?.artifacts.model.sha256,
      "a".repeat(64)
    );
  }
});

test("same-session writes commit in call order so reset cannot be overwritten by an older snapshot", async () => {
  const firstRenameStarted = deferred();
  const releaseFirstRename = deferred();
  let renameCount = 0;
  const storage = createMemoryStorage({
    async beforeRename() {
      renameCount += 1;
      if (renameCount === 1) {
        firstRenameStarted.resolve();
        await releaseFirstRename.promise;
      }
    }
  });
  const writer = createWriter(storage);

  const olderWrite = writer.write(makeSession("ordered", 7, "result"));
  await firstRenameStarted.promise;
  const resetWrite = writer.write(makeSession("ordered", 8, "reset"));

  await nextTurn();
  assert.equal(renameCount, 1, "the reset snapshot must wait for the older rename");

  releaseFirstRename.resolve();
  await Promise.all([olderWrite, resetWrite]);

  assert.equal(renameCount, 2);
  assert.deepEqual(readReceipt(storage, "ordered"), {
    lastSequence: 8,
    status: "reset"
  });
  assert.equal(writer.sessionWriteTails.size, 0);
});

test("different sessions persist in parallel", async () => {
  const sessionARenameStarted = deferred();
  const releaseSessionARename = deferred();
  const storage = createMemoryStorage({
    async beforeRename(_sourcePath, targetPath) {
      if (targetPath.endsWith("/session-a.json")) {
        sessionARenameStarted.resolve();
        await releaseSessionARename.promise;
      }
    }
  });
  const writer = createWriter(storage);

  const sessionAWrite = writer.write(makeSession("session-a", 1, "result"));
  await sessionARenameStarted.promise;
  const sessionBWrite = writer.write(makeSession("session-b", 1, "result"));

  await assert.doesNotReject(withTimeout(sessionBWrite, 1_000));
  assert.deepEqual(readReceipt(storage, "session-b"), {
    lastSequence: 1,
    status: "result"
  });

  releaseSessionARename.resolve();
  await sessionAWrite;
  assert.equal(writer.sessionWriteTails.size, 0);
});

test("a failed write rejects only its caller and does not block the next snapshot", async () => {
  let renameCount = 0;
  const storage = createMemoryStorage({
    async beforeRename() {
      renameCount += 1;
      if (renameCount === 1) {
        throw new Error("simulated first rename failure");
      }
    }
  });
  const writer = createWriter(storage);

  const failedWrite = writer.write(makeSession("recovering", 3, "result"));
  const laterWrite = writer.write(makeSession("recovering", 4, "reset"));

  await assert.rejects(failedWrite, /simulated first rename failure/);
  await assert.doesNotReject(laterWrite);
  assert.deepEqual(readReceipt(storage, "recovering"), {
    lastSequence: 4,
    status: "reset"
  });
  assert.equal(renameCount, 2);
  assert.equal(writer.sessionWriteTails.size, 0);
});

test("default receipt storage prunes old and excess files within hard budgets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-receipt-retention-"));
  let nowMs = 10_000;
  const writer = new ReceiptWriter(true, {
    directory,
    maxFiles: 2,
    maxFileBytes: 64 * 1024,
    maxTotalBytes: 128 * 1024,
    retentionMs: 1_000,
    now: () => nowMs
  });

  try {
    await writer.write(makeSession("expired", 1, "result"));
    await utimes(path.join(directory, "expired.json"), 0, 0);
    await writer.write(makeSession("kept-one", 1, "result"));
    await writer.write(makeSession("kept-two", 1, "result"));

    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith(".json")).sort(),
      ["kept-one.json", "kept-two.json"]
    );
    assert.equal(
      (await readdir(directory)).some((name) => name.endsWith(".tmp")),
      false
    );

    await utimes(path.join(directory, "kept-one.json"), 0, 0);
    await utimes(path.join(directory, "kept-two.json"), 0, 0);
    nowMs += 2_000;
    await writer.write(makeSession("fresh", 1, "result"));
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith(".json")),
      ["fresh.json"]
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("default receipt storage corrects existing directory and final file permissions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-receipt-mode-"));
  const targetPath = path.join(directory, "private.json");
  const writer = new ReceiptWriter(true, { directory });

  try {
    await chmod(directory, 0o777);
    await writer.write(makeSession("private", 1, "result"));

    assert.equal(permissionBits(await stat(directory)), 0o700);
    assert.equal(permissionBits(await stat(targetPath)), 0o600);

    await chmod(directory, 0o755);
    await chmod(targetPath, 0o666);
    await writer.write(makeSession("private", 2, "reset"));

    assert.equal(permissionBits(await stat(directory)), 0o700);
    assert.equal(permissionBits(await stat(targetPath)), 0o600);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("receipt temp file is private before its atomic rename", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-receipt-temp-mode-"));
  let tempMode;
  const writer = new ReceiptWriter(true, {
    directory,
    fileOperations: createInspectableFilesystemOperations(async (sourcePath) => {
      tempMode = permissionBits(await stat(sourcePath));
    })
  });

  try {
    await chmod(directory, 0o777);
    await writer.write(makeSession("private-temp", 1, "result"));

    assert.equal(tempMode, 0o600);
    assert.equal(permissionBits(await stat(directory)), 0o700);
    assert.equal(
      permissionBits(await stat(path.join(directory, "private-temp.json"))),
      0o600
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("receipt identity lookup is strict, bounded, and disabled explicitly", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-receipt-identity-"));
  const writer = new ReceiptWriter(true, { directory });

  try {
    assert.equal(await writer.lookupSessionIdentity("missing"), undefined);
    await writer.write(makeSession("persisted-owner", 1, "created"));

    const restartedWriter = new ReceiptWriter(true, { directory });
    assert.deepEqual(
      await restartedWriter.lookupSessionIdentity("persisted-owner"),
      {
        sessionId: "persisted-owner",
        attemptId: "attempt-persisted-owner",
        source: "browser",
        updatedAt: "2026-09-17T00:00:01.000Z"
      }
    );
    assert.equal(
      await new ReceiptWriter(false, { directory }).lookupSessionIdentity(
        "persisted-owner"
      ),
      undefined
    );

    await writeFile(
      path.join(directory, "persisted-owner.json"),
      "{\"schemaVersion\":\"session_receipt_v1\"}",
      "utf8"
    );
    await assert.rejects(
      restartedWriter.lookupSessionIdentity("persisted-owner"),
      (error) =>
        error instanceof ReceiptIdentityReadError &&
        error.code === "session_identity_check_failed" &&
        error.sessionId === "persisted-owner"
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("receipt writer rejects an oversized snapshot before writing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "jiko-receipt-size-"));
  const writer = new ReceiptWriter(true, {
    directory,
    maxFiles: 1,
    maxFileBytes: 32,
    maxTotalBytes: 32,
    retentionMs: 1_000
  });

  try {
    await assert.rejects(
      writer.write(makeSession("too-large", 1, "result")),
      /exceeds the configured 32 byte file limit/
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

function createWriter(storage) {
  return new ReceiptWriter(true, {
    directory: "/receipts",
    fileOperations: storage.operations
  });
}

function createMemoryStorage({ beforeRename = async () => undefined } = {}) {
  const files = new Map();

  return {
    files,
    operations: {
      async mkdir() {},
      async chmod() {},
      async writeFile(filePath, contents) {
        files.set(filePath, contents);
      },
      async rename(sourcePath, targetPath) {
        await beforeRename(sourcePath, targetPath);
        const contents = files.get(sourcePath);
        assert.notEqual(
          contents,
          undefined,
          `missing temporary receipt ${sourcePath}`
        );
        files.set(targetPath, contents);
        files.delete(sourcePath);
      },
      async rm(filePath) {
        files.delete(filePath);
      }
    }
  };
}

function createInspectableFilesystemOperations(beforeRename) {
  return {
    async mkdir(directory, mode) {
      await mkdir(directory, { recursive: true, mode });
    },
    async chmod(filePath, mode) {
      await chmod(filePath, mode);
    },
    async writeFile(filePath, contents, mode) {
      await writeFile(filePath, contents, {
        encoding: "utf8",
        flag: "wx",
        mode
      });
    },
    async rename(sourcePath, targetPath) {
      await beforeRename(sourcePath, targetPath);
      await rename(sourcePath, targetPath);
    },
    async rm(filePath) {
      await rm(filePath, { force: true });
    }
  };
}

function permissionBits(metadata) {
  return metadata.mode & 0o777;
}

function readReceipt(storage, sessionId) {
  const contents = storage.files.get(`/receipts/${sessionId}.json`);
  assert.equal(typeof contents, "string");
  const receipt = SessionReceiptSchema.parse(JSON.parse(contents));
  return {
    lastSequence: receipt.lastSequence,
    status: receipt.status
  };
}

function makeSession(id, lastSequence, status) {
  return {
    id,
    attemptId: `attempt-${id}`,
    lastSequence,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: `2026-09-17T00:00:0${lastSequence}.000Z`,
    status,
    source: "browser",
    events: []
  };
}

function sttExecutionIdentity() {
  return {
    runtime: {
      name: "fake-stt",
      version: "1.0.0-test"
    },
    configuration: {
      language: "auto",
      threads: 1,
      executionProvider: "cpu",
      useItn: false
    },
    artifacts: {
      model: {
        name: "fake-model.onnx",
        sha256: "a".repeat(64),
        bytes: 123
      },
      tokens: {
        name: "fake-tokens.txt",
        sha256: "b".repeat(64),
        bytes: 45
      }
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function withTimeout(promise, timeoutMs) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("operation timed out")), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeout));
}
