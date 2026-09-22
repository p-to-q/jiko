# Data Handling

This project listens to people. Treat recordings and transcripts as sensitive even during a hackathon.

## Defaults

- Keep audio local by default.
- Do not send audio to a paid cloud API under the current release policy. The
  disabled Deepgram challenger below preserves an implementation option, but
  its technical gates do not authorize a live call. See
  [Remote Audio Policy](remote-audio-policy.md).
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

STT/TTS calls go through backend-owned adapters and default to local or
self-hosted endpoints. The browser UI should not hold provider secrets or
depend on paid remote audio APIs.

The backend should log the selected provider name and latency, but should avoid
logging full raw responses when those responses contain user speech unless dev
mode explicitly enables it.

FunASR remains an operator-managed self-hosted adapter. It accepts loopback or
literal private-IP LAN endpoints only; public and DNS-named network endpoints
are blocked before audio is read, and HTTP redirects are refused. Its diagnostic
and receipt provider id records `loopback` or `lan`. It is not labeled as a paid
cloud provider; `remote: false` means the third-party cloud boundary was not
crossed, not that every self-hosted request stayed in one process.

## Optional Deepgram Batch Challenger

Deepgram is an experimental pre-recorded/batch comparison path, not the product
default, a streaming implementation, or an automatic fallback. It is retained
for mock verification and a future separately approved experiment. After that
written approval, a normalized WAV may leave the host only when all of these
are true for the same request:

1. `STT_PROVIDER=deepgram` selects the adapter.
2. `JIKO_ALLOW_REMOTE_AUDIO=1` enables the deployment-wide policy.
3. The individual audio upload explicitly supplies either
   `x-jiko-remote-audio-consent: deepgram` or
   `?remoteAudioConsent=deepgram`.

The checked-in browser client supplies neither consent form. A controlled
operator/client may add one only after the policy approval and consent for that
upload. The flag is an enforcement input, not authorization or a complete
human consent experience.

The adapter accepts HTTPS endpoints only, refuses redirects, requires an
explicit pinned `DEEPGRAM_VERSION` (`latest` is rejected), forces
`mip_opt_out=true`, and never falls back from a failed Deepgram call to a local
provider. The strict STT receipt records the provider, requested and resolved
model/version, endpoint region and origin, batch mode, Deepgram trust boundary,
MIP opt-out state, and
the provider request id. It never records `DEEPGRAM_API_KEY` or the full remote
response.

Deepgram documents `POST /v1/listen` as its pre-recorded transcription endpoint
and documents `mip_opt_out=true` as opting that request out of its Model
Improvement Program. Its data guide says opted-out audio and transcripts are
not retained after the response, while request metadata and usage logs remain.
Those are provider policy claims, not properties verified by this repository;
deployment still needs privacy, legal, region, and incident-response review.
See [pre-recorded STT](https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded)
and [Deepgram data handling](https://developers.deepgram.com/trust-security/your-data).

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
