# Product Brief

## One-Sentence Definition

A wearable four-window signal instrument that listens to an intention, reads it through content, emotion, and context, then shows whether the self is unanimous or still contains divergence.

## What It Is

It is a small hardware-facing app that behaves like a physical signal object. The form borrows from everyday traffic signals, field instruments, and compact AI hardware, but the interaction should feel quieter and stranger than an assistant.

The product does not optimize the user, coach the user, or tell the user what to do. Its strongest moment is the reveal that multiple readings of the same intention do not fully agree.

## What It Is Not

- Not an AI workflow tool.
- Not a decision recommendation engine.
- Not a therapy chatbot.
- Not a fortune-telling machine.
- Not a traffic light that says stop/go.

## Core Interaction

1. The user holds the side button.
2. The device listens.
3. The user speaks one intention, such as "I am thinking about quitting" or "I may not go tonight."
4. The device releases the recording and analyzes it.
5. Three square windows animate independently.
6. Each window locks into one signal state.
7. The top narrow window shows one final status phrase.
8. The device speaks one short line, then stops.

The silence after speech is part of the product. It gives the decision back to the user.

## Four Windows

Top narrow window:

- Working role: case/status window.
- It does not act as a fourth judge.
- It gives the final status of this reading session.
- It may use character-like or symbol-like animation.

Three square windows:

- Content reading (code: `"text"`): what the user said.
- Emotion reading (code: `"voice"`): how the user sounded.
- Context reading (code: `"timing"`): when the user hesitated, rushed, paused, or stopped.

> **Code mapping note:** In the codebase, `"text"` = content, `"voice"` = emotion, `"context"` = timing. The public-facing terms are content, emotion, and context.

## Physical Direction

The current physical direction is locked in [Form Factor](form-factor.md): a
thick vertical signal object with a top result strip, three stacked signal
windows, and a side thumb control.

The form has two phases. See [Hardware Phases](hardware-phases.md):

- **Jiko Zero** — the hackathon stack uses Raspberry Pi 5 with MPI3508 display
  as a fast, visible prototype shell.
- **Jiko One** — the advanced prototype carries the same object language into a
  custom-chip form factor. The showcase industrial-design model is the starting
  point for this phase.

The product form is independent of any specific compute board. The interaction is
quieter and stranger than an assistant.

## Signal States

Use these internally and in docs:

- Maintain: the reading sees inertia, preservation, or a return to the familiar path.
- Deviate: the reading sees rupture, departure, movement, or a break from pattern.
- Static: the reading cannot form a stable signal.

Avoid these as product language:

- Good / bad.
- Correct / wrong.
- Allowed / forbidden.
- Safe / dangerous.

## UI Mood

The animation can be healing or funny, but it should not become cute companion design. Think blocky, alive, compact, and slightly ceremonial.

Recommended visual language:

- Rounded-square screen windows, not pure traffic-light circles.
- Square-pixel creatures or glyphs built from blocks.
- Color as an overlay state: red for maintain, green for deviate, yellow for static.
- The top window can use sparse text, brackets, rolling symbols, or a short status phrase.

## Voice Mood

The voice should be calm and concise. It should sound like an instrument reporting state, not like a helper giving advice.

Example English:

> Two readings maintain. One reading deviates. A minority remains.

Example Chinese:

> 两项维持。一项偏离。分歧仍在。

For unanimous disagreement with the user's stated plan:

> The system is unanimous. Its authority is revoked.

Chinese:

> 系统一致。因此系统失去解释权。

## Result Copy

The top narrow screen uses short result copy. Its current direction is locked in [Result Copy](result-copy.md).

The copy should usually be two lines: an observation, then an agency turn. It can feel like a page from an answer book, but it must not become fortune-telling or advice.

## Product Principle

The user should never feel that the device has taken agency away. The device can reveal signal, disagreement, or unanimity, but the final interpretive step belongs to the user.
