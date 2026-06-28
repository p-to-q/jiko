#!/usr/bin/env python3
"""Raspberry Pi side-button adapter for jiko demo events.

This daemon is intentionally thin: it reads one GPIO button and posts session
events to the local server. It does not capture audio or run STT/TTS.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_SERVER_URL = "http://localhost:4317"
DEFAULT_BUTTON_PIN = 17
DEFAULT_BOUNCE_TIME = 0.05
HTTP_TIMEOUT_SECONDS = 5


class AdapterConfigurationError(Exception):
    """Raised when the adapter cannot safely start."""


class AdapterRuntimeError(Exception):
    """Raised when a button event cannot be delivered."""


@dataclass(frozen=True)
class AdapterConfig:
    server_url: str
    fixed_session_id: str | None
    button_pin: int
    bounce_time: float


@dataclass
class ActiveRecording:
    session_id: str
    started_at: float


class JikoClient:
    def __init__(self, server_url: str) -> None:
        self.server_url = server_url.rstrip("/")

    def create_session(self) -> str:
        response = self._post_json("/sessions", {"source": "device"})
        session = response.get("session")
        if not isinstance(session, dict):
            raise AdapterRuntimeError("POST /sessions response did not include a session object")

        session_id = session.get("id")
        if not isinstance(session_id, str) or not session_id:
            raise AdapterRuntimeError("POST /sessions response did not include session.id")

        return session_id

    def post_recording_started(self, session_id: str) -> None:
        self._post_demo_event(session_id, "input.recording.started")

    def post_recording_stopped(self, session_id: str, duration_ms: int) -> None:
        self._post_demo_event(
            session_id,
            "input.recording.stopped",
            {"durationMs": duration_ms},
        )

    def _post_demo_event(
        self,
        session_id: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        event_payload: dict[str, Any] = {"source": "device"}
        if payload:
            event_payload.update(payload)

        return self._post_json(
            f"/sessions/{session_id}/demo-event",
            {
                "type": event_type,
                "payload": event_payload,
            },
        )

    def _post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.server_url}{path}"
        data = json.dumps(body).encode("utf-8")
        request = Request(
            url,
            data=data,
            headers={"content-type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                raw = response.read().decode("utf-8").strip()
        except HTTPError as error:
            error_body = error.read().decode("utf-8", errors="replace").strip()
            detail = f": {error_body}" if error_body else ""
            raise AdapterRuntimeError(f"POST {url} failed with HTTP {error.code}{detail}") from error
        except URLError as error:
            raise AdapterRuntimeError(f"POST {url} failed: {error.reason}") from error
        except TimeoutError as error:
            raise AdapterRuntimeError(f"POST {url} timed out after {HTTP_TIMEOUT_SECONDS}s") from error

        if not raw:
            return {}

        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise AdapterRuntimeError(f"POST {url} returned non-JSON response: {raw[:120]}") from error

        if not isinstance(value, dict):
            raise AdapterRuntimeError(f"POST {url} returned JSON that was not an object")

        return value


class ButtonEventBridge:
    def __init__(self, client: JikoClient, fixed_session_id: str | None) -> None:
        self.client = client
        self.fixed_session_id = fixed_session_id
        self.active_recording: ActiveRecording | None = None

    def handle_pressed(self) -> None:
        if self.active_recording is not None:
            print("Button press ignored: recording is already active", file=sys.stderr)
            return

        started_at = time.monotonic()

        try:
            session_id = self.fixed_session_id or self.client.create_session()
            self.client.post_recording_started(session_id)
        except AdapterRuntimeError as error:
            print(f"Failed to send recording start event: {error}", file=sys.stderr)
            return

        self.active_recording = ActiveRecording(session_id=session_id, started_at=started_at)
        print(f"recording started session={session_id}", flush=True)

    def handle_released(self) -> None:
        active = self.active_recording
        if active is None:
            print("Button release ignored: no active recording", file=sys.stderr)
            return

        duration_ms = max(0, round((time.monotonic() - active.started_at) * 1000))
        sent = False

        try:
            self.client.post_recording_stopped(active.session_id, duration_ms)
            sent = True
        except AdapterRuntimeError as error:
            print(f"Failed to send recording stop event: {error}", file=sys.stderr)
        finally:
            self.active_recording = None

        if sent:
            print(
                f"recording stopped session={active.session_id} durationMs={duration_ms}",
                flush=True,
            )
        else:
            print(
                f"local recording state cleared session={active.session_id} durationMs={duration_ms}",
                file=sys.stderr,
            )


def load_config() -> AdapterConfig:
    server_url = os.environ.get("JIKO_SERVER_URL", DEFAULT_SERVER_URL).strip()
    if not server_url:
        raise AdapterConfigurationError("JIKO_SERVER_URL cannot be empty")

    fixed_session_id = os.environ.get("JIKO_SESSION_ID")
    if fixed_session_id is not None:
        fixed_session_id = fixed_session_id.strip() or None

    return AdapterConfig(
        server_url=server_url,
        fixed_session_id=fixed_session_id,
        button_pin=parse_int_env("GPIO_RECORD_BUTTON_PIN", DEFAULT_BUTTON_PIN),
        bounce_time=parse_float_env("BUTTON_BOUNCE_TIME", DEFAULT_BOUNCE_TIME),
    )


def parse_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default

    try:
        value = int(raw, 10)
    except ValueError as error:
        raise AdapterConfigurationError(f"{name} must be an integer, got {raw!r}") from error

    if value < 0:
        raise AdapterConfigurationError(f"{name} must be non-negative, got {value}")

    return value


def parse_float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default

    try:
        value = float(raw)
    except ValueError as error:
        raise AdapterConfigurationError(f"{name} must be a number of seconds, got {raw!r}") from error

    if value < 0:
        raise AdapterConfigurationError(f"{name} must be non-negative, got {value}")

    return value


def raspberry_pi_model() -> str | None:
    model_path = Path("/proc/device-tree/model")
    try:
        model = model_path.read_text(encoding="utf-8", errors="ignore").strip("\x00 \n")
    except OSError:
        return None

    return model or None


def build_button(pin: int, bounce_time: float) -> Any:
    try:
        from gpiozero import Button
    except ImportError as error:
        raise AdapterConfigurationError(
            "gpiozero is not installed. Install it on Raspberry Pi OS with "
            "`python3 -m pip install gpiozero` or `sudo apt install python3-gpiozero`."
        ) from error

    model = raspberry_pi_model()
    if not model or "Raspberry Pi" not in model:
        raise AdapterConfigurationError(
            "This adapter expects Raspberry Pi hardware. "
            "/proc/device-tree/model did not report a Raspberry Pi."
        )

    try:
        return Button(pin, pull_up=True, bounce_time=bounce_time)
    except Exception as error:
        raise AdapterConfigurationError(
            f"Could not open GPIO{pin} on {model}. Check wiring, permissions, and gpiozero pin factory. "
            f"Original error: {error}"
        ) from error


def main() -> int:
    try:
        config = load_config()
        button = build_button(config.button_pin, config.bounce_time)
    except AdapterConfigurationError as error:
        print(f"Pi button adapter cannot start: {error}", file=sys.stderr)
        return 2

    bridge = ButtonEventBridge(
        client=JikoClient(config.server_url),
        fixed_session_id=config.fixed_session_id,
    )

    button.when_pressed = bridge.handle_pressed
    button.when_released = bridge.handle_released

    session_mode = f"fixed session {config.fixed_session_id}" if config.fixed_session_id else "new session per press"
    print(
        f"Pi button adapter ready: GPIO{config.button_pin}, server={config.server_url}, {session_mode}",
        flush=True,
    )

    try:
        signal.pause()
    except KeyboardInterrupt:
        print("Pi button adapter stopped", flush=True)
    finally:
        button.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
