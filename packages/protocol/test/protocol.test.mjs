import test from "node:test";
import assert from "node:assert/strict";

import {
  AudioFeaturesSchema,
  OrderedPcmIdentitySchema,
  PipelineReceiptSchema,
  SessionEventSchema,
  SessionReceiptSchema,
  SessionResultSchema,
  SttProviderReceiptSchema,
  TranscriptResultSchema
} from "../dist/index.js";

const completeReadings = [
  { channel: "text", state: "maintain", confidence: 0.8, features: {} },
  { channel: "voice", state: "maintain", confidence: 0.8, features: {} },
  { channel: "timing", state: "deviate", confidence: 0.6, features: {} }
];

function resultFixture(overrides = {}) {
  return {
    sessionId: "result-contract",
    readings: completeReadings,
    majorityState: "maintain",
    minorityStates: ["deviate"],
    topWindow: {
      status: "minority_exists",
      lineEn: "One signal differs.",
      lineZh: "一路不同。"
    },
    coverage: {
      total: 3,
      measured: 3,
      simulated: 0,
      unavailable: 0,
      unavailableChannels: []
    },
    colors: {},
    ...overrides
  };
}

test("session results reject duplicate or missing product channels", () => {
  const duplicate = SessionResultSchema.safeParse(resultFixture({
    readings: completeReadings.map((reading) => ({ ...reading, channel: "text" }))
  }));
  const missing = SessionResultSchema.safeParse(resultFixture({
    readings: completeReadings.slice(0, 2),
    coverage: {
      total: 2,
      measured: 2,
      simulated: 0,
      unavailable: 0,
      unavailableChannels: []
    }
  }));

  assert.equal(duplicate.success, false);
  assert.equal(missing.success, false);
});

test("session result coverage must be derived from its readings", () => {
  const parsed = SessionResultSchema.safeParse(resultFixture({
    coverage: {
      total: 99,
      measured: 0,
      simulated: 0,
      unavailable: 0,
      unavailableChannels: ["voice"]
    }
  }));

  assert.equal(parsed.success, false);
  assert.equal(
    SessionResultSchema.safeParse(resultFixture({ coverage: undefined })).success,
    false
  );
});

test("session result verdict fields must be derived from available readings", () => {
  assert.equal(
    SessionResultSchema.safeParse(resultFixture({ majorityState: "deviate" })).success,
    false
  );
  assert.equal(
    SessionResultSchema.safeParse(resultFixture({
      minorityStates: ["deviate", "deviate"]
    })).success,
    false
  );
  assert.equal(
    SessionResultSchema.safeParse(resultFixture({
      topWindow: {
        status: "consensus_maintain",
        lineEn: "Contradictory class.",
        lineZh: "错误分类。"
      }
    })).success,
    false
  );
});

test("session result verdict ignores unavailable lines and canonicalizes ties", () => {
  const partialReadings = [
    { ...completeReadings[0], availability: "measured" },
    { ...completeReadings[1], availability: "measured" },
    { ...completeReadings[2], availability: "unavailable" }
  ];
  const partial = resultFixture({
    readings: partialReadings,
    minorityStates: [],
    topWindow: {
      status: "partial",
      lineEn: "One signal is unavailable.",
      lineZh: "一路不可用。"
    },
    coverage: {
      total: 3,
      measured: 2,
      simulated: 0,
      unavailable: 1,
      unavailableChannels: ["timing"]
    }
  });

  assert.equal(SessionResultSchema.safeParse(partial).success, true);
  assert.equal(
    SessionResultSchema.safeParse({
      ...partial,
      majorityState: "deviate",
      minorityStates: ["maintain"],
      topWindow: { ...partial.topWindow, status: "minority_exists" }
    }).success,
    false
  );

  const insufficient = resultFixture({
    readings: [
      { ...completeReadings[0], availability: "measured" },
      {
        ...completeReadings[1],
        state: "deviate",
        availability: "measured"
      },
      { ...completeReadings[2], state: "static", availability: "unavailable" }
    ],
    majorityState: undefined,
    minorityStates: ["maintain", "deviate"],
    topWindow: {
      status: "insufficient",
      lineEn: "Not enough signal.",
      lineZh: "信号不足。"
    },
    coverage: {
      total: 3,
      measured: 2,
      simulated: 0,
      unavailable: 1,
      unavailableChannels: ["timing"]
    }
  });

  assert.equal(SessionResultSchema.safeParse(insufficient).success, true);

  const tiedReadings = [
    { channel: "timing", state: "static", confidence: 0.6, features: {} },
    { channel: "text", state: "deviate", confidence: 0.8, features: {} },
    { channel: "voice", state: "maintain", confidence: 0.7, features: {} }
  ];
  const tied = resultFixture({
    readings: tiedReadings,
    majorityState: undefined,
    minorityStates: ["maintain", "deviate", "static"],
    topWindow: {
      status: "mixed",
      lineEn: "The signal will not settle.",
      lineZh: "信号没有站稳。"
    }
  });

  assert.equal(SessionResultSchema.safeParse(tied).success, true);
  assert.equal(
    SessionResultSchema.safeParse({
      ...tied,
      minorityStates: ["static", "deviate", "maintain"]
    }).success,
    false
  );
});

test("explicit empty pre-signal results remain valid", () => {
  assert.equal(
    SessionResultSchema.safeParse({
      sessionId: "pre-signal",
      readings: [],
      minorityStates: [],
      topWindow: {
        status: "empty",
        lineEn: "Waiting for signal.",
        lineZh: "等待读数。"
      },
      colors: {}
    }).success,
    true
  );
});

test("digital-silence evidence is optional for older audio feature receipts", () => {
  const measured = AudioFeaturesSchema.parse({
    durationMs: 1_000,
    digitalSilenceDetected: true,
    speechMs: 0
  });
  const legacy = AudioFeaturesSchema.parse({
    durationMs: 1_000,
    speechMs: 0
  });

  assert.equal(measured.digitalSilenceDetected, true);
  assert.equal(legacy.digitalSilenceDetected, undefined);
});

test("accepts a normal device recording event", () => {
  const event = SessionEventSchema.parse({
    type: "input.recording.started",
    sessionId: "device-001",
    attemptId: "attempt-device-001",
    sequence: 1,
    timestamp: 1_700_000_000_000,
    monotonicMs: 42_100.5,
    source: "device"
  });

  assert.equal(event.type, "input.recording.started");
  assert.equal(event.source, "device");
  assert.equal(event.monotonicMs, 42_100.5);
});

test("rejects malformed reading confidence at the protocol boundary", () => {
  const parsed = SessionEventSchema.safeParse({
    type: "reading.channel.resolved",
    sessionId: "session-001",
    attemptId: "attempt-session-001",
    sequence: 2,
    timestamp: 1,
    reading: {
      channel: "voice",
      state: "deviate",
      confidence: 1.2,
      features: {}
    }
  });

  assert.equal(parsed.success, false);
});

test("allows an STT result to omit confidence when the provider has none", () => {
  const transcript = TranscriptResultSchema.parse({
    text: "我想试试",
    semanticText: "我想试试",
    language: "zh",
    provider: "local:sherpa-onnx-sensevoice",
    latencyMs: 240,
    enhancement: {
      id: "jiko-semantic-view-v1",
      transforms: []
    }
  });

  assert.equal(transcript.confidence, undefined);
  assert.equal(transcript.semanticText, "我想试试");
});

test("keeps STT availability separate from transcript text and confidence", () => {
  const transcript = TranscriptResultSchema.parse({
    text: "",
    provider: "local:stt-unconfigured:unavailable",
    failureCode: "provider_unavailable",
    latencyMs: 1
  });

  assert.equal(transcript.failureCode, "provider_unavailable");
  assert.equal(transcript.confidence, undefined);
});

test("receipt defaults preserve an honest empty record", () => {
  const receipt = SessionReceiptSchema.parse({
    sessionId: "session-001",
    attemptId: "attempt-session-001",
    lastSequence: 0,
    startedAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    status: "created",
    source: "browser",
    input: {
      audioStored: false
    }
  });

  assert.equal(receipt.schemaVersion, "session_receipt_v1");
  assert.deepEqual(receipt.providers, {});
  assert.deepEqual(receipt.readings, []);
  assert.deepEqual(receipt.events, []);
  assert.deepEqual(receipt.errors, []);
});

test("session_receipt_v1 remains compatible with pre-provenance STT receipts", () => {
  const receipt = SessionReceiptSchema.parse({
    sessionId: "legacy-stt-receipt",
    attemptId: "legacy-stt-attempt",
    lastSequence: 1,
    startedAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:01.000Z",
    status: "processing",
    source: "device",
    input: { audioStored: false },
    providers: {
      stt: {
        id: "local:legacy-stt",
        latencyMs: 10
      }
    },
    transcript: {
      text: "legacy",
      provider: "local:legacy-stt",
      latencyMs: 10
    }
  });

  assert.equal(receipt.providers.stt?.outcome, undefined);
  assert.equal(receipt.providers.stt?.execution, undefined);
});

test("remote STT receipt requires strict auditable response provenance", () => {
  const receipt = SttProviderReceiptSchema.parse({
    id: "remote:deepgram-batch",
    latencyMs: 81,
    remote: true,
    outcome: "completed",
    remoteExecution: {
      provider: "deepgram",
      model: "nova-3",
      version: "latest",
      resolvedModel: "nova-3",
      resolvedVersion: "2026-08-06.1",
      region: "eu",
      mode: "batch",
      trustBoundary: "deepgram_api",
      endpointOrigin: "https://api.eu.deepgram.com",
      requestId: "dg-request-001",
      mipOptOut: true
    }
  });

  assert.equal(receipt.remoteExecution?.requestId, "dg-request-001");
  assert.equal(receipt.remoteExecution?.mipOptOut, true);
  assert.equal(
    SttProviderReceiptSchema.safeParse({
      ...receipt,
      remote: false
    }).success,
    false
  );
  assert.equal(
    SttProviderReceiptSchema.safeParse({
      ...receipt,
      remoteExecution: {
        ...receipt.remoteExecution,
        requestId: undefined,
        resolvedModel: undefined,
        resolvedVersion: undefined
      }
    }).success,
    false
  );
  assert.equal(
    SttProviderReceiptSchema.safeParse({
      ...receipt,
      remoteExecution: {
        ...receipt.remoteExecution,
        apiKey: "must-never-enter-a-receipt"
      }
    }).success,
    false
  );
  assert.equal(
    SttProviderReceiptSchema.safeParse({
      ...receipt,
      id: "local:wrong-boundary"
    }).success,
    false
  );
  const failedBeforeResponse = SttProviderReceiptSchema.parse({
    id: "remote:deepgram-batch:failed",
    remote: true,
    outcome: "failed",
    remoteExecution: {
      provider: "deepgram",
      model: "nova-3",
      version: "pinned-version",
      region: "global",
      mode: "batch",
      trustBoundary: "deepgram_api",
      endpointOrigin: "https://api.deepgram.com",
      mipOptOut: true
    }
  });
  assert.equal(failedBeforeResponse.remoteExecution?.requestId, undefined);
});

test("receipt accepts strict loaded STT runtime, configuration, and artifact identity", () => {
  const receipt = SessionReceiptSchema.parse({
    sessionId: "identified-stt-receipt",
    attemptId: "identified-stt-attempt",
    lastSequence: 2,
    startedAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:01.000Z",
    status: "processing",
    source: "device",
    input: { audioStored: false },
    providers: {
      stt: {
        id: "local:sherpa-onnx-sensevoice",
        latencyMs: 12,
        outcome: "completed",
        execution: sttExecutionIdentity()
      }
    },
    transcript: {
      text: "identified",
      provider: "local:sherpa-onnx-sensevoice",
      latencyMs: 12
    }
  });

  assert.equal(
    receipt.providers.stt?.execution?.artifacts.model.sha256,
    "a".repeat(64)
  );
  assert.equal(receipt.providers.stt?.execution?.artifacts.tokens.bytes, 45);
});

test("receipt rejects invented or contradictory STT provenance", () => {
  const base = {
    sessionId: "invalid-stt-receipt",
    attemptId: "invalid-stt-attempt",
    lastSequence: 2,
    startedAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:01.000Z",
    status: "processing",
    source: "device",
    input: { audioStored: false },
    transcript: {
      text: "",
      provider: "local:sherpa-onnx-sensevoice:timed_out",
      failureCode: "timed_out",
      latencyMs: 12
    }
  };
  const malformedHash = structuredClone(sttExecutionIdentity());
  malformedHash.artifacts.model.sha256 = "configured-path-only";
  const unknownIdentityField = {
    ...sttExecutionIdentity(),
    configuredPath: "/not-runtime-proof/model.onnx"
  };

  assert.equal(
    SessionReceiptSchema.safeParse({
      ...base,
      providers: {
        stt: {
          id: base.transcript.provider,
          outcome: "timed_out",
          execution: malformedHash
        }
      }
    }).success,
    false
  );
  assert.equal(
    SessionReceiptSchema.safeParse({
      ...base,
      providers: {
        stt: {
          id: base.transcript.provider,
          outcome: "timed_out",
          execution: unknownIdentityField
        }
      }
    }).success,
    false
  );
  assert.equal(
    SessionReceiptSchema.safeParse({
      ...base,
      providers: {
        stt: {
          id: base.transcript.provider,
          outcome: "provider_unavailable",
          execution: sttExecutionIdentity()
        }
      }
    }).success,
    false
  );
  assert.equal(
    SessionReceiptSchema.safeParse({
      ...base,
      providers: {
        stt: {
          id: "local:another-provider",
          outcome: "failed"
        }
      }
    }).success,
    false
  );
});

test("receipt schema rejects the former non-canonical input shape", () => {
  const receipt = SessionReceiptSchema.safeParse({
    sessionId: "session-legacy",
    attemptId: "attempt-session-legacy",
    lastSequence: 1,
    startedAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:01.000Z",
    status: "processing",
    source: "browser",
    input: {
      source: "browser",
      mediaType: "audio/wav",
      byteSize: 4,
      audioStored: false
    }
  });

  assert.equal(receipt.success, false);
});

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

test("reading availability is separate from the static signal state", () => {
  const event = SessionEventSchema.parse({
    type: "reading.channel.resolved",
    sessionId: "session-availability",
    attemptId: "attempt-session-availability",
    sequence: 1,
    timestamp: 2,
    reading: {
      channel: "text",
      state: "static",
      confidence: 0.44,
      availability: "unavailable",
      features: {}
    }
  });

  assert.equal(event.reading.state, "static");
  assert.equal(event.reading.availability, "unavailable");
});

test("pipeline receipts keep degraded execution separate from stage latency", () => {
  const receipt = PipelineReceiptSchema.parse({
    startedAt: "2026-09-17T00:00:00.000Z",
    finishedAt: "2026-09-17T00:00:00.240Z",
    totalLatencyMs: 240,
    stages: [
      {
        stage: "stt",
        status: "unavailable",
        latencyMs: 18.4,
        provider: "local:stt-unconfigured"
      },
      {
        stage: "total",
        status: "degraded",
        latencyMs: 240,
        provider: "jiko:audio-pipeline-v1"
      }
    ]
  });

  assert.equal(receipt.stages[0].status, "unavailable");
  assert.equal(receipt.stages[1].status, "degraded");
});

test("requires an attempt id and positive sequence on every session event", () => {
  const missingIdentity = SessionEventSchema.safeParse({
    type: "session.created",
    sessionId: "identity-session",
    timestamp: 1,
    source: "browser"
  });
  const zeroSequence = SessionEventSchema.safeParse({
    type: "session.created",
    sessionId: "identity-session",
    attemptId: "identity-attempt",
    sequence: 0,
    timestamp: 1,
    source: "browser"
  });
  const emptyAttempt = SessionEventSchema.safeParse({
    type: "session.created",
    sessionId: "identity-session",
    attemptId: "",
    sequence: 1,
    timestamp: 1,
    source: "browser"
  });
  const unsafeSession = SessionEventSchema.safeParse({
    type: "session.created",
    sessionId: "not safe",
    attemptId: "identity-attempt",
    sequence: 1,
    timestamp: 1,
    source: "browser"
  });
  const dotOnlySession = SessionEventSchema.safeParse({
    type: "session.created",
    sessionId: ".",
    attemptId: "identity-attempt",
    sequence: 1,
    timestamp: 1,
    source: "browser"
  });
  const dotOnlyOrderedPcm = OrderedPcmIdentitySchema.safeParse({
    sessionId: "..",
    attemptId: "identity-attempt",
    sourceId: "browser-worklet",
    audioProfileHash: "a".repeat(64)
  });

  assert.equal(missingIdentity.success, false);
  assert.equal(zeroSequence.success, false);
  assert.equal(emptyAttempt.success, false);
  assert.equal(unsafeSession.success, false);
  assert.equal(dotOnlySession.success, false);
  assert.equal(dotOnlyOrderedPcm.success, false);
});

test("rejects a result whose nested session identity disagrees", () => {
  const parsed = SessionEventSchema.safeParse({
    type: "session.result",
    sessionId: "outer-session",
    attemptId: "outer-attempt",
    sequence: 7,
    timestamp: 100,
    source: "server",
    result: {
      sessionId: "other-session",
      readings: [],
      minorityStates: [],
      topWindow: {
        status: "empty",
        lineEn: "Waiting for signal.",
        lineZh: "等待读数。"
      },
      colors: {}
    }
  });

  assert.equal(parsed.success, false);
});
