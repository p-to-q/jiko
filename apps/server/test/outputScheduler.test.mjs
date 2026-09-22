import test from "node:test";
import assert from "node:assert/strict";

import { OutputScheduler } from "../dist/outputScheduler.js";

test("replacement aborts the old task and waits for its cleanup before starting", async () => {
  const scheduler = new OutputScheduler();
  const firstStarted = deferred();
  const firstAborted = deferred();
  const releaseFirst = deferred();
  const order = [];

  const firstCompletion = scheduler.schedule("first", async (signal) => {
    order.push("first:start");
    firstStarted.resolve();
    await waitForAbort(signal);
    order.push("first:abort");
    firstAborted.resolve();
    await releaseFirst.promise;
    order.push("first:end");
  });

  await firstStarted.promise;

  const secondCompletion = scheduler.schedule("second", async (signal) => {
    assert.equal(signal.aborted, false);
    order.push("second:start");
  });

  assert.equal(scheduler.activeKey, "second");
  assert.equal(scheduler.idle, false);
  await firstAborted.promise;
  assert.deepEqual(order, ["first:start", "first:abort"]);

  releaseFirst.resolve();
  const [firstOutcome, secondOutcome] = await Promise.all([
    firstCompletion,
    secondCompletion
  ]);

  assert.equal(firstOutcome.status, "cancelled");
  assert.equal(secondOutcome.status, "completed");
  assert.deepEqual(order, [
    "first:start",
    "first:abort",
    "first:end",
    "second:start"
  ]);
  assert.equal(scheduler.activeKey, undefined);
  assert.equal(scheduler.idle, true);
});

test("cancelActive aborts the active task and resolves idle waiters", async () => {
  const scheduler = new OutputScheduler();
  const started = deferred();
  const cancelReason = new Error("reset requested");

  const completion = scheduler.schedule("speech", async (signal) => {
    started.resolve();
    await waitForAbort(signal);
  });

  await started.promise;
  const idle = scheduler.waitForIdle();
  scheduler.cancelActive(cancelReason);

  const outcome = await completion;
  await idle;

  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.reason, cancelReason);
  assert.equal(scheduler.idle, true);
  scheduler.cancelActive();
});

test("key-scoped cancellation cannot abort another session's output", async () => {
  const scheduler = new OutputScheduler();
  const started = deferred();
  const expectedReason = new Error("matching attempt reset");
  const completion = scheduler.schedule("session-b:attempt-1", async (signal) => {
    started.resolve();
    await waitForAbort(signal);
  });

  await started.promise;
  assert.equal(
    scheduler.cancel("session-a:attempt-1", new Error("foreign reset")),
    false
  );
  assert.equal(scheduler.activeKey, "session-b:attempt-1");

  assert.equal(scheduler.cancel("session-b:attempt-1", expectedReason), true);
  const outcome = await completion;

  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.reason, expectedReason);
  assert.equal(scheduler.idle, true);
});

test("task failures become observable outcomes without leaking a rejection", async () => {
  const scheduler = new OutputScheduler();
  const expectedError = new Error("speaker failed");
  const unhandled = [];
  const handleUnhandled = (reason) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", handleUnhandled);

  try {
    const completion = scheduler.schedule("broken", async () => {
      throw expectedError;
    });

    await scheduler.waitForIdle();
    await immediate();
    const outcome = await completion;

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.error, expectedError);
    assert.deepEqual(unhandled, []);
    assert.equal(scheduler.idle, true);

    const recovery = await scheduler.schedule("recovery", async () => undefined);
    assert.equal(recovery.status, "completed");
  } finally {
    process.off("unhandledRejection", handleUnhandled);
  }
});

test("close cancels active output and rejects future scheduling", async () => {
  const scheduler = new OutputScheduler();
  const started = deferred();
  const reason = new Error("server shutdown");
  const active = scheduler.schedule("active", async (signal) => {
    started.resolve();
    await waitForAbort(signal);
  });

  await started.promise;
  scheduler.close(reason);

  const [activeOutcome, lateOutcome] = await Promise.all([
    active,
    scheduler.schedule("late", async () => {
      throw new Error("late output should not run");
    })
  ]);

  assert.equal(activeOutcome.status, "cancelled");
  assert.equal(activeOutcome.reason, reason);
  assert.equal(lateOutcome.status, "cancelled");
  assert.equal(lateOutcome.reason, reason);
  await scheduler.waitForIdle();
});

function waitForAbort(signal) {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal.addEventListener("abort", resolve, { once: true });
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}
