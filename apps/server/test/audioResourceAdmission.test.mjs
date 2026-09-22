import test from "node:test";
import assert from "node:assert/strict";

import {
  AudioResourceAdmission,
  AudioResourceCapacityError
} from "../dist/audioResourceAdmission.js";

test("ingress reservations reject synchronously before exceeding the process budget", () => {
  const admission = new AudioResourceAdmission({
    maxIngressBytes: 10,
    maxIngressLeases: 2,
    maxPipelineBytes: 20,
    maxPipelines: 1
  });
  const first = admission.beginIngress();
  const second = admission.beginIngress();

  assert.throws(
    () => admission.beginIngress(),
    (error) => error instanceof AudioResourceCapacityError &&
      error.resource === "ingress_slots"
  );

  first.reserve(6);
  assert.throws(
    () => second.reserve(5),
    (error) => error instanceof AudioResourceCapacityError &&
      error.resource === "ingress_bytes"
  );
  assert.deepEqual(admission.snapshot().ingress, {
    reservedBytes: 6,
    maxBytes: 10,
    activeLeases: 2,
    maxLeases: 2,
    rejectedReservations: 1,
    rejectedSlotReservations: 1
  });

  first.release();
  second.reserve(5);
  second.release();
  second.release();
  assert.equal(admission.snapshot().ingress.reservedBytes, 0);
  assert.equal(admission.snapshot().ingress.activeLeases, 0);
});

test("present invalid resource-policy configuration fails closed", () => {
  const previous = process.env.JIKO_AUDIO_MAX_INGRESS_BYTES;
  try {
    process.env.JIKO_AUDIO_MAX_INGRESS_BYTES = "0";
    assert.throws(
      () => new AudioResourceAdmission(),
      /JIKO_AUDIO_MAX_INGRESS_BYTES must be a positive safe integer/
    );
  } finally {
    if (previous === undefined) {
      delete process.env.JIKO_AUDIO_MAX_INGRESS_BYTES;
    } else {
      process.env.JIKO_AUDIO_MAX_INGRESS_BYTES = previous;
    }
  }

  assert.throws(
    () => new AudioResourceAdmission({ maxPipelines: 0 }),
    /maxPipelines must be a positive safe integer/
  );
});

test("pipeline leases enforce both byte and concurrency ceilings and release exactly once", () => {
  const admission = new AudioResourceAdmission({
    maxIngressBytes: 10,
    maxPipelineBytes: 8,
    maxPipelines: 1
  });

  assert.throws(
    () => admission.acquirePipeline(9),
    (error) => error instanceof AudioResourceCapacityError &&
      error.resource === "pipeline_bytes"
  );
  const first = admission.acquirePipeline(8);
  assert.throws(
    () => admission.acquirePipeline(1),
    (error) => error instanceof AudioResourceCapacityError &&
      error.resource === "pipeline_slots"
  );
  assert.equal(admission.snapshot().pipeline.activeLeases, 1);
  assert.equal(admission.snapshot().pipeline.reservedBytes, 8);
  assert.equal(admission.snapshot().pipeline.rejectedByteReservations, 1);
  assert.equal(admission.snapshot().pipeline.rejectedSlotReservations, 1);

  first.release();
  first.release();
  const replacement = admission.acquirePipeline(1);
  replacement.release();
  assert.equal(admission.snapshot().pipeline.activeLeases, 0);
  assert.equal(admission.snapshot().pipeline.reservedBytes, 0);
});
