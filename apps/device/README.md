# Device Adapter

Prototype Raspberry Pi 5 hardware adapters live here. Keep this layer thin:
translate hardware input into the shared jiko event protocol, and leave audio,
STT, TTS, readings, and UI behavior to the existing runtime paths.

## Pi Button Adapter

`pi_button_adapter.py` reads a hold-to-record side button with `gpiozero`.

- Press: create a session with `POST /sessions`, unless `JIKO_SESSION_ID` is set.
- Press: send `input.recording.started` through `POST /sessions/:id/demo-event`.
- Release: send `input.recording.stopped` through the same route with `durationMs`.
- No audio is captured or analyzed in this script.

Default wiring expects a normally-open button between `GPIO17` and ground, using
`gpiozero.Button(..., pull_up=True)`.

```sh
python3 apps/device/pi_button_adapter.py
```

Environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `JIKO_SERVER_URL` | `http://localhost:4317` | Server base URL. |
| `JIKO_SESSION_ID` | unset | Reuse an existing session instead of creating one per press. |
| `GPIO_RECORD_BUTTON_PIN` | `17` | BCM GPIO pin for the record button. |
| `BUTTON_BOUNCE_TIME` | `0.05` | gpiozero debounce time in seconds. |

The script exits with a clear error if `gpiozero` is missing or if it is not
running on Raspberry Pi hardware.
