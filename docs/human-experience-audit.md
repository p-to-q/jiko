# Human Experience And Interface Audit

Status: **original audit retained; manual and fake-device browser P0 follow-up implemented, hardware closure still open**
Audited: **2026-09-17**

## Outcome

The initially audited localhost build was useful as an engineering preview, but
was not a trustworthy participant-facing test surface. The most important
problem was not visual polish: the device face and the receipt panel could
follow different sessions, so a person could see one conclusion on the
instrument and a different turn in the observer. That was a P0
product-integrity failure.

The follow-up implementation now carries explicit attempt/sequence identity,
uses a scoped SSE stream after an active session is selected, shares that active
session between the recorder and device event hook, and enforces one input claim
and one final result on the server. Node reducer, route, store, and real-HTTP SSE
tests cover those boundaries. System-Chrome E2E proves that a visible manual
turn keeps its session/result when a foreign session completes, that explicit
`MediaRecorder` batch capture can start before backend registration, and that
the explicitly forced `AudioWorklet` ordered-PCM path produces continuous
source-hashed fake-mic coverage through a nonempty server WAV. Source defaults
to that path in a secure-capable browser, but implicit selection is not a
separate E2E. Pending/bound identity is explicit, a same-task manual fallback
cannot acquire a second input lease, and simulated permission denial,
unsupported capability, and a hung audio-context resume have distinct UI
outcomes. Native reconnect/restart, physical mic/native-permission/track-loss behavior,
Safari/mobile coverage, first-partial latency, previous-result-to-pending proof,
and stale receipt cases remain open.

The live instrument and observer now derive the device scene from the canonical
shared session reducer and framework-neutral `InstrumentScene`. The public site,
showcase texture, and scripted demo remain separate presentation state. They can
still drift until they replay the same pure scene contract.

The first typography defect is fixed locally: human-facing Chinese now has an
explicit CJK system stack, the manual input is 16 px, turn values are 15 px, and
labels/hints are 12–13 px with reduced tracking. The device still needs a small,
characterful bitmap voice, and the offline Pi build still lacks a bundled full
CJK body font and physical legibility proof.

## Audit Scope And Method

This audit combined:

- a desktop visual pass of the live localhost preview;
- a real interaction through the running local backend with unavailable local
  STT, to inspect degraded behavior and stage receipts;
- a manual fallback interaction using a hesitation/negation test phrase;
- semantic inspection of focusable controls, labels, state, and response copy;
- source inspection of the website, showcase texture, live event reducer,
  recorder, observer, responsive rules, and font declarations.

The implementation follow-up also inspected the current session store, scoped
SSE route, output scheduler, web identity binding, and their Node tests. It then
ran native system-Chrome E2E through real HTTP/SSE for the manual and
reduced-motion paths plus `MediaRecorder` and `AudioWorklet` over Playwright's
fake microphone. It also injects permission denial, missing ordered-capture
capability, and a non-resolving `AudioContext.resume`; these are controlled
browser simulations, not a native prompt. It did not exercise a physical microphone, the real
permission prompt, mid-session track loss, native reconnect after server
restart, or a physical speaker.

It did not include a physical MPI3508 viewing-distance test, screen-reader run,
low-vision study, multi-person usability study, or measured browser frame-time
trace. Those remain required evidence, not implied successes.

## Surface Inventory

| Surface | Intended audience | State source now | Finding |
| --- | --- | --- | --- |
| `/site.html` / public site | prospective visitor | staged website state plus a separate Three.js screen texture | strong product atmosphere; not the live instrument renderer |
| `/showcase.html` | industrial-design review | local showcase animation | useful material study; not a runtime proof |
| `/demo.html` | visual demo | scripted demo behavior | can drift from live state and fallback behavior |
| `/?mode=device` | participant / physical screen | unscoped discovery until a device session is found, then session-scoped SSE, shared reducer/scene, plus a local recorder scene and explicit pending id while registration is pending | manual isolation, pending-to-bound identity, fake-device local-first capture, and simulated permission/capability/resume failures are proved; physical mic/native permission/track loss, reconnect/restart, previous-result transition, and target-panel proof remain |
| `/` preview | operator during development | canonical active identity plus explicit pending/visible identity, scoped event hook, shared reducer/scene, local capture overlay, and receipt tools | manual/foreign-session/reduced-motion and fake-device capture E2E pass; same-task manual/record contention is rejected by a synchronous lease; upload-response loss and previous-result-to-pending proof remain |

These are views, not permission to create more product runtimes. Jiko still has
one shared core and two runtime shells: laptop and device. Website, participant,
facilitator, and lab modes must be adapters over one protocol and scene model.

### Deployed website and localhost are not version-identical

The audit fetched the canonical site on 2026-09-17. The deployed HTML referenced
`site-B5HfAYbP.js` and `site-BmU6Agzi.css`; the current local production build
referenced `site-SN-USCjy.js` and `site-CUDCssDk.css`. Content hashes alone do not
say which presentation is aesthetically preferable, but they prove that
“localhost is the latest website” is not currently a safe assumption.

Every build should expose one support/version receipt containing at least the
source commit, dirty flag, web asset manifest hash, protocol version, scene
schema version, model manifest hash, and hardware profile. The website deploy
check should compare the expected asset manifest after release instead of using
visual similarity as version evidence.

## Interaction Findings

### P0 finding — one visible turn could contain two sessions

In the audited build, `useDeviceEvents` consumed every event on the global SSE
connection and updated the device from whichever session spoke most recently.
`useRecorder` created and retained a local session for the current recording or
manual fallback. The observer fetched that recorder session, while the device
continued to follow the global stream.

Observed consequence during the fallback test:

- the instrument top strip showed an insufficient/short-round message;
- the receipt panel described a different conclusion for the submitted turn;
- recent/debug state could remain stale or belong to another visible session.

Required invariant:

> Every participant-visible pixel, receipt, playback action, and control for one
> turn is keyed by the same `(deviceId, sessionId, attemptId, sequence)` tuple.

No UI redesign, model comparison, or PCB work should pass a release gate until
this invariant has an automated two-session interleaving test.

Implementation follow-up:

- every protocol event now carries `sessionId`, `attemptId`, and a positive
  server sequence; the UI exposes the active values as debug data attributes;
- after session selection, replay and live events use
  `/events?sessionId=<id>`, and the reducer ignores duplicates/foreign attempts
  while surfacing sequence gaps;
- the real-HTTP SSE test proves session A replay excludes B, ids use
  `attemptId:sequence`, `Last-Event-ID` returns only missing A events, and live B
  is filtered while live A arrives;
- the server accepts only one `audio` or `manual` input claim and one final
  result, while the UI source mutually disables manual and recording actions
  during an active claim.

This is no longer source-only evidence. The Chrome E2E submits a real manual
turn, waits for the fully revealed result, creates and completes a second
foreign session through HTTP, and verifies the visible session identity and
copy do not change. A second E2E uses Chrome's real `MediaRecorder` API with a
fake microphone: capture starts and stops while session creation is blocked, a
start response is dropped after server commit and replays without duplication,
double activation starts/stops once, a simultaneous manual submit cannot create
a second session, pending identity becomes the same bound identity, and a
nonzero blob uploads in canonical order.

The runtime shell now masks any previous result while a local turn is pending:
capture uses amber/resting lamps, seal/analysis uses dim/spinning lamps, and the
root exposes visible and canonical phase separately. Before the server returns
an attempt, the client-generated id is explicitly `pending`; the canonical
active tuple remains separately labelled and the operator displays the pending
id instead of presenting an old tuple as current. A dedicated previous-result
to blocked-registration browser test, native `EventSource` restart recovery,
physical mic/permission/track-loss behavior, upload response loss, and the
missing `deviceId` still need automated proof.

### P0 finding — computation time and ritual time were conflated

The local pipeline receipt in the audited degraded run completed in about
1.4 seconds. In that build, after a result arrived, the live UI used fixed
reveal locks at 1.9, 3.15, and 4.45 seconds and continued presenting the device
as processing until the final lock.

Slow ritual is a valid artistic choice. False computation is not. The event
receipt must distinguish:

- input and provider latency;
- time to first stable signal;
- time to complete result;
- optional reveal/afterglow duration.

The participant needs immediate acknowledgment and truthful progress. A longer
ceremonial reveal may run after the conclusion is already stable, but must be
cancellable, reduced-motion aware, and excluded from model latency.

The follow-up separates these paths in code:

- `session.result` is stored and published before local TTS is scheduled, and
  the HTTP result response does not wait for the configured TTS delay;
- the live reducer makes the received result available immediately, with reveal
  locks at 0, 450, and 900 ms; reduced-motion mode locks all three immediately;
- reveal identity uses `attemptId:resultSequence`, so duplicate replay does not
  intentionally restart the same reveal;
- local output is latest-wins and cancellable on a newer output, new session,
  new recording, reset, error, or server shutdown. Abort signals propagate to
  local clip/Piper processes.

The route, scheduler, and process tests prove that delayed TTS does not block
the result response and that reset wins over both cooperative and noncooperative
late pipeline completion. Attempt cancellation reaches ffmpeg, Whisper/Sherpa
processes, and FunASR HTTP waits; same-session receipt writes cannot persist an
older snapshot after reset. The tests do not measure browser paint time, reveal
smoothness, real speaker startup, target Piper/audio cancellation, capture before
the release-to-result deadline starts, request-body idle behavior, preemption
inside synchronous DSP, or multi-process writes.

### P1 — participant and engineer are mixed into one interface

The preview puts the physical face beside provider names, session identifiers,
pipeline stages, JSON-like receipts, an English `Fallback` label, and a manual
transcript textarea. This is valuable in a lab, but it is not a neutral human
test surface. It tells participants how the system is built and asks them to
interpret engineering state.

Create three modes in the same web application:

1. **Participant** — instrument plus one simple record/retry affordance; no
   provider names, confidence theatre, manual fallback, or raw debug data.
2. **Facilitator** — session identity, consent state, retry/reset, and a compact
   truth label for measured/simulated/degraded input.
3. **Lab** — complete stage waterfall, feature and provider receipts, scenario
   injection, thermal/memory/audio-health data, and exportable benchmark trace.

Manual controls remain a protocol client in facilitator/lab mode. They do not
get a separate fake rendering path.

### P1 — progress and recovery are not bounded enough for a person

The control can remain on a generic analyzing/requesting label without showing
which bounded stage is active or what happens at the deadline. A 90-second
browser analysis ceiling is a safety stop, not an acceptable product promise.

Participant progress should be a small state vocabulary:

- `已收到` — local acknowledgment;
- `正在听清` — STT/feature work within the product deadline;
- `先给出两路` — explicit measured partial result;
- `这一轮没有听清` — stable retry state;
- `设备正在恢复` — worker/service restart, with a bounded next action.

There should be no indefinite spinner and no normal-looking result built from an
empty transcript or missing acoustic evidence.

### P1 — the website display contract remains duplicated

The live React/DOM device now applies the canonical session reducer and projects
a framework-neutral `InstrumentScene` from `@jiko/core`; reveal choreography is
a Web adapter layered over that scene. The website hardware object still renders
another screen implementation in `ui/showcaseScreenTexture.ts`, with its own
layout, assets, and timing. Matching colors and sprites do not make these the
same instrument.

The remaining redesign should feed that shared `InstrumentScene` to every
renderer:

```text
protocol events -> shared reducer -> InstrumentScene
                                    -> DOM/canvas kiosk renderer
                                    -> Three texture website renderer
                                    -> golden-frame renderer
```

The public site should normally replay a checked-in synthetic event trace. It
does not need a production backend connection, but the trace must exercise the
same reducer and scene values as the real instrument.

### P2 — responsive layout is an engineering preview, not a test cockpit

At desktop width, the fixed 320 × 480 device and narrow control column leave a
large amount of unused space while receipts remain dense and small. Below the
current breakpoint the panes stack, but information priority does not change.

The lab layout should use the space for a time-aligned waterfall and comparison
table. The participant layout should remove the column entirely. The physical
device view must remain exact-pixel and should never scale through a fractional
CSS transform during hardware validation.

## Typography Direction

### Current state and remaining problems

- `--font-body` now defines an explicit Noto/Source Han/PingFang/Microsoft YaHei
  CJK stack. Dynamic Chinese uses it instead of the fixed-copy Glow subset.
- The manual input is 16 px/1.6; turn values are 15 px; labels, caveats, hints,
  and status copy are 12–13 px with less CJK letterspacing. Computed-style
  checks in Chrome confirmed those roles.
- This is still host-font dependent. Pi/offline rendering cannot be identical
  until a licensed full CJK face is bundled and hashed.
- `Glow Sans SC Condensed` remains appropriate only for controlled short
  device/result copy covered by its glyph subset.
- The public site imports remote Google Fonts, so offline and first-load
  rendering cannot be identical to the instrument/test environment.
- The candidate bitmap device voice and readable body face still need the
  physical 35/50/70 cm matrix below.

### Proposed three-role system

| Role | Candidate | Use | Constraint |
| --- | --- | --- | --- |
| device signal voice | Fusion Pixel 12 zh-Hans proportional, with ZhengGeDianHei 16 as a visual challenger | top-strip result, phase/status, very short fixed copy | render at native or integer-multiple sizes; validate every shipped glyph |
| human Chinese UI | locally bundled Source Han Sans SC or Noto Sans SC subset/full licensed build | instructions, test questions, errors, transcript and receipts | regular proportions; at least 14–16 CSS px in desktop controls |
| telemetry | existing Geist Mono | timestamps, model ids, stage durations, hashes | never force Chinese paragraphs through it |

[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font) provides
OFL-licensed 8/10/12 px pan-CJK builds and both monospaced and proportional
families. Proportional is the default candidate for prose-like short Chinese;
monospace is reserved for a deliberate grid. [ZhengGeDianHei
16](https://github.com/yzdnn/ZhengGeDianHei-16) is an OFL-licensed 16 px Chinese
bitmap challenger. Zpix should not be adopted casually because its repository
requires a separate commercial product license.

Do not make the entire console pixelated. The distinctive device voice should
sit beside a calmer, highly readable human layer. That contrast is the intended
design signature: **a strange little instrument held inside an honest modern
test bench**.

### Font acceptance test

Before selection:

1. Render the entire fixed copy pool, digits, punctuation, Latin acronyms, model
   failure messages, and representative Simplified Chinese at 1×/2×/3×.
2. Test on the actual 320 × 480 panel at 35, 50, and 70 cm under bright and dim
   light; photograph moiré and bleed rather than judging a Retina screenshot.
3. Check missing-glyph fallback and line wrapping with mixed Chinese/English.
4. Test antialiasing on the actual browser/OS image. Use integer coordinates;
   do not assume `font-smooth: none` creates a real bitmap on every renderer.
5. Record license, source commit, subset command, glyph manifest, and font hash.

## Proposed Human-Perception SLOs

These are **Jiko alpha hypotheses**, not claims that users have validated the
exact thresholds. They combine established interaction guidance with the need
for a quiet physical ritual and must be tuned through tests.

| Measure | Proposed gate | What the person should perceive |
| --- | ---: | --- |
| button/touch to visual, LED, or haptic acknowledgment | p95 <= 100 ms; hard <= 200 ms | the device caught the action |
| stop/release to `已收到` | p95 <= 150 ms | speech is sealed; no double press needed |
| stop to first stable measured signal | p95 <= 700 ms | the instrument is making progress, not frozen |
| stop to complete warmed visual result | p50 <= 1.2 s; p95 <= 2.5 s | one conversational turn remains continuous |
| hard product deadline | 4 s | show measured partial/unavailable or retry; never an indefinite spinner |
| fixed local playback start after visual result | p95 <= 500 ms | sound confirms, but never blocks, the visible result |
| web control responsiveness | p75 INP <= 200 ms | observer controls feel immediate |
| main-thread freeze | no task > 100 ms during live interaction | animation may be 20–30 fps, but input remains responsive |

Google classifies an INP at or below 200 ms as good. A 2025 controlled study of
free-form voice agents found that response delays at or above four seconds
significantly degraded conversational experience. Those sources support the
orders of magnitude; the exact Jiko targets above are design decisions and
must remain labelled as such.

Sources:

- <https://web.dev/articles/inp>
- <https://arxiv.org/abs/2507.22352>
- <https://www.nngroup.com/articles/response-times-3-important-limits/>

## Redesign Acceptance Sequence

1. Extend the passing manual/foreign-session, batch, and ordered-PCM fake-device
   journeys to physical microphone/permission/track-loss tests, Safari/mobile,
   native reconnect after restart, previous-result-to-pending identity, and
   stale responses.
2. Measure the implemented compute/reveal/TTS separation in browser and on the
   real speaker. Result publication is no longer gated by TTS, but frame timing,
   playback-start p95, and target cancellation remain unproved.
3. The shared `InstrumentScene` now drives the live kiosk/preview. Use it next
   for the website texture, scripted demo, and golden frames.
4. Split participant, facilitator, and lab information architecture without
   creating another state machine.
5. Typography tokens and human-facing sizes are fixed; bundle a full local CJK
   face, select the device bitmap face, and run the physical font matrix.
6. Add automated browser journeys for success, partial, timeout, unavailable,
   reconnect, reset-during-inference, and reduced-motion behavior.
7. Run five-person formative tests before styling refinements: ask what happened,
   what was measured, what failed, and what action is available without giving
   them a system explanation first.

The next UI implementation should not begin with color or spacing. It begins
with session truth, time truth, and audience separation.
