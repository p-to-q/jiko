# Hardware HIL receipt scaffold

This directory defines the portable `hardware_hil_v1` evidence contract. The
checked-in runner is deliberately limited to **host simulation**: it validates
the receipt schema, semantic invariants, and artifact hashes without claiming
that a Raspberry Pi, microphone, display, button, speaker, power probe, or
thermal probe was present.

Run it with:

```sh
pnpm benchmark:hil:host
pnpm benchmark:hil:validate -- artifacts/benchmarks/hardware-hil-v1/latest.json
pnpm test:hil
```

Generated receipts live under ignored
`artifacts/benchmarks/hardware-hil-v1/`. A successful host run reports two
separate facts:

- the harness completed and produced internally consistent artifacts;
- hardware qualification is `not_evaluated`.

It does **not** exercise the product event/audio path or prove capture, STT,
output, latency, power, thermal, recovery, update, or target-device behavior.

## Truthfulness rules

The JSON Schema is
[`schema/hardware-hil-v1.schema.json`](schema/hardware-hil-v1.schema.json). The
semantic validator adds cross-field rules that JSON Schema alone cannot express:

- `host_simulation` requires `dut.present=false`, a synthetic fixture,
  qualification profile `none`, and verdict `not_evaluated`;
- host evidence cannot claim a physical button, acoustic capture, electrical or
  acoustic output, or measured DUT capture/power/thermal values;
- an unavailable measurement contains an availability state and reason, never a
  fabricated zero;
- a measured zero is valid only with a unit, positive sample count, and named
  source;
- artifact paths must remain inside the repository and their byte count and
  SHA-256 digest are verified;
- gate verdicts derive from the selected profile and required checks;
- a passing hardware gate additionally requires a real DUT/fixture identity,
  complete measured evidence, at least 10,000 completed turns, and the declared
  8-hour/24-hour/72-hour duration or duty-cycle evidence.

The receipt stores large per-turn evidence as referenced NDJSON artifacts rather
than embedding a 10,000-turn trace. Transcript content and raw captured audio do
not belong in this summary receipt.

## What is intentionally absent

There is no `benchmark:hil` command and no labgrid or pytest-embedded adapter
yet. Adding a command that silently falls back to host simulation would make a
green result ambiguous. A future real-HIL command must fail closed when DUT,
fixture, calibration, build/model/firmware identity, or instrumentation is
missing. It must drive the normal product event path rather than introducing a
second business protocol.
