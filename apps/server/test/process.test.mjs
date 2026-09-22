import test from "node:test";
import assert from "node:assert/strict";

import {
  ProcessAbortError,
  ProcessOutputLimitError,
  ProcessTimeoutError,
  runProcess
} from "../dist/process.js";

test("local provider processes are terminated at their deadline", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 25
    }),
    ProcessTimeoutError
  );
});

test("local provider processes are terminated when their owning turn is cancelled", async () => {
  const controller = new AbortController();
  const running = runProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal }
  );

  controller.abort();
  await assert.rejects(running, ProcessAbortError);
});

test("provider stdin failures reject instead of crashing the process", async () => {
  await assert.rejects(
    runProcess(process.execPath, ["-e", "process.exit(0)"], {
      stdin: "x".repeat(10_000_000),
      timeoutMs: 1_000
    })
  );
});

test("provider process output is bounded per stream", async () => {
  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(64 * 1024)); setInterval(() => {}, 1000)"],
      { maxOutputBytes: 1_024, timeoutMs: 1_000 }
    ),
    (error) =>
      error instanceof ProcessOutputLimitError &&
      /stdout exceeded 1024 bytes/.test(error.message)
  );
});
