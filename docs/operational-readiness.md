# Operational Readiness

Last audited: **2026-09-23**

Status vocabulary:

- **Implemented + locally proved** — code exists and a named local command has
  passed.
- **Implemented, target proof missing** — code exists but has not passed on the
  intended hardware, model, browser, or environment.
- **Specified only** — a document describes it; no working path is present.
- **Unsupported** — required for deployment and not yet designed or built.

## Current Verdict

Jiko is a coherent **integration prototype**, not a deployable standalone
instrument. The shared packages, local server path, web surface, and thin Pi
adapter are real. The P0 attempt-identity, scoped-SSE, single-input-claim,
background-output control, monotonic attempt deadline, and persistent local
SenseVoice worker paths now exist and have Node-level or fake-worker tests. A
pinned real SenseVoice int8 model has also completed a small non-human synthetic
host spike; it exposed a digital-silence hallucination, now contained by an
exact all-zero-PCM evidence gate, and remains
`not_evaluated`, not release-qualified. The current 11-journey Chrome E2E gate
proves the manual turn, foreign-session isolation, result-before-delayed TTS,
reduced-motion locking, multi-attempt device discovery, the capture-unavailable
observer fallback, the explicit `MediaRecorder` control, and the forced
`AudioWorklet` ordered-PCM path with a fake microphone. Source selects ordered
PCM by default in a
secure-capable browser, but that implicit selection is not separately
E2E-tested. The ordered path closes capture -> bounded WebSocket -> process
spool -> canonical pipeline -> receipt, but STT still starts after stop.
The current validation still does not prove a physical microphone or real
permission prompt, track-loss recovery, WebSocket resume/restart recovery,
incremental ASR, real-speech accuracy, Raspberry Pi inference, enclosure
feasibility, unattended recovery, or day-long operation.

## Surface Inventory

| Surface | Status | Evidence now | Missing proof / risk |
| --- | --- | --- | --- |
| Shared event schemas | Implemented + locally proved | protocol tests cover required `sessionId`, `attemptId`, positive `sequence`, nested result identity, unique complete non-empty `text`/`voice`/`timing` results, coverage consistency, and strict binary `audio.start/chunk/stop` envelopes/reducer with profile/final-total/gap/drop/overflow evidence and typed ACK/error messages; a Python device fixture decodes through the authoritative TypeScript contract | physical Pi transport and protocol-version migration remain; browser transport is implemented |
| Shared reducer/result/scene projection | Implemented + locally proved | core tests cover bound-session rejection, duplicate replay, explicit gaps, terminal late TTS, invalid duplicate/incomplete result rejection, canonical coverage order, partial-line projection, result/silence equivalence, and non-verdict error tones | replay fixtures across protocol versions; website texture and golden-frame adapters still use separate rendering state |
| Three heuristic readings | Implemented + locally proved | `packages/readings`; structural benchmark | validity corpus; threshold calibration; demographic/noise audit |
| Manual transcript path | Implemented + locally proved | server smoke; marked `simulated:manual-transcript`; concurrent manual claims yield one `200`, one `409`, and one result; operator tools label the path `Fallback`, `模拟特征`, and explain that it is not measured audio | participant device face has no provenance marker and no browser E2E asserts the operator warning |
| Audio upload/normalization | Implemented + locally proved | `pnpm demo:smoke`; mono 16 kHz ffmpeg path; ordered source-rate PCM is WAVE-wrapped and enters the same one-result pipeline | physical browser formats/microphone and target-device ffmpeg cost |
| Browser ordered-PCM ingress | Implemented, target proof missing | 20 ms `AudioWorklet` frames, roughly 80 ms chunks, explicit mono 16/44.1/48 kHz profiles, bounded preconnect/turn/in-flight buffers, cumulative process-spool ACK, source hash, strict Origin/subprotocol, source-duration/frame/byte ceilings derived from the capture timeout, process-wide ingress/pipeline byte leases reserved before spool writes and WAV allocation, bounded pipeline concurrency, resume/send/final-ACK watchdogs, terminal readback after final-ACK loss, accepted-stop coverage receipt, focused server tests, and Chrome fake-mic E2E reaching a nonempty WAV | no reconnect/chunk replay, restart-recoverable WAL, partial receipt for pre-stop failure, distributed quota across multiple server processes, Safari/mobile matrix, physical mic, real incremental model, or target-device spool-write/ACK measurement |
| Provider-neutral streaming STT lifecycle | Experimental seam, locally proved with fake only | default-off ordered-PCM integration; conformance tests cover bounded PCM/output, attempt identity, observer-only partials, drain-before-stop flush, exactly one coverage-matched final, deadline, cancellation, stale late output, and closed remote-audio boundary; accepted final alone can enter the existing enhancement/readings pipeline | no Zipformer/Moonshine/FunASR streaming adapter, no observer UI, no model/config/endpoint receipt, no real latency/quality/device evidence, and no authorized remote stream |
| Audio features | Implemented, target proof missing | transparent RMS/pitch/pause implementation; exact all-zero PCM evidence gate makes every reading unavailable without rewriting a completed STT receipt | general speech/VAD ground truth, nonzero quiet/noisy-silence handling, noise and mic sensitivity calibration |
| whisper.cpp adapter | Implemented, target proof missing | CLI boundary | model install, Chinese/code-switch CER, cold/warm latency, ARM64 run |
| FunASR HTTP adapter | Implemented, target proof missing | self-hosted HTTP boundary | versioned server contract and identical-corpus benchmark |
| sherpa-onnx SenseVoice adapter | Implemented, target proof missing | process-wide single-flight worker; fake-worker lifecycle tests plus repeated local discovery with `sherpa-onnx@1.13.8` and sherpa-onnx's 2025-09-09 int8 conversion of the ASLP-lab WSYue fine-tune; model/token hashes are pinned in four 50-call ignored receipts; ITN-off arm completed with WAV-to-text p95 `134.634 ms`, but all 10 digital-silence calls hallucinated text | durable tracked corpus/config/receipt; conversion license snapshot; real human speech/noise corpus, calibrated no-speech gate, cold/warm separation, RSS/CPU, cancellation reload cost, Pi 5/CM5 measurements |
| Deepgram batch experiment | Implemented trust boundary, disabled by default | only runs when `STT_PROVIDER=deepgram`, `JIKO_ALLOW_REMOTE_AUDIO=1`, and the upload explicitly consents to `deepgram`; HTTPS, no redirects, explicit non-`latest` version, `mip_opt_out=true`, strict response identity, and no automatic fallback are mock-tested; browser supplies no consent | no live provider call, current legal/data-region/cost approval, real latency/quality comparison, streaming behavior, or release authorization |
| Fixed local TTS clips | Implemented, target proof missing | provider and generation script define seven keys; generated audio remains local and untracked | checked-in provenance/license artifact, target playback device, level, and latency |
| Dynamic Piper TTS | Implemented, target proof missing | CLI boundary | GPL/product review, individual voice license, Chinese quality and Pi latency |
| Browser/device UI | Implemented + locally proved for manual and fake-device capture paths | 11 Chrome journeys prove one visible manual turn stays bound, persisted result/TTS order does not disrupt reveal, reduced-motion locks immediately, repeated device attempts switch without stale-session pollution, a capture-unavailable 320 × 480 observer canvas replaces browser recording with a hardware-input status, `MediaRecorder` starts while registration is blocked, and `AudioWorklet` ordered PCM produces continuous nonempty source-hashed coverage; permission denial, unsupported browser capability, hung `AudioContext.resume`, pending-to-bound identity, response loss, double activation, and manual/record exclusion have explicit behavior | an actually insecure origin, physical mic/native permission prompt/track loss, Safari/mobile, reconnect/restart, streaming partial UI, target speaker, and physical-display legibility/focus/touch remain; website texture still has separate presentation state |
| Scoped SSE replay | Implemented + locally proved | real Node HTTP/fetch-stream tests cover A-only replay, `attemptId:sequence` ids, `Last-Event-ID`, live B filtering, live A delivery, a 32-client configurable cap, immediate slow-client close on backpressure, and capacity reuse after cleanup | native `EventSource` reconnect/header behavior, persisted replay, retention-gap snapshot, and restart recovery |
| Pi side-button adapter | Implemented, target proof missing | GPIO callbacks atomically queue client-id/create/start/stop operations in a bounded SQLite outbox; exact HTTP response-loss retries and interrupted-press recovery have host tests | captures no audio; no audio ring or durable audio ownership; pin/header conflict, physical bounce/long-hold, filesystem endurance/full-disk, disconnect campaign, and Pi run remain |
| Pi native ALSA/JPCM edge | Experimental, host-tested only | `arecord` emits raw mono s16le to stdout only; bounded in-memory queue, monotonic anchor plus exact frame clock, contiguous sequence, profile/source hashes, cumulative drop/xrun evidence, first-frame/ACK/stop bounds, process escalation, and TypeScript JPCM decoding have fake-process tests | no ALSA hardware timestamp; not integrated with button/supervisor; no physical ALSA/card/profile, first-phoneme, reconnect/replay, restart WAL, kiosk-load xrun, Pi/CM5, thermal, power, or long-run proof |
| Raspberry Pi kiosk | Service boundary implemented, target proof missing | `jiko-kiosk.service` is a graphical-user unit that probes the strict local server and built shell before Chromium and keeps the sandbox enabled; portable unit-contract tests pass | Raspberry Pi OS install, compositor/session inheritance, real mic/display/audio permissions, offline boot and recovery test |
| Device-local audio/STT/server | Partial experimental edge | native ALSA-to-JPCM capture now exists without a device-side STT/core fork | the present Pi product loop still depends on the host server; no target install, model, speaker, supervision, or self-contained observer-disconnect proof |
| API/operator authentication | Unsupported beyond loopback | missing or blank `HOST` resolves to `127.0.0.1`; HTTP/SSE and ordered WebSocket use independent exact allowlists, reject disallowed browser Origins before route/actor side effects, and SSE preserves the exact allowed Origin | Origin is browser isolation, not client authentication, and native requests without Origin remain allowed; no attempt/read capability exists, so non-loopback deployment is unsafe until HTTPS/WSS plus scoped capability authorization are implemented |
| State transition/idempotency guard | Partial | one immutable attempt, contiguous server sequence, single `audio`/`manual` claim, one final result, reset-absorbing terminal state, idempotent client session creation, exact start/stop replay, exact monotonic device-error replay, a device-button SQLite outbox with typed retired-ID quarantine, bounded session count/age, bounded anti-reuse tombstones, retained-creation-receipt restart rejection, and one non-extendable monotonic attempt deadline have tests; the same deadline aborts a still-open HTTP audio body and releases ingress | audio-upload operation ids, durable audio/server replay, identities whose receipts were disabled or pruned, cross-process creation races, a distinct per-chunk idle policy, and preemptible synchronous DSP |
| Result/TTS output scheduling | Implemented + locally proved at process boundary | result response test proves delayed TTS does not hold HTTP result; latest-wins scheduler and abortable local-process tests pass | actual target speaker/Piper cancellation, playback-start p95, crash recovery, and audio-device contention |
| Pipeline-stage receipts | Implemented + locally proved | normalize/features/STT/enhance/readings/total status, machine-readable failure codes, admission-stage rejection receipt, monotonic elapsed time, soft STT cutoff, hard attempt deadline, reset-wins process/worker cancellation, process-wide byte/slot admission, duration-derived decoded-output reservation/cap, and commit-boundary expiry; a returned soft-timeout result retains its slot and temp ownership until explicit provider resource settlement | preemptible/worker-isolated synchronous DSP, multi-process admission, cross-provider priority scheduler, target-device p95 |
| Receipt persistence ordering | Implemented + locally proved in one process | same-session snapshots serialize; a slow or failed old write cannot overwrite/block a later reset, while different sessions stay parallel; directories/files are corrected to private `0700`/`0600`; strict per-file/count/total-byte/age limits prune serially without deleting the current snapshot; strict bounded identity lookup refuses a retained prior attempt after restart | multi-process locking, disk-full recovery, event replay, or protection after a receipt is disabled/pruned |
| Health/readiness diagnostics | Partial | ffmpeg/tool/file checks; session identity health exposes tombstone capacity and whether restart protection is retained-receipt-backed or process-only; configured SenseVoice health starts the same worker used by sessions and requires loaded runtime/config/model/token identity with full hashes; one real host diagnostic returned `ready` for sherpa-onnx 1.13.8 and the pinned model/tokens with `useItn=false`; `jiko_systemd_v1` preflight additionally rejects unsafe environment permissions, release-owned/unwritable receipt state, remote endpoints, missing built shells, and non-absolute production artifacts; strict probe treats `configured` as not ready | target audio-device/display/version gate, target end-to-end synthetic turn, or unified device support receipt |
| Hardware HIL receipt/harness | Implemented, target proof missing | strict `hardware_hil_v1` schema, semantic validator, artifact hashing, and host-simulation tests; the generated host receipt truthfully says no DUT/path and `not_evaluated` | labgrid/pytest-embedded adapters, physical fixture and calibrated instruments, real audio/control/output path, 8/24/72-hour campaign |
| Supervision/update/rollback | Service supervision implemented, target proof missing | versioned systemd server/web/device/user-kiosk units, bounded crash restart, ten-second graceful-stop escalation, immutable-release/mutable-state contract, periodic non-restarting readiness timer, host unit validation, and real server SIGTERM test | no Linux-target `systemd-analyze`/boot proof, stuck-process recovery, signed manifest/image, A/B updater, boot-health mark, automatic rollback, or rollback drill |
| Host soak / long-run / thermal / power | Implemented host harness, target proof missing | real Node HTTP server harness exercises create/idempotency, live/replayed SSE, manual/generated-WAV turns, duplicate final, receipt/disk consistency, orphan checks, RSS and latency drift; first 6-turn receipt completed 6/6 and qualifies host software integrity only | no physical microphone/STT quality/speaker, locked performance thresholds, target device, power, thermal, or 8/24/72-hour campaign |
| Functional enclosure | Specified only | reproducible appearance-model generator plus visual envelope and opening notes | no functional enclosure CAD, measured stack-up, battery, BOM, or thermal/acoustic validation |
| Safety/compliance | Unsupported | reference links only | no hazard analysis, power/battery review, EMC or material plan |

## Validation Ledger

Rows below are historical evidence for the checkout state at the time they ran.
Only a final row naming the release-candidate commit and clean CI check is merge
evidence.

| Date | Command | Result | What it proves | What it does not prove |
| --- | --- | --- | --- | --- |
| 2026-09-17 | `pnpm typecheck` | pass | current TypeScript graph typechecks | runtime behavior |
| 2026-09-17 | `pnpm build` | pass with Vite chunk warning | packages and web bundles build | browser or device behavior; showcase chunk remains over 500 kB |
| 2026-09-17 | `pnpm demo:smoke` | pass | manual loop; synthetic-audio normalization/features/semantic-view/degraded-STT receipt; explicit unavailable failure code; corrupt-audio failed-stage receipt | real speech recognition, browser capture, model quality, Pi hardware |
| 2026-09-17 | `pnpm test` | pass, 27 tests | protocol/core/readings/store/routes/DSP; dual transcript; provider deadline; failure-code and pipeline-receipt contracts | E2E, model, hardware or UX quality |
| 2026-09-17 | `pnpm --filter @jiko/protocol build && pnpm --filter @jiko/core build && pnpm --filter @jiko/server build && node --test packages/protocol/test/protocol.test.mjs packages/core/test/core.test.mjs apps/server/test/sessionStore.test.mjs apps/server/test/routes.test.mjs apps/server/test/outputScheduler.test.mjs apps/server/test/process.test.mjs apps/server/test/sse.test.mjs` | pass, 37 tests | attempt/sequence schema and reducer rules; single input/result guard; immediate result versus delayed TTS; output/process abort; scoped SSE replay and live filtering over real HTTP | native browser `EventSource`/UI behavior, actual audio playback, model quality, Pi hardware, or long-run behavior |
| 2026-09-17 | `pnpm test` | pass, 66 tests | current package/server regression suite, including shared `InstrumentScene`, reset-wins attempt/process cancellation, ordered receipt persistence, strict terminal transitions, create/start/stop replay, empty-capture error, EPIPE handling, output lifecycle, scoped SSE, DSP, and protocol/core/readings | physical browser capture, model quality, hardware, multi-process/restart recovery, or long-run behavior |
| 2026-09-17 | `pnpm test:e2e` | pass, 3/3 in system Chrome | real HTTP/SSE manual turn plus Chrome `MediaRecorder` with fake mic: local start/stop while registration is blocked, pending-to-bound identity, synchronous manual/record exclusion, nonzero blob upload, committed-response-loss replay, double activation guard, foreign-session isolation, result/TTS separation, and reduced-motion locking | physical microphone, real permission UI, track loss, native reconnect after server restart, audio-upload response loss, real playback, or target hardware |
| 2026-09-17 | `pnpm benchmark` | pass, 7/7 deterministic cases across 7,000 warmed samples; aggregate p50 0.0053 ms, p95 0.0101 ms, max 0.2955 ms on the ARM64 development Mac | reading states, negation, partial/insufficient coverage, TTS suppression, deterministic replay, and a narrow shared-core timing regression receipt | STT/model accuracy, end-to-end latency, power, thermal behavior, or target-device performance |
| 2026-09-18 | `pnpm test` | pass, 105 tests | current protocol/core/readings/server and HIL-contract suite, including canonical receipts, deadline/reset/result races, key-scoped output cancellation, persistent-worker lifecycle, readiness hashes, and adversarial lexical cases | real model quality, physical browser/audio, target hardware, multi-process/restart recovery, or long-run behavior |
| 2026-09-18 | `pnpm typecheck` | pass | current TypeScript workspace graph typechecks | runtime or hardware behavior |
| 2026-09-18 | `pnpm demo:smoke` | pass | current manual/synthetic-audio/degraded-local loop still closes after the runtime changes | real STT, target microphone/speaker, user validity |
| 2026-09-18 | `pnpm test:e2e` | pass, 3/3 in system Chrome | manual/session-isolation/reveal and fake-microphone local-first capture paths remain green | physical mic/permission/track-loss/restart and target display |
| 2026-09-18 | `pnpm benchmark` | pass, 10/10 deterministic cases over 10,000 warmed samples; aggregate p50 0.0072 ms, p95 0.0125 ms, max 0.726 ms on the ARM64 development Mac | v4 structural reading/coverage contract and adversarial cue regressions | STT accuracy, end-to-end latency, target-device performance, power or thermal behavior |
| 2026-09-18 | `pnpm test:hil`; `pnpm benchmark:hil:host`; `pnpm benchmark:hil:validate -- artifacts/benchmarks/hardware-hil-v1/latest.json` | pass, 9/9; generated and validated `hardware_hil_v1` with `host_simulation` / `not_evaluated` | HIL receipt/schema/semantic/artifact-integrity plumbing refuses false hardware claims | any DUT, physical path, power, thermal, acoustic, reliability, or qualification result |
| 2026-09-18 | `pnpm test:device`; `node --test deploy/systemd/test/*.test.mjs`; `pnpm typecheck`; `node deploy/systemd/validate-units.mjs` | pass: 5/5 device tests, 8/8 runtime-supervision tests, workspace typecheck, and 18/18 static unit checks | durable device outbox; versioned Linux unit/preflight/probe contracts; independent device/server lifecycle; strict readiness semantics; built server starts and exits cleanly on SIGTERM inside the ten-second outer stop bound | Linux/systemd parsing, target boot, GPIO/audio/display permissions, real model/media loop, process-hang recovery, update/rollback or soak behavior |
| 2026-09-18 | repeated `pnpm benchmark:stt:run -- --config /tmp/jiko-stt-synthetic-corpus-20260918/sensevoice-config.json`; `pnpm benchmark:stt:validate <receipt>` | four local-only 50-call receipts pass semantic validation with `host_measured` / `not_evaluated`; ITN-off four-thread arm: p50 `72.466 ms`, p95 `134.634 ms`, max `148.943 ms`; all 10 silence cases emitted text | real pinned runtime/model bytes executed and exposed a small synthetic regression signal | receipts are ignored, checkout was dirty, and corpus/config were temporary; this does not prove independent reproducibility, artifact license, real-speech quality, a model/thread winner, capture-to-result latency, RSS/power/thermal, or target performance |
| 2026-09-18 | `pnpm test:soak-receipt`; `pnpm benchmark:soak`; `pnpm benchmark:soak:validate -- artifacts/benchmarks/host-soak-v1/latest.json` | pass, 8/8 schema/semantic tests; real-server campaign completed 6/6; host-software integrity `pass`, every hardware/STT/performance/release category `not_evaluated` | HTTP/SSE/session/receipt integrity plus observable host latency/RSS wiring | microphone, speech recognition, playback, target reliability, locked performance, power, thermal, or release qualification |
| 2026-09-18 | `pnpm --filter @jiko/protocol build`; `pnpm --filter @jiko/protocol typecheck`; `node --test packages/protocol/test/*.test.mjs` | pass, 21/21 | strict ordered-PCM schema/reducer behavior, including duplicate/order/profile/final-total/gap evidence | browser/Pi transport, audio retention, provider streaming, network loss, or target hardware |
| 2026-09-18 | `pnpm test`; `pnpm test:e2e`; `pnpm demo:smoke`; `pnpm benchmark` | pass: 5 device tests, 8 runtime-supervision tests, 137 protocol/core/readings/server/HIL tests, 28 STT/soak tests, 3/3 Chrome E2E, smoke, and 10/10 structural benchmark; build retains a 581.19 kB showcase-chunk warning | current exact-silence gate, ordered PCM contract, local/remote STT trust boundaries, FunASR identity, cancellation/deadlines, two shells, and structural readings regress together | physical microphone/permission/track loss, real remote call, durable model corpus, Pi/CM5, enclosure, power, thermal, or long-run release proof |
| 2026-09-18 | `pnpm benchmark:soak`; `pnpm benchmark:soak:validate -- artifacts/benchmarks/host-soak-v1/latest.json` | pass, 6/6 result turns; validator accepts the generated receipt after the CLI was made tolerant of pnpm's literal `--` | current real-server host integrity path and its documented validator command | performance/release qualification, physical audio, STT quality, target hardware, power, or thermal behavior |
| 2026-09-18 | `pnpm test` | pass: workspace build, 6/6 device tests, 8/8 runtime-supervision tests, 152 protocol/core/readings/server/HIL tests, and 28 STT/soak tests | integrated ordered-PCM protocol/server actor, handshake security, source hash, stop retry, existing pipeline/provider contracts, and benchmark schemas regress together | physical mic, browser runtime, Pi/CM5, model winner, power, thermal, or release qualification |
| 2026-09-18 | `pnpm test:e2e` | pass, 4/4 in system Chrome | manual/reveal behavior, explicit batch compatibility, and real Chrome AudioWorklet fake-mic PCM through WebSocket to a continuous source-hashed receipt and nonempty WAV | physical microphone, permission prompt, Safari/mobile, reconnect/restart, incremental ASR, or target hardware |
| 2026-09-18 | `pnpm test`; `pnpm test:e2e`; `pnpm demo:smoke`; `pnpm benchmark` | pass: workspace build, 6/6 device tests, 8/8 runtime-supervision tests, 159 protocol/core/readings/server/HIL tests, 28 STT/soak tests, 6/6 Chrome E2E, smoke, and 10/10 structural benchmark; build retains the 581.19 kB showcase-chunk warning | exact HTTP/WS Origin gates, loopback source default, mono 16/44.1/48 kHz ordered-profile rejection, bounded browser transport, terminal readback after a deliberately dropped final ACK, and the existing local pipeline/provider contracts regress together | physical microphone/permission/track loss, Safari/mobile, reconnect/chunk replay, restart WAL, real-speech model selection, Pi/CM5, power, thermal, or release qualification |
| 2026-09-18 | `pnpm test`; `pnpm test:e2e`; `pnpm demo:smoke`; `pnpm benchmark`; `pnpm benchmark:soak`; `pnpm benchmark:soak:validate -- artifacts/benchmarks/host-soak-v1/latest.json` | pass: workspace build, 6/6 device tests, 8/8 runtime-supervision tests, 166 protocol/core/readings/server/HIL tests, 28 STT/soak tests, 9/9 Chrome E2E, smoke, 10/10 structural benchmark, and 6/6 host-soak turns; build retains the 581.19 kB showcase-chunk warning | blank-HOST loopback fallback, independent exact HTTP/WS Origin policy, SSE Origin preservation, ordered source-duration/resource caps, permission/unsupported/resume-hang UI, final-ACK readback, and host-software integrity regress together | physical microphone/native permission prompt/track loss, Safari/mobile, reconnect/chunk replay, restart WAL, global pipeline byte admission, real-speech model selection, Pi/CM5, power, thermal, or release qualification; soak hardware/STT/thermal remain `not_evaluated` |
| 2026-09-18 | `pnpm --filter @jiko/server typecheck`; `pnpm --filter @jiko/server build`; `node --test --test-concurrency=1 apps/server/test/audioResourceAdmission.test.mjs apps/server/test/routes.test.mjs`; `node --test apps/server/test/orderedPcmWebSocket.test.mjs` | pass: typecheck, build, 35/35 admission/route tests, and 19/19 ordered-PCM tests | fail-closed resource configuration; synchronous process-wide HTTP/ordered-spool byte and slot reservations before retention/write; pipeline byte/concurrency leases; typed rejection receipts; health limit/in-use/rejection counters; release after success, exception, disconnect, timeout, and actual settlement of cancelled noncooperative work | the broad parallel server suite was not a clean gate on the heavily loaded host; multi-process quota, request-body idle abort, physical/target load, RSS pressure threshold, and release qualification remain unproved |
| 2026-09-18 | `pnpm test:device` | pass, 18/18 | existing button-outbox behavior plus fake-process native PCM start/stop, bounded overflow/xrun evidence, ACK-failure cancellation, process escalation, exact frame clock/hash/counters, masked dependency-free WebSocket exchange, strict final-receipt/forgery checks, visible invalid-configuration failure, and Python JPCM decoded by the built TypeScript protocol | physical ALSA/microphone, GPIO/audio ownership, first-phoneme safety, Pi/CM5 load, reconnect/WAL, power, thermal, or long-run behavior |
| 2026-09-18 | `pnpm --filter @jiko/server build`; one-shot injected PCM subprocess through `Rfc6455OrderedPcmTransport` to the live loopback server | pass: finalized ACK, 5 chunks, 12,800 received bytes, matching source SHA-256, `coverageComplete=true` | the dependency-free client interoperates with the actual Node upgrade/ACK actor and canonical post-stop pipeline for paced synthetic PCM | a committed automated integration harness, `arecord`, physical audio, Pi/CM5, loss/reconnect/restart behavior, model quality, power, thermal, or endurance |
| 2026-09-18 | `pnpm test`; `pnpm typecheck`; `pnpm benchmark`; `pnpm test:e2e`; `pnpm demo:smoke` | pass: full workspace gate including 29/29 device, 8/8 runtime-supervision, 157/157 server, 32/32 STT/soak, 11/11 Chrome journeys, 10/10 structural benchmark, and smoke; build retains the 581.19 kB showcase-chunk warning | result invariants, private receipt permissions, UTF-8/path boundaries, bounded session identity retirement and restart rejection, device quarantine, resource accounting, second-device-session discovery, capture-unavailable observer UX, and the canonical local audio paths regressed together in that checkout | physical microphone/native prompt/track loss, Raspberry Pi/CM5 execution, real-speech model selection, multi-process coordination, identity after receipt pruning, enclosure, power, thermal, endurance, or standalone hardware release qualification |
| 2026-09-22 | `pnpm test`; `pnpm typecheck`; `pnpm benchmark`; `pnpm test:e2e`; `pnpm demo:smoke` | pass: workspace build, 35/35 device tests, 8/8 runtime-supervision tests, 70/70 shared protocol/core/readings/HIL tests, 161/161 server tests, 32/32 STT/soak tests, workspace typecheck, 11/11 Chrome journeys, smoke, and 10/10 structural benchmark; build retains the 581.19 kB showcase-chunk warning | exact device ACK typing, closed HTTP error handles, explicit invalid session-ID rejection without breaking omitted-ID creation, ordered PCM, attempt deadlines, local-first provider boundaries, and the human-facing desktop paths regress together in this checkout | physical microphone/native permission prompt/track loss, real-speech model selection, Raspberry Pi/CM5 execution, multi-process coordination, enclosure, power, thermal, endurance, or standalone hardware release qualification |
| 2026-09-23 | release-candidate commit `2612f95`; [GitHub Actions `ci / validate`](https://github.com/p-to-q/jiko/actions/runs/35737150715/job/106777232148?pr=9) | pass on the code release candidate; the only subsequent change is this evidence-ledger row | the exact code candidate built and passed the repository CI on Linux after the portable UTF-8 runtime fix | external Vercel project deployment, physical microphone/native permission prompt/track loss, real-speech model selection, Raspberry Pi/CM5 execution, enclosure, power, thermal, endurance, or standalone hardware release qualification |

## Immediate Release Blockers

1. Session/attempt binding and scoped replay now exist in the shared reducer,
   server, and web source. Secure-capable browsers default to `AudioWorklet`
   ordered PCM; `?audioCapture=batch` forces the `MediaRecorder` control.
   Ordered capture retains a bounded source archive until `finalized`, while
   the batch path retains its blob until upload resolves. Pending and bound
   session ids are explicit, but the physical mic/permission/track-loss path is
   unproved and `deviceId` is not yet part of the tuple. The Pi button adapter
   records timing/order without waiting for HTTP, and a separate host-tested
   ALSA adapter can stream bounded JPCM. They do not yet share turn ownership;
   registration/connection still precedes capture, and there is no audio
   reconnect/WAL, so an outage can still lose the utterance or first syllable.
2. The live device now projects its scene from the shared core, but the
   website/showcase texture still uses separate presentation state, so the
   public product face can still drift from runtime behavior.
3. A pinned real local SenseVoice conversion now has repeated local synthetic
   discovery receipts, but the ignored receipts and temporary corpus/config are
   not a durable reproducibility bundle, and there is no decision-grade
   human/noise corpus or Pi/CM5 result. It
   also emitted text on every digital-silence fixture, and ITN changed a faithful
   English token. Exact all-zero PCM is now safely gated, but quiet/noisy
   no-speech remains uncalibrated. Until transcript transforms, randomized
   model/thread comparisons, and target measurements pass, SenseVoice is only
   the integrated batch baseline.
4. The Pi shell is not self-contained and the physical body is not a functional
   enclosure.
5. HTTP session and input-event retries have finite in-process replay; retired
   client IDs are tombstoned, retained creation receipts prevent silent ID reuse
   after restart, and the device quarantines a typed retired-ID turn. That
   protection ends when receipts are disabled/pruned and is not coordinated
   across server processes. Reset cancels attempt-owned ffmpeg/STT work without
   allowing a late pipeline or receipt snapshot to overwrite terminal state.
   Ordered PCM has attempt and sequence identity plus process-spooled ACKs, but
   no reconnect/replay or restart-recoverable ownership. Audio upload still has
   no operation id; button operations have a local durable outbox, but audio
   bytes and server state have no durable ownership, authenticated write
   boundary, distinct per-chunk idle policy, multi-process coordination, or
   preemptible synchronous DSP. The
   immutable attempt deadline now aborts a still-open body. Source defaults
   to loopback; any LAN profile still needs HTTPS/WSS, exact origins, bootstrap
   identity, attempt-scoped write capabilities, protected receipt/SSE reads, and
   startup refusal when those controls are absent. The hard deadline seals state
   but cannot interrupt a blocked event loop.
6. Loaded SenseVoice readiness and worker shutdown now sit behind a checked-in
   `jiko_systemd_v1` server/web/device/kiosk supervision contract with strict
   preflight/readiness and bounded restart/stop behavior. It is host-tested
   configuration, not an installed target: there is still no Pi/CM5 systemd and
   offline-boot receipt, stuck-process recovery, complete physical device-health
   gate, signed image, A/B update, boot-health mark, or rollback drill.
7. Browser E2E covers manual success, foreign-session filtering, result/TTS
   separation, repeated device-session discovery without stale pollution, the
   320 × 480 capture-unavailable observer state, reduced motion, fake-device batch and
   ordered capture, a dropped
   batch-start response, a deliberately dropped ordered final ACK with terminal
   readback, long-main-thread credit pressure, rapid double activation, pending
   identity, synchronous manual/record exclusion, and injected permission,
   unsupported-capability, and audio-context-resume failures. It does not cover a
   physical mic/native permission prompt/track loss, batch-upload response loss,
   ordered chunk reconnect/replay, native SSE restart recovery, reset during
   inference in a browser journey, or a target-display accessibility/legibility
   run.
8. `hardware_hil_v1` can now record and reject malformed evidence, but its only
   run is a metadata-only host simulation with qualification `not_evaluated`.
   There is still no DUT thermal, power, acoustic, recovery, or long-run evidence.

These blockers do not prevent a controlled demonstration. They prevent calling
the current repository an always-on instrument.
