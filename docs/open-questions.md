# Open Questions

Use this file for unresolved product and engineering choices. Implementation blockers should move into `docs/next-phase-checklist.md`.

## Product

- Final product name is locked as `jiko`; keep open naming questions focused on roles, copy, and demo language.
- Should the top narrow window have a permanent name, or should it remain a role rather than a branded object?
- Should result phrases be mostly Chinese, mostly English, or bilingual?
- How dark should the Minority Report framing be in the demo script?
- How much humor should the block characters have?

## Visual

- Exact software resolution and rotation for MPI3508.
- Whether the top window uses ASCII/characters or only block/symbol animation.
- Whether the three lower windows each have a distinct block character.
- Whether the red/green/yellow overlay is full-screen, ring-only, or background glow.
- How much of the internal Pi/circuitry should be visible through the shell.

## Interaction

- Is hold-to-record the only user-facing interaction?
- Should the side button support cancel/reset gestures?
- Should the device ever ask a follow-up question, or always remain one-shot?
- How long should the final silence last before reset?

## Audio

- What is the acceptable latency from button release to result?
- How noisy is the expected demo environment?
- Do we need Chinese-only, English-only, or mixed-language transcript handling?
- Which local STT path wins the first spike: FunASR, faster-whisper, whisper.cpp, or MLX Whisper?
- Does Piper have an acceptable voice for the demo, or should final lines be pre-generated/recorded locally?

## Reading Logic

- Should voice and timing readings be transparent rule-based systems?
- How should confidence affect display color?
- Should the system ever show `static` for all three readings?
- Should unanimous results produce a different ritual than majority/minority results?

## Hardware

- Screen dimensions and cable direction.
- Whether MPI3508 is using HDMI-only, HDMI plus USB power, or HDMI plus GPIO touch/power.
- Whether the side record button can use GPIO or needs USB/serial input because the display occupies the header.
- Battery or wall-powered demo.
- USB microphone availability.
- Speaker path.
- Final shoulder strap width target.
- 3D printer material and tolerance.

## Demo

- What is the canonical judge prompt?
- Do we rehearse a fixed example such as "I am thinking about quitting"?
- What hidden controls are acceptable for reliability?
- What should happen if the judge says something too long or too vague?
