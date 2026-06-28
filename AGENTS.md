# Agent Instructions

Follow [docs/engineering-discipline.md](docs/engineering-discipline.md).

Important local rules:

- Read the relevant docs before editing.
- Keep one shared core and two runtime shells.
- Keep hardware-specific code at the edge.
- Use local/self-hosted STT and TTS by default.
- Do not route audio through paid cloud APIs unless the team explicitly changes the project policy.
- Route manual demo controls through the same event protocol as real audio.
- Do not commit raw recordings, transcripts from real people, `.env`, or provider keys.
- Keep changes small and state validation honestly.

