# Remote Audio Policy

Status: release policy, 2026-09-18

## Current Decision

Jiko's product, demo, and release profiles use local or operator-controlled
self-hosted STT/TTS. Sending audio to a paid third-party API is **not currently
approved**.

The repository retains a disabled Deepgram batch adapter as a strict
trust-boundary reference and future benchmark lever. Its three technical gates
(`STT_PROVIDER=deepgram`, `JIKO_ALLOW_REMOTE_AUDIO=1`, and named consent on the
individual upload) are necessary controls, but they are not themselves policy
authorization. The checked-in browser supplies no remote-audio consent and
there is no local-to-remote fallback.

## Approval Gate

A live paid-provider experiment requires a written team decision before any
audio is sent. That decision must name:

- provider, endpoint region, model and pinned version;
- synthetic or explicitly consented corpus and the person responsible for it;
- retention/training opt-out and deletion expectations;
- cost ceiling, time window and operator;
- latency/accuracy acceptance criteria and incident stop condition.

Approval is provider- and experiment-specific. Approving one Deepgram batch
run would not approve streaming, production use, Doubao/Volcengine, another
dataset, or automatic fallback. Real-person recordings and transcripts remain
outside the repository.

Until such a decision exists, remote-provider tests must use mocks and the
release must succeed with WAN access blocked. This policy is the canonical
decision; research notes describe candidates, not authorization.
