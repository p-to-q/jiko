import test from "node:test";
import assert from "node:assert/strict";

import { validateSttBenchmarkConfig } from "../config.mjs";

test("benchmark config is strict and allows explicitly unconfigured candidates", () => {
  const config = baseConfig();

  assert.equal(validateSttBenchmarkConfig(config).ok, true);

  config.unrecordedKnob = true;
  assert.equal(validateSttBenchmarkConfig(config).ok, false);
});

test("benchmark config rejects duplicate families and incomplete settings", () => {
  const duplicate = baseConfig();
  duplicate.candidates.push({ id: "second-whisper", family: "whisper_cpp" });
  const incomplete = baseConfig();
  incomplete.candidates[0].settings = {};

  assert.ok(
    validateSttBenchmarkConfig(duplicate).issues.some((issue) =>
      issue.path.endsWith("/family") && issue.message === "must be unique"
    )
  );
  assert.equal(validateSttBenchmarkConfig(incomplete).ok, false);
});

function baseConfig() {
  return {
    schemaVersion: "stt_benchmark_config_v1",
    profileId: "test-host",
    environmentKind: "host",
    corpusManifestPath: null,
    warmupIterations: 0,
    measuredIterations: 0,
    candidates: [{ id: "whisper-test", family: "whisper_cpp" }]
  };
}
