import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PersistentSttWorker,
  PersistentSttWorkerError
} from "../dist/persistentSttWorker.js";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/fake-stt-worker.mjs"
);

test("persistent worker reuses one ready model and attributes artifact hashes", async () => {
  const worker = fakeWorker();

  try {
    const readiness = await worker.start();
    const first = await worker.transcribe({ audioPath: "first.wav" });
    const second = await worker.transcribe({ audioPath: "second.wav" });
    const repeatedReadiness = await worker.start();

    assert.equal(readiness.status, "ready");
    assert.equal(readiness.providerId, "local:test-persistent-stt");
    assert.equal(readiness.runtime.version, "1.0.0-test");
    assert.equal(readiness.artifacts.model.sha256, "a".repeat(64));
    assert.equal(readiness.artifacts.tokens.sha256, "b".repeat(64));
    assert.equal(repeatedReadiness.workerPid, readiness.workerPid);
    assert.equal(first.text, "fake transcript 1");
    assert.equal(second.text, "fake transcript 2");
    assert.deepEqual(first.artifacts, readiness.artifacts);
    assert.deepEqual(second.artifacts, readiness.artifacts);
  } finally {
    await worker.stop();
  }
});

test("readiness rejects a worker that omits the model hash", async () => {
  const worker = fakeWorker("invalid-readiness");

  try {
    await assert.rejects(
      worker.start(),
      (error) =>
        error instanceof PersistentSttWorkerError &&
        error.code === "protocol_error" &&
        /model artifact identity/.test(error.message)
    );
    await waitFor(() => worker.snapshot().status === "failed");
    assert.equal(worker.snapshot().status, "failed");
  } finally {
    await worker.stop();
  }
});

test("an aborted active request kills the worker and the next request starts a fresh generation", async () => {
  const worker = fakeWorker();
  const controller = new AbortController();

  try {
    const firstReadiness = await worker.start();
    const hanging = worker.transcribe({
      audioPath: "hang.wav",
      signal: controller.signal
    });
    const reason = new Error("attempt reset");
    controller.abort(reason);

    await assert.rejects(hanging, (error) => error === reason);
    const transcript = await worker.transcribe({ audioPath: "after-reset.wav" });
    const secondReadiness = worker.snapshot();

    assert.equal(transcript.text, "fake transcript 1");
    assert.equal(secondReadiness.status, "ready");
    assert.notEqual(secondReadiness.workerPid, firstReadiness.workerPid);
  } finally {
    await worker.stop();
  }
});

test("a worker crash rejects its active request and remains observable", async () => {
  const worker = fakeWorker();

  try {
    await assert.rejects(
      worker.transcribe({ audioPath: "crash.wav" }),
      (error) =>
        error instanceof PersistentSttWorkerError &&
        error.code === "worker_exited" &&
        /code=17/.test(error.message) &&
        /fake worker crash/.test(error.message)
    );
    assert.equal(worker.snapshot().status, "failed");
  } finally {
    await worker.stop();
  }
});

function fakeWorker(mode = "ready") {
  return new PersistentSttWorker({
    command: process.execPath,
    args: [fixture, mode],
    providerId: "local:test-persistent-stt",
    startupTimeoutMs: 1_000
  });
}

async function waitFor(predicate) {
  const expiresAt = performance.now() + 1_000;
  while (!predicate()) {
    if (performance.now() >= expiresAt) {
      throw new Error("condition not reached before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
