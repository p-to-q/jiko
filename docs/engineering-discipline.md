# Engineering Discipline

This document defines how humans, coding agents, and humans operating coding agents should change this repository.

It is adapted in spirit from `p-to-q/repo-template`'s engineering discipline, then rewritten for this private hardware/software prototype.

## Core Stance

Work as a careful maintainer of the object, not as a generator of more code.

The goal is the smallest correct change that preserves the product shape:

- One shared product core.
- Two runtime shells: laptop app and Raspberry Pi hardware.
- A four-window UI driven by events.
- Real local audio receipts where possible.
- A concise demo surface that does not become an AI advisor.

## Repository-First Behavior

### 1. Read Before Write

Before changing a surface, read the smallest useful set of files around it:

- Nearby source.
- Relevant docs.
- Existing contracts and schemas.
- Validation commands, if they exist.
- Any examples that already define the local pattern.

Do not let a chat summary, issue title, generic best practice, or outside template override what the repository actually says.

### 2. Match Local Patterns First

Local conventions win unless they are clearly wrong for the current task.

Extend an existing path before creating a parallel one. Prefer editing an existing file over adding a new file when the existing file is the right home.

### 3. Identify Constraints Before Implementation

For non-trivial work, briefly identify:

1. The actual problem.
2. Real constraints.
3. Behavior that must stay unchanged.
4. The smallest valid solution.
5. Validation to run.
6. What should remain untouched.

Do not start with broad rewrites, speculative architecture, or new frameworks.

## Change Discipline

- Make the smallest effective change.
- Preserve existing behavior unless the task asks for a behavior change.
- Avoid unrelated cleanup, formatting churn, dependency updates, and file moves.
- Do not widen scope without a concrete reason.
- Do not invent public APIs, requirements, wrappers, dependencies, or runtime surfaces that the project does not imply.
- If a larger cleanup is genuinely needed, name it explicitly instead of hiding it inside a feature change.

## Architecture Discipline

- Prefer simple, explicit, well-bounded design.
- Keep the shared core free of laptop-only and Pi-only details.
- Keep hardware code at the edge.
- Keep UI rendering separate from audio analysis and reading decisions.
- Keep request handling, local provider calls, reading logic, and result composition easy to distinguish.
- Keep modules cohesive and interfaces narrow.
- Avoid generic dumping grounds such as `utils`, `helpers`, `common`, or `misc` unless the cross-cutting reason is real and documented.
- Do not abstract early. Every abstraction should solve a present problem.
- Prefer local reasoning over distributed indirection.

## Project-Specific Boundaries

Shared core:

- Session state machine.
- Event protocol.
- Reading contract.
- Result composition.
- UI state model.

Runtime adapters:

- Browser recording.
- Raspberry Pi GPIO.
- Device audio.
- Local STT/TTS provider calls.
- Kiosk or desktop launch behavior.

If a GPIO pin, microphone, local STT provider, screen, or speaker changes, the shared product core should not need to change.

## Code Style

- Prefer clarity over cleverness.
- Prefer explicit behavior over hidden magic.
- Prefer flat control flow over deep nesting.
- Use guard clauses and early returns when they improve readability.
- Use intention-revealing names; longer names are fine when they remove ambiguity.
- Keep functions focused.
- Keep modules cohesive.
- Comments should explain reasons, constraints, tradeoffs, or non-obvious behavior. Do not comment by paraphrasing syntax.
- Make diffs easy to review and easy to roll back.

## Robustness And Failure Handling

- Do not hide errors.
- Do not silently swallow exceptions without a clear reason.
- Preserve useful diagnostic information.
- Treat external input as untrusted.
- Validate assumptions at runtime boundaries: HTTP, WebSocket, browser audio, STT/TTS providers, files, GPIO, and device audio.
- Make invalid states difficult to represent.
- Keep fallback paths explicit and deliberate.
- Prefer dependable solutions over clever fragile ones.
- Prefer states, errors, artifacts, and logs that humans can inspect.

## Audio Receipts

Audio behavior should be inspectable in dev mode.

For real sessions, try to retain:

- Transcript.
- Recording duration.
- Speech duration.
- Silence and pause data.
- Basic energy and pitch features.
- Three reading outputs.
- Local provider names and latency.

Do not claim that a reading is meaningful unless there is a visible signal behind it.

Raw recordings should be dev-only unless the team explicitly decides otherwise.

## Testing And Validation

Do not claim success without evidence.

Preferred validation order:

1. Narrowest relevant test.
2. Type check.
3. Lint or formatting check.
4. Build.
5. Fixture, golden, or manual UI check.
6. Broader regression check when the change touches shared behavior.

Rules:

- State exactly what was verified.
- Do not imply checks that were not run.
- Add or update tests when behavior changes and tests are appropriate.
- Test behavior rather than implementation trivia where practical.
- If validation was not run, say `Not run` and explain why.
- If confidence is partial, say so clearly.

## Receipts Over Claims

Do not call something fixed, faster, safer, supported, production-ready, or robust unless there is evidence:

- A passing test.
- A fixture.
- A script result.
- A benchmark.
- A built artifact.
- A manual check.
- A documented limitation.

## Decision Traces

Not every change needs an ADR or RFC. Most hackathon work should not.

Use the lightest durable trace that preserves the reason:

- PR note for local reversible changes.
- `docs/open-questions.md` for unresolved choices.
- `docs/next-phase-checklist.md` for near-term implementation decisions.
- A short research note when external prior art or a spike drives the decision.
- An ADR only if the decision becomes durable and expensive to reverse.

Decision-bearing changes include:

- License or repository visibility.
- Security or privacy behavior.
- Release or deployment workflow.
- Public API or event protocol.
- Hardware adapter contract.
- Product doctrine.
- Agent/operator demo control.

## Experimental Surfaces

Experimental code is allowed. Unmarked experimental code is not.

Use README status text, docs notes, folder names, or dev-only flags to distinguish:

- Stable.
- Prototype.
- Experimental.
- Stub.
- Archived.
- Unsupported.

Manual demo controls are allowed, but they must emit the same event protocol as the real pipeline. No separate fake UI path.

## Stack-Specific Guidance

Use these rules only when they match the files being edited.

Frontend:

- Keep components focused.
- Keep business logic out of presentation where practical.
- Avoid deeply nested JSX.
- Preserve UI behavior unless the task asks for a change.
- Prefer Canvas/PixiJS for dense block animation over many DOM nodes.

Backend:

- Separate request handling, local provider calls, reading logic, and persistence.
- Validate inputs at HTTP/WebSocket boundaries.
- Preserve meaningful local provider errors.
- Consider observability and rollback when touching shared behavior.

TypeScript:

- Keep types readable and intention-revealing.
- Avoid type machinery that hides behavior.
- Put shared schemas in `packages/protocol`.
- Keep runtime adapters out of shared core packages.

Python:

- Use Python when it makes audio, GPIO, or model integration materially simpler.
- Keep Python workers behind a simple process or HTTP boundary.
- Do not let Python-only structures leak into the TypeScript protocol.

Raspberry Pi:

- Treat Pi code as a hardware adapter.
- Keep GPIO, microphone, speaker, and kiosk details isolated.
- Prefer boring local services over clever device orchestration.

## Profile Expectations

This repo currently uses a private `micro+` profile.

| Profile | Expectation |
| --- | --- |
| `micro` | Small changes, honest validation, no surprise claims. |
| `micro+` | Same as `micro`, plus clear runtime boundaries and audio receipts. |
| `standard` | Add CI, clearer issue/PR hygiene, and dependency automation. |
| `strict` | Durable decisions need owner review and usually ADR linkage. |
| `research-strict` | Research feeds issues, RFCs, ADRs, or implementation plans. |

## PR Quality Checklist

Use this checklist when the repo moves to pull requests:

- The branch has one purpose.
- The PR explains what changed and why.
- Validation is explicit.
- Risks are named.
- Docs changed when behavior or product surface changed.
- Decision-bearing changes reference the relevant note, checklist, ADR, or say why none is needed.
- The worktree is clean.

## Agent-Specific Rules

Agents must not:

- Create broad rewrites to make a local task easier.
- Invent maintainer intent that is not present in the repo or current user request.
- Treat generated output as a substitute for tests or manual checks.
- Hide uncertainty.
- Add files, routes, or abstractions merely because a template suggests them.
- Convert the product into an AI advisor by accident.

Agents should:

- Read before editing.
- Use the shared event path for demo controls.
- Keep audio and hardware assumptions visible.
- Leave a handoff note when work is partial or blocked.

## Sample Change Report

```text
Summary: add a browser recording path for the laptop prototype.
Why: the first demo needs a fast way to capture one spoken intention before Pi audio is ready.
Validation: npm run typecheck passed; manually recorded one WebM clip in Chrome.
Risks: Safari recording format not verified; Pi microphone path still pending.
Next: add feature extraction receipts and a local STT provider call.
```
