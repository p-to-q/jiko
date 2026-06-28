# Data Handling

This project listens to people. Treat recordings and transcripts as sensitive even during a hackathon.

## Defaults

- Keep audio local by default.
- Do not send audio to paid cloud APIs.
- Do not commit raw recordings.
- Do not commit transcripts from real people unless explicitly approved.
- Keep raw audio retention dev-only by default.
- Store session logs locally during development.
- Prefer short-lived demo data.
- Use `.env` for local service configuration and never commit secrets.

## What A Session May Contain

Dev session logs may include:

- Transcript.
- Audio duration.
- Speech duration.
- Pause and silence features.
- Basic volume and pitch features.
- Reading outputs.
- Local provider names and latency.

Raw audio should be stored only when debugging requires it.

## Provider Boundary

STT/TTS calls should go through backend-owned local adapters or self-hosted local endpoints. The browser UI should not hold provider secrets or depend on paid remote audio APIs.

The backend should log local provider name and latency, but should avoid logging full raw responses when those responses contain user speech unless dev mode explicitly enables it.

## Demo Consent

For rehearsals and judging, keep the prompt simple: the device listens to one spoken intention and processes it locally during the prototype.

If the room is noisy or consent is unclear, use the operator/manual demo path with prepared sample text.

## Local Files

Ignored local paths include:

- `recordings/`
- `captures/`
- `sessions/`
- common audio file extensions such as `.wav`, `.mp3`, `.m4a`, and `.webm`

If a recording becomes a fixture, store only a synthetic or explicitly approved clip and document why it exists.

