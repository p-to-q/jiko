import test from "node:test";
import assert from "node:assert/strict";

import {
  AttemptDeadlineRegistry,
  SessionDeadlineExceededError
} from "../dist/attemptDeadline.js";

test("an attempt deadline cannot be extended by a later caller", async () => {
  const deadlines = new AttemptDeadlineRegistry(40);
  const startedAtMs = performance.now();
  let resolveExpired;
  const expired = new Promise((resolve) => {
    resolveExpired = resolve;
  });

  const first = deadlines.ensure("session-a", "attempt-a", startedAtMs, (error) => {
    resolveExpired(error);
  });
  const second = deadlines.ensure(
    "session-a",
    "attempt-a",
    startedAtMs + 60_000,
    () => {
      throw new Error("replacement deadline must not run");
    }
  );

  assert.equal(second.startedAtMs, first.startedAtMs);
  assert.equal(second.expiresAtMs, first.expiresAtMs);
  const error = await within(expired, 1_000);
  assert.ok(error instanceof SessionDeadlineExceededError);
  assert.equal(error.timeoutMs, 40);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.signal.reason, error);
  assert.equal(deadlines.activeCount, 0);
});

test("cancelling a deadline aborts observers and suppresses expiration", async () => {
  const deadlines = new AttemptDeadlineRegistry(30);
  let expirationCount = 0;
  const deadline = deadlines.ensure(
    "session-b",
    "attempt-b",
    performance.now(),
    () => {
      expirationCount += 1;
    }
  );
  const reason = new Error("result committed");

  assert.equal(deadlines.cancel("session-b", "attempt-b", reason), true);
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.signal.reason, reason);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(expirationCount, 0);
  assert.equal(deadlines.activeCount, 0);
});

test("closing aborts active deadlines and rejects future scheduling", () => {
  const deadlines = new AttemptDeadlineRegistry(5_000);
  const active = deadlines.ensure(
    "session-c",
    "attempt-c",
    performance.now(),
    () => undefined
  );
  const reason = new Error("server shutdown");

  deadlines.close(reason);
  const future = deadlines.ensure(
    "session-d",
    "attempt-d",
    performance.now(),
    () => undefined
  );

  assert.equal(active.signal.aborted, true);
  assert.equal(active.signal.reason, reason);
  assert.equal(future.signal.aborted, true);
  assert.equal(future.signal.reason, reason);
  assert.equal(deadlines.activeCount, 0);
});

test("a delayed timer cannot let overdue work pass a commit boundary", () => {
  const deadlines = new AttemptDeadlineRegistry(10);
  const order = [];
  const deadline = deadlines.ensure(
    "session-overdue",
    "attempt-overdue",
    performance.now() - 20,
    () => {
      order.push("sealed");
    }
  );

  const error = deadlines.expireIfDue("session-overdue", "attempt-overdue");

  assert.ok(error instanceof SessionDeadlineExceededError);
  assert.deepEqual(order, ["sealed"]);
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.signal.reason, error);
  assert.equal(deadlines.activeCount, 0);
});

async function within(promise, timeoutMs) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("deadline test timed out")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
