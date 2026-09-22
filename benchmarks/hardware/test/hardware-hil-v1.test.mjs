import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  sha256,
  validateHardwareHilReceipt
} from "../receipt.mjs";

const fixtureHash = "a".repeat(64);
const configurationHash = "b".repeat(64);

test("accepts an honest host simulation without evaluating a hardware gate", async () => {
  const result = await validateHardwareHilReceipt(validHostReceipt());

  assert.equal(result.ok, true, formatIssues(result));
});

test("rejects a host simulation that claims a passing hardware gate", async () => {
  const receipt = validHostReceipt();
  receipt.qualification = {
    profile: "architecture_8h",
    verdict: "pass",
    reasons: []
  };

  const result = await validateHardwareHilReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.path === "/qualification/profile" ||
        issue.message.includes("only hardware_in_loop")
    ),
    formatIssues(result)
  );
});

test("rejects host evidence that claims a DUT or physical path", async () => {
  const receipt = validHostReceipt();
  receipt.dut = {
    present: true,
    profileId: "invented-pi",
    serial: "invented",
    hardwareRevision: "invented",
    os: "invented",
    arch: "arm64",
    threadCount: 4,
    powerMode: notCollected("not measured"),
    components: [
      {
        role: "os_image",
        availability: "unavailable",
        reason: "not measured"
      }
    ],
    update: {
      slot: notCollected("not measured"),
      health: notCollected("not measured")
    }
  };
  receipt.pathCoverage.control = "physical_button";

  const result = await validateHardwareHilReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "/dut/present"),
    formatIssues(result)
  );
  assert.ok(
    result.issues.some((issue) => issue.path === "/pathCoverage"),
    formatIssues(result)
  );
});

test("rejects zero disguised as an uncollected metric", async () => {
  const receipt = validHostReceipt();
  receipt.measurements.capture.xrunCount = {
    availability: "not_collected",
    reason: "no ALSA capture worker",
    value: 0
  };

  const result = await validateHardwareHilReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path.includes("/measurements/capture/xrunCount")),
    formatIssues(result)
  );
});

test("allows a measured zero only with count provenance", async () => {
  const receipt = validHostReceipt();
  receipt.measurements.integrity.eventLossCount = {
    availability: "measured",
    value: 0,
    unit: "count",
    sampleCount: 10,
    source: "host event-trace validator"
  };

  const result = await validateHardwareHilReceipt(receipt);

  assert.equal(result.ok, true, formatIssues(result));
});

test("rejects traversal paths and malformed artifact hashes", async () => {
  const traversalReceipt = validHostReceipt();
  traversalReceipt.artifacts[0].path = "../fixture.json";
  const traversalResult = await validateHardwareHilReceipt(traversalReceipt);
  assert.equal(traversalResult.ok, false);
  assert.ok(
    traversalResult.issues.some((issue) => issue.path === "/artifacts/0/path"),
    formatIssues(traversalResult)
  );

  const hashReceipt = validHostReceipt();
  hashReceipt.artifacts[0].sha256 = "not-a-sha";
  const hashResult = await validateHardwareHilReceipt(hashReceipt);
  assert.equal(hashResult.ok, false);
  assert.ok(
    hashResult.issues.some((issue) => issue.path.includes("/artifacts/0/sha256")),
    formatIssues(hashResult)
  );
});

test("rejects percentile summaries whose ordering is impossible", async () => {
  const receipt = validHostReceipt();
  receipt.measurements.latency.releaseToResultMs = {
    availability: "measured",
    unit: "ms",
    sampleCount: 20,
    p50: 100,
    p95: 90,
    p99: 110,
    max: 120,
    source: "host monotonic trace"
  };

  const result = await validateHardwareHilReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.message.includes("p50 <= p95")),
    formatIssues(result)
  );
});

test("verifies declared artifact bytes and sha256 inside the repository root", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "jiko-hil-test-"));
  try {
    const fixtureBytes = Buffer.from("fixture\n", "utf8");
    const configurationBytes = Buffer.from("configuration\n", "utf8");
    await mkdir(path.join(repositoryRoot, "evidence"), { recursive: true });
    await writeFile(path.join(repositoryRoot, "evidence", "fixture.json"), fixtureBytes);
    await writeFile(
      path.join(repositoryRoot, "evidence", "configuration.json"),
      configurationBytes
    );

    const receipt = validHostReceipt();
    const actualFixtureHash = sha256(fixtureBytes);
    const actualConfigurationHash = sha256(configurationBytes);
    receipt.fixture.manifestSha256 = actualFixtureHash;
    receipt.reproducibility.suite.manifestSha256 = actualFixtureHash;
    receipt.reproducibility.source.fixtureManifestSha256 = actualFixtureHash;
    receipt.reproducibility.source.configurationSha256 = actualConfigurationHash;
    receipt.checks[0].evidenceArtifactSha256 = actualConfigurationHash;
    receipt.artifacts = [
      {
        role: "fixture_manifest",
        path: "evidence/fixture.json",
        sha256: actualFixtureHash,
        byteSize: fixtureBytes.byteLength,
        mediaType: "application/json"
      },
      {
        role: "configuration",
        path: "evidence/configuration.json",
        sha256: actualConfigurationHash,
        byteSize: configurationBytes.byteLength,
        mediaType: "application/json"
      }
    ];

    const validResult = await validateHardwareHilReceipt(receipt, {
      repositoryRoot,
      verifyArtifacts: true
    });
    assert.equal(validResult.ok, true, formatIssues(validResult));

    receipt.artifacts[1].byteSize += 1;
    const invalidResult = await validateHardwareHilReceipt(receipt, {
      repositoryRoot,
      verifyArtifacts: true
    });
    assert.equal(invalidResult.ok, false);
    assert.ok(
      invalidResult.issues.some((issue) => issue.path === "/artifacts/1/byteSize"),
      formatIssues(invalidResult)
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("hardware evidence cannot use the host-only absent DUT and synthetic fixture", async () => {
  const receipt = validHostReceipt();
  receipt.evidenceClass = "hardware_in_loop";

  const result = await validateHardwareHilReceipt(receipt);

  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "/dut/present"),
    formatIssues(result)
  );
  assert.ok(
    result.issues.some((issue) => issue.path === "/fixture/kind"),
    formatIssues(result)
  );
});

function validHostReceipt() {
  const noHardware = "No DUT or physical instrumentation was present.";
  const noProductTurn = "No product turn was executed.";
  return {
    schema: "hardware_hil_v1",
    schemaVersion: 1,
    runId: "host-test-001",
    evidenceClass: "host_simulation",
    harnessStatus: "completed",
    startedAt: "2026-09-18T00:00:00.000Z",
    finishedAt: "2026-09-18T00:00:01.000Z",
    elapsedMonotonicMs: 1000,
    reproducibility: {
      suite: {
        id: "host-contract-v1",
        version: 1,
        manifestSha256: fixtureHash
      },
      source: {
        git: {
          availability: "identified",
          sha: "1".repeat(40),
          dirty: true
        },
        lockfileSha256: "2".repeat(64),
        schemaSha256: "3".repeat(64),
        harnessSha256: "4".repeat(64),
        fixtureManifestSha256: fixtureHash,
        configurationSha256: configurationHash
      },
      protocol: {
        sessionEvent: notCollected(noProductTurn),
        sessionReceipt: notCollected(noProductTurn)
      }
    },
    controller: {
      platform: "test",
      release: "test",
      arch: "test",
      runtime: "node test",
      logicalCpuCount: 1,
      profileId: notCollected("No pinned host profile."),
      powerMode: notCollected("No power-mode probe.")
    },
    dut: {
      present: false,
      reason: noHardware
    },
    fixture: {
      kind: "synthetic",
      id: "metadata-only",
      manifestSha256: fixtureHash,
      description: "No content fixture."
    },
    pathCoverage: {
      control: "none",
      audio: "none",
      output: "none"
    },
    campaign: {
      scope: "receipt validation only",
      startCondition: "warm",
      plannedTurns: 0,
      completedTurns: 0,
      inputDurationMs: notCollected(noProductTurn)
    },
    cases: [],
    measurements: {
      capture: {
        sampleCount: notCollected(noHardware),
        monotonicElapsedMs: notCollected(noHardware),
        clockDriftPpm: notCollected(noHardware),
        firstPhonemeClipped: notCollected(noHardware),
        lastPhonemeClipped: notCollected(noHardware),
        xrunCount: notCollected(noHardware),
        gapCount: notCollected(noHardware),
        resetCount: notCollected(noHardware),
        duplicateFrameCount: notCollected(noHardware),
        outOfOrderFrameCount: notCollected(noHardware),
        overflowCount: notCollected(noHardware),
        ringHighWaterFrames: notCollected(noHardware),
        hostQueueHighWaterFrames: notCollected(noHardware),
        maxQueueAgeMs: notCollected(noHardware)
      },
      integrity: {
        eventLossCount: notCollected(noProductTurn),
        duplicateFinalResultCount: notCollected(noProductTurn),
        stuckSessionCount: notCollected(noProductTurn)
      },
      latency: {
        buttonDownToAckMs: notCollected(noProductTurn),
        buttonUpToProcessingMs: notCollected(noProductTurn),
        releaseToResultMs: notCollected(noProductTurn),
        releaseToErrorMs: notCollected(noProductTurn)
      },
      dutPower: {
        railCurrentMa: notCollected(noHardware),
        energyMwh: notCollected(noHardware)
      },
      dutThermal: {
        temperatureC: notCollected(noHardware),
        throttleCount: notCollected(noHardware)
      }
    },
    faults: [],
    checks: [
      {
        id: "scope-declared",
        required: true,
        verdict: "pass",
        message: "The host-only scope is explicit.",
        evidenceArtifactSha256: configurationHash
      }
    ],
    qualification: {
      profile: "none",
      verdict: "not_evaluated",
      reasons: [noHardware]
    },
    privacy: {
      stimulusClass: "none",
      rawCapturedAudio: "none",
      transcriptContent: "omitted",
      containsPersonalData: false
    },
    artifacts: [
      {
        role: "fixture_manifest",
        path: "benchmarks/hardware/fixtures/test.json",
        sha256: fixtureHash,
        byteSize: 1,
        mediaType: "application/json"
      },
      {
        role: "configuration",
        path: "benchmarks/hardware/config/test.json",
        sha256: configurationHash,
        byteSize: 1,
        mediaType: "application/json"
      }
    ]
  };
}

function notCollected(reason) {
  return {
    availability: "not_collected",
    reason
  };
}

function formatIssues(result) {
  return result.issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join("\n");
}
