import test from "node:test";
import assert from "node:assert/strict";

import { AttemptWorkRegistry } from "../dist/attemptWork.js";

test("attempt work leases are token-safe when an older lease finishes late", () => {
  const registry = new AttemptWorkRegistry();
  const first = registry.begin("session", "attempt");
  const second = registry.begin("session", "attempt");

  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(registry.has("session", "attempt"), true);

  first.finish();
  assert.equal(registry.has("session", "attempt"), true);

  const reason = new Error("reset committed");
  assert.equal(registry.cancel("session", "attempt", reason), true);
  assert.equal(second.signal.aborted, true);
  assert.strictEqual(second.signal.reason, reason);
  assert.equal(registry.activeCount, 1);

  second.finish();
  assert.equal(registry.activeCount, 0);
});

test("closing aborts active work and rejects future leases", () => {
  const registry = new AttemptWorkRegistry();
  const active = registry.begin("session-a", "attempt-a");
  const reason = new Error("server shutdown");

  registry.close(reason);
  const late = registry.begin("session-b", "attempt-b");

  assert.equal(active.signal.aborted, true);
  assert.strictEqual(active.signal.reason, reason);
  assert.equal(late.signal.aborted, true);
  assert.strictEqual(late.signal.reason, reason);
  assert.equal(registry.activeCount, 1);

  active.finish();
  late.finish();
  assert.equal(registry.activeCount, 0);
});
