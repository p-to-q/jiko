import test from "node:test";
import assert from "node:assert/strict";

import {
  StreamingSttContractError,
  StreamingSttDeadlineError,
  StreamingSttScheduler
} from "../dist/streamingStt.js";
import {
  createFakeStreamingSttAdapter,
  deferred,
  fakeStreamingChunk,
  fakeStreamingFinish,
  fakeStreamingIdentity,
  fakeStreamingProfile
} from "./fixtures/fake-streaming-stt-adapter.mjs";

test("streaming STT contract keeps partials observer-only and returns one coverage-checked final", async () => {
  const fake = createFakeStreamingSttAdapter({
    finalText: "the immutable final",
    partialText: (_chunk, revision) => `replaceable ${revision}`
  });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const partials = [];
  const attempt = scheduler.open(openInput({
    onPartial: (partial) => partials.push(partial)
  }));

  attempt.push(fakeStreamingChunk(1));
  attempt.push(fakeStreamingChunk(2));
  const final = await attempt.finish(fakeStreamingFinish(2));

  assert.deepEqual(partials.map((partial) => partial.text), [
    "replaceable 1",
    "replaceable 2"
  ]);
  assert.equal(partials.every((partial) => partial.type === "partial"), true);
  assert.equal(final.transcript.text, "the immutable final");
  assert.equal(final.transcript.provider, "local:fake-streaming-stt");
  assert.equal(final.providerReceipt.outcome, "completed");
  assert.equal(final.finalSequence, 2);
  assert.equal(final.partialRevisionCount, 2);
  assert.equal(final.pushedChunkCount, 2);
  assert.equal(final.pushedByteCount, 8);
  assert.equal(attempt.phase, "completed");
  assert.equal(scheduler.activeCount, 0);
  assert.deepEqual(fake.calls.pushes.map((chunk) => chunk.sequence), [1, 2]);
  assert.equal(fake.calls.finishes.length, 1);
});

test("streaming STT final cannot be inferred from the latest partial", async () => {
  const fake = createFakeStreamingSttAdapter({ finishWithoutFinal: true });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const partials = [];
  const attempt = scheduler.open(openInput({
    onPartial: (partial) => partials.push(partial)
  }));
  attempt.push(fakeStreamingChunk(1));

  await assert.rejects(
    attempt.finish(fakeStreamingFinish(1)),
    (error) =>
      error instanceof StreamingSttContractError &&
      error.code === "finish_without_final"
  );
  assert.equal(partials.length, 1);
  assert.equal(attempt.phase, "failed");
  assert.equal(scheduler.activeCount, 0);
});

test("streaming STT drains accepted PCM before stop flush and finalization", async () => {
  const pushGate = deferred();
  const fake = createFakeStreamingSttAdapter({ pushGate });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const attempt = scheduler.open(openInput());
  attempt.push(fakeStreamingChunk(1));
  const finishing = attempt.finish(fakeStreamingFinish(1));

  await waitFor(() => fake.calls.pushes.length === 1);
  assert.equal(fake.calls.finishes.length, 0);
  pushGate.resolve();
  const final = await finishing;

  assert.equal(fake.calls.finishes.length, 1);
  assert.equal(final.finalSequence, 1);
});

test("streaming STT rejects a final emitted before stop flush begins", async () => {
  const pushGate = deferred();
  const fake = createFakeStreamingSttAdapter({ pushGate });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const attempt = scheduler.open(openInput());
  attempt.push(fakeStreamingChunk(1));
  const finishing = attempt.finish(fakeStreamingFinish(1));

  await waitFor(() => fake.calls.pushes.length === 1);
  assert.equal(fake.calls.finishes.length, 0);
  assert.throws(
    () => fake.emit({
      ...fakeStreamingIdentity,
      type: "final",
      finalSequence: 1,
      text: "too early"
    }),
    (error) =>
      error instanceof StreamingSttContractError &&
      error.code === "lifecycle_violation"
  );
  pushGate.resolve();
  await assert.rejects(finishing, { name: "StreamingSttContractError" });
  assert.equal(attempt.phase, "failed");
});

test("streaming STT rejects a provider that emits more than one final", async () => {
  const fake = createFakeStreamingSttAdapter({ duplicateFinal: true });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const attempt = scheduler.open(openInput());
  attempt.push(fakeStreamingChunk(1));

  await assert.rejects(
    attempt.finish(fakeStreamingFinish(1)),
    (error) =>
      error instanceof StreamingSttContractError &&
      error.code === "duplicate_final"
  );
  assert.equal(attempt.phase, "failed");
});

test("streaming STT rejects foreign attempt events and never exposes them", async () => {
  const fake = createFakeStreamingSttAdapter({
    finalIdentity: { attemptId: "foreign-attempt" }
  });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const partials = [];
  const attempt = scheduler.open(openInput({
    onPartial: (partial) => partials.push(partial)
  }));
  attempt.push(fakeStreamingChunk(1));

  await assert.rejects(
    attempt.finish(fakeStreamingFinish(1)),
    (error) =>
      error instanceof StreamingSttContractError &&
      error.code === "attempt_identity_mismatch"
  );
  assert.equal(partials.length, 1);
  assert.equal(attempt.phase, "failed");
});

test("streaming STT enforces bounded partial output", async () => {
  const fake = createFakeStreamingSttAdapter({
    partialText: () => "oversized"
  });
  const scheduler = new StreamingSttScheduler(fake.adapter, {
    maxTranscriptBytes: 4
  });
  const attempt = scheduler.open(openInput());
  attempt.push(fakeStreamingChunk(1));

  await assert.rejects(
    attempt.finish(fakeStreamingFinish(1)),
    (error) =>
      error instanceof StreamingSttContractError &&
      error.code === "output_capacity_exceeded"
  );
  assert.equal(attempt.phase, "failed");
});

test("streaming STT queue fails closed instead of dropping PCM", async () => {
  const pushGate = deferred();
  const fake = createFakeStreamingSttAdapter({ pushGate });
  const scheduler = new StreamingSttScheduler(fake.adapter, {
    maxQueuedChunks: 1,
    maxQueuedPcmBytes: 4
  });
  const attempt = scheduler.open(openInput());
  attempt.push(fakeStreamingChunk(1));

  assert.throws(
    () => attempt.push(fakeStreamingChunk(2)),
    (error) =>
      error instanceof StreamingSttContractError &&
      error.code === "queue_capacity_exceeded"
  );
  pushGate.resolve();
  assert.equal(attempt.phase, "failed");
  assert.ok(fake.calls.pushes.length <= 1);
  assert.equal(scheduler.activeCount, 0);
});

test("streaming STT deadline rejects a provider that ignores finalization", async () => {
  const finishGate = deferred();
  const fake = createFakeStreamingSttAdapter({ finishGate });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const attempt = scheduler.open(openInput({
    expiresAtMs: performance.now() + 40
  }));
  attempt.push(fakeStreamingChunk(1));

  await assert.rejects(
    within(attempt.finish(fakeStreamingFinish(1)), 1_000),
    (error) => error instanceof StreamingSttDeadlineError
  );
  assert.equal(attempt.phase, "timed_out");
  finishGate.resolve();
  await waitFor(() => fake.calls.cancellations.length === 1);
});

test("streaming STT rejects an overdue final even while the deadline timer is event-loop blocked", async () => {
  const finishGate = deferred();
  const fake = createFakeStreamingSttAdapter({ finishGate });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const expiresAtMs = performance.now() + 500;
  const attempt = scheduler.open(openInput({ expiresAtMs }));
  attempt.push(fakeStreamingChunk(1));
  const finishing = attempt.finish(fakeStreamingFinish(1));

  await waitFor(() => fake.calls.finishes.length === 1);
  assert.equal(attempt.phase, "finishing");
  assert.ok(performance.now() < expiresAtMs, "provider finish must begin before the deadline");

  const remainingMs = Math.max(1, Math.ceil(expiresAtMs - performance.now()) + 25);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remainingMs);
  finishGate.resolve();

  await assert.rejects(
    within(finishing, 1_000),
    (error) => error instanceof StreamingSttDeadlineError
  );
  assert.equal(attempt.phase, "timed_out");
  assert.equal(scheduler.activeCount, 0);
});

test("cancellation reaches a still-opening adapter and suppresses late partials", async () => {
  const openGate = deferred();
  const fake = createFakeStreamingSttAdapter({ openGate });
  const scheduler = new StreamingSttScheduler(fake.adapter);
  const partials = [];
  const controller = new AbortController();
  const attempt = scheduler.open(openInput({
    signal: controller.signal,
    onPartial: (partial) => partials.push(partial)
  }));

  const reason = new Error("attempt reset");
  await waitFor(() => fake.calls.opens.length === 1);
  controller.abort(reason);
  assert.equal(attempt.phase, "cancelled");
  assert.equal(scheduler.activeCount, 0);
  openGate.resolve();
  await waitFor(() => fake.calls.cancellations.length === 1);
  assert.strictEqual(fake.calls.cancellations[0], reason);
  assert.throws(
    () => fake.emit({
      ...fakeStreamingIdentity,
      type: "partial",
      revision: 1,
      coverageSequence: 0,
      text: "late"
    }),
    (error) => error === reason
  );
  assert.throws(
    () => fake.emit({
      ...fakeStreamingIdentity,
      type: "final",
      finalSequence: 0,
      text: "late final"
    }),
    (error) => error === reason
  );
  assert.deepEqual(partials, []);
});

test("remote streaming STT is closed unless this attempt explicitly authorizes audio egress", () => {
  const fake = createFakeStreamingSttAdapter({ remote: true });
  const scheduler = new StreamingSttScheduler(fake.adapter);

  assert.throws(
    () => scheduler.open(openInput()),
    (error) =>
      error instanceof StreamingSttContractError &&
      error.code === "remote_audio_not_authorized"
  );
  assert.equal(fake.calls.opens.length, 0);
});

function openInput(overrides = {}) {
  return {
    identity: fakeStreamingIdentity,
    pcmProfile: fakeStreamingProfile,
    expiresAtMs: performance.now() + 5_000,
    ...overrides
  };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const expiresAt = performance.now() + timeoutMs;
  while (performance.now() < expiresAt) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true before timeout");
}

async function within(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("streaming STT test timed out")),
          timeoutMs
        );
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
