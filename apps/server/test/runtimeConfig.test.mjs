import test from "node:test";
import assert from "node:assert/strict";

import { resolveServerHost } from "../dist/runtimeConfig.js";

test("server host defaults to loopback when HOST is missing or blank", () => {
  assert.equal(resolveServerHost(undefined), "127.0.0.1");
  assert.equal(resolveServerHost(""), "127.0.0.1");
  assert.equal(resolveServerHost(" \t "), "127.0.0.1");
});

test("server host preserves an explicit trimmed deployment choice", () => {
  assert.equal(resolveServerHost(" 127.0.0.1 "), "127.0.0.1");
  assert.equal(resolveServerHost(" 0.0.0.0 "), "0.0.0.0");
});
