#!/usr/bin/env python3
"""Raspberry Pi side-button adapter for jiko device events.

GPIO callbacks never wait for the server. They durably append idempotent
session operations to a small SQLite outbox; a background dispatcher delivers
the same canonical input events used by the browser. This adapter still does
not capture audio or run STT/TTS.
"""

from __future__ import annotations

import json
import os
import signal
import sqlite3
import sys
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_SERVER_URL = "http://localhost:4317"
DEFAULT_BUTTON_PIN = 17
DEFAULT_BOUNCE_TIME = 0.05
DEFAULT_OUTBOX_PATH = Path("data/device/button-outbox.sqlite3")
DEFAULT_OUTBOX_MAX_TURNS = 128
DEFAULT_RETRY_BASE_SECONDS = 0.25
DEFAULT_RETRY_MAX_SECONDS = 5.0
HTTP_TIMEOUT_SECONDS = 5
MAX_HTTP_RESPONSE_BYTES = 64 * 1024


class AdapterConfigurationError(Exception):
    """Raised when the adapter cannot safely start."""


class AdapterRuntimeError(Exception):
    """Raised when a button event cannot be delivered."""


class PermanentDeliveryError(AdapterRuntimeError):
    """Raised when replaying the same operation cannot make progress."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


class SessionIdentityRetiredError(PermanentDeliveryError):
    """Raised only for the server's typed retired-identity response."""

    def __init__(self, message: str) -> None:
        super().__init__(message, "session_identity_retired")


class OutboxCapacityError(Exception):
    """Raised when accepting another turn would exceed the durable bound."""


@dataclass(frozen=True)
class AdapterConfig:
    server_url: str
    fixed_session_id: str | None
    button_pin: int
    bounce_time: float
    outbox_path: Path
    outbox_max_turns: int
    retry_base_seconds: float
    retry_max_seconds: float


@dataclass
class ActiveRecording:
    session_id: str
    started_at: float


@dataclass(frozen=True)
class OutboxOperation:
    id: int
    session_id: str
    ordinal: int
    kind: str
    payload: dict[str, Any]
    attempts: int


@dataclass(frozen=True)
class QuarantinedTurn:
    session_id: str
    quarantined_at_ms: int
    failure_code: str
    last_error: str
    rejected_operation_id: int
    rejected_operation_kind: str
    attempts: int
    operation_kinds: tuple[str, ...]


class JikoClient:
    def __init__(self, server_url: str) -> None:
        self.server_url = server_url.rstrip("/")

    def create_session(self, session_id: str) -> None:
        response = self._post_json(
            "/sessions",
            {"sessionId": session_id, "source": "device"},
            expected_session_id=session_id,
        )
        session = response.get("session")
        if not isinstance(session, dict):
            raise AdapterRuntimeError("POST /sessions response did not include a session object")

        returned_session_id = session.get("id")
        if returned_session_id != session_id:
            raise AdapterRuntimeError(
                "POST /sessions returned a different session id: "
                f"expected {session_id!r}, got {returned_session_id!r}"
            )

    def post_input_event(self, session_id: str, payload: dict[str, Any]) -> None:
        response = self._post_json(
            f"/sessions/{session_id}/input-event",
            payload,
            expected_session_id=session_id,
        )
        session = response.get("session")
        event = response.get("event")
        if not isinstance(session, dict) or not isinstance(event, dict):
            raise AdapterRuntimeError(
                "POST input-event response did not include session and event objects"
            )

        attempt_id = session.get("attemptId")
        if (
            session.get("id") != session_id
            or not isinstance(attempt_id, str)
            or not attempt_id
            or event.get("sessionId") != session_id
            or event.get("attemptId") != attempt_id
            or type(event.get("sequence")) is not int
            or event["sequence"] <= 0
        ):
            raise AdapterRuntimeError(
                "POST input-event response identity did not match the requested session"
            )

        for field, expected_type in (
            ("type", str),
            ("source", str),
            ("monotonicMs", int),
            ("durationMs", int),
            ("message", str),
            ("code", str),
            ("recoverable", bool),
        ):
            if field not in payload:
                continue
            submitted_value = payload[field]
            acknowledged_value = event.get(field)
            if (
                type(submitted_value) is not expected_type
                or type(acknowledged_value) is not expected_type
                or acknowledged_value != submitted_value
            ):
                raise AdapterRuntimeError(
                    f"POST input-event response did not acknowledge {field!r} exactly"
                )

    def deliver(self, operation: OutboxOperation) -> None:
        if operation.kind == "create":
            self.create_session(operation.session_id)
            return

        if operation.kind in {"start", "stop", "error"}:
            self.post_input_event(operation.session_id, operation.payload)
            return

        raise AdapterRuntimeError(f"Unsupported outbox operation kind: {operation.kind}")

    def _post_json(
        self,
        path: str,
        body: dict[str, Any],
        *,
        expected_session_id: str,
    ) -> dict[str, Any]:
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
                raw_bytes = _read_bounded_http_body(response, f"POST {url}")
                try:
                    raw = raw_bytes.decode("utf-8").strip()
                except UnicodeDecodeError as error:
                    raise AdapterRuntimeError(
                        f"POST {url} returned invalid UTF-8"
                    ) from error
        except HTTPError as error:
            try:
                error_body = _read_bounded_http_body(
                    error,
                    f"POST {url} HTTP {error.code}",
                ).decode("utf-8", errors="replace").strip()
            finally:
                error.close()
            if error.code == 410:
                try:
                    error_value = json.loads(error_body)
                except json.JSONDecodeError:
                    error_value = None
                if (
                    isinstance(error_value, dict)
                    and error_value.get("code") == "session_identity_retired"
                    and error_value.get("sessionId") == expected_session_id
                ):
                    raise SessionIdentityRetiredError(
                        f"POST {url} permanently rejected the session identity: "
                        f"{error_body[:1000]}"
                    ) from error
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


def _read_bounded_http_body(response: Any, context: str) -> bytes:
    try:
        body = response.read(MAX_HTTP_RESPONSE_BYTES + 1)
    except (OSError, ValueError) as error:
        raise AdapterRuntimeError(f"{context} response read failed: {error}") from error
    if len(body) > MAX_HTTP_RESPONSE_BYTES:
        raise AdapterRuntimeError(
            f"{context} response exceeded {MAX_HTTP_RESPONSE_BYTES} bytes"
        )
    return body


class DurableOutbox:
    """A bounded, crash-recoverable queue for one physical input stream.

    Delivered operations remain until the turn's terminal stop/error operation
    is acknowledged. That lets startup identify a press interrupted before its
    release callback and close it with an explicit error instead of leaving a
    server session stuck in `recording`.
    """

    _terminal_kinds = {"stop", "error"}

    def __init__(self, path: Path, max_pending_turns: int) -> None:
        if max_pending_turns <= 0:
            raise AdapterConfigurationError("JIKO_DEVICE_OUTBOX_MAX_TURNS must be positive")

        self.path = path
        self.max_pending_turns = max_pending_turns
        self._lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.parent.chmod(0o700)
        open_flags = os.O_CREAT | os.O_RDWR
        if hasattr(os, "O_NOFOLLOW"):
            open_flags |= os.O_NOFOLLOW
        database_descriptor = os.open(path, open_flags, 0o600)
        try:
            os.fchmod(database_descriptor, 0o600)
        finally:
            os.close(database_descriptor)
        self._database = sqlite3.connect(
            str(path),
            check_same_thread=False,
            isolation_level=None,
        )
        try:
            self._database.execute("PRAGMA journal_mode=WAL")
            self._database.execute("PRAGMA synchronous=FULL")
            self._database.execute("PRAGMA busy_timeout=5000")
            self._database.execute(
                """
                CREATE TABLE IF NOT EXISTS outbox_operations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    kind TEXT NOT NULL CHECK(kind IN ('create', 'start', 'stop', 'error')),
                    payload_json TEXT NOT NULL,
                    queued_at_ms INTEGER NOT NULL,
                    delivered_at_ms INTEGER,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    UNIQUE(session_id, ordinal)
                )
                """
            )
            self._database.execute(
                """
                CREATE TABLE IF NOT EXISTS outbox_quarantines (
                    session_id TEXT PRIMARY KEY,
                    quarantined_at_ms INTEGER NOT NULL,
                    failure_code TEXT NOT NULL,
                    last_error TEXT NOT NULL,
                    rejected_operation_id INTEGER NOT NULL,
                    rejected_operation_kind TEXT NOT NULL
                )
                """
            )
        except Exception:
            self._database.close()
            raise

    def close(self) -> None:
        with self._lock:
            self._database.close()

    def enqueue_press(self, session_id: str, monotonic_ms: int) -> None:
        create_payload = {"sessionId": session_id, "source": "device"}
        start_payload = {
            "type": "input.recording.started",
            "source": "device",
            "monotonicMs": monotonic_ms,
        }

        with self._lock:
            self._database.execute("BEGIN IMMEDIATE")
            try:
                row = self._database.execute(
                    "SELECT COUNT(DISTINCT session_id) FROM outbox_operations"
                ).fetchone()
                pending_turns = int(row[0]) if row else 0
                if pending_turns >= self.max_pending_turns:
                    raise OutboxCapacityError(
                        f"device outbox already contains {pending_turns} pending turns"
                    )

                queued_at_ms = round(time.time() * 1000)
                self._insert_operation(
                    session_id,
                    0,
                    "create",
                    create_payload,
                    queued_at_ms,
                )
                self._insert_operation(
                    session_id,
                    1,
                    "start",
                    start_payload,
                    queued_at_ms,
                )
                self._database.execute("COMMIT")
            except Exception:
                self._database.execute("ROLLBACK")
                raise

    def enqueue_release(
        self,
        session_id: str,
        duration_ms: int,
        monotonic_ms: int,
    ) -> None:
        payload = {
            "type": "input.recording.stopped",
            "source": "device",
            "durationMs": duration_ms,
            "monotonicMs": monotonic_ms,
        }

        with self._lock:
            self._database.execute("BEGIN IMMEDIATE")
            try:
                if not self._session_has_kind(session_id, "start"):
                    raise AdapterRuntimeError(
                        f"cannot queue release for unknown session {session_id}"
                    )
                if self._session_has_terminal(session_id):
                    raise AdapterRuntimeError(
                        f"session {session_id} already has a terminal outbox operation"
                    )
                self._insert_operation(
                    session_id,
                    2,
                    "stop",
                    payload,
                    round(time.time() * 1000),
                )
                self._database.execute("COMMIT")
            except Exception:
                self._database.execute("ROLLBACK")
                raise

    def seal_interrupted_turns(self) -> list[str]:
        """Append one replay-safe error for presses left open by a prior run."""

        sealed: list[str] = []
        with self._lock:
            self._database.execute("BEGIN IMMEDIATE")
            try:
                rows = self._database.execute(
                    """
                    SELECT session_id
                    FROM outbox_operations AS started
                    WHERE kind = 'start'
                      AND NOT EXISTS (
                        SELECT 1 FROM outbox_quarantines AS quarantine
                        WHERE quarantine.session_id = started.session_id
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM outbox_operations AS terminal
                        WHERE terminal.session_id = started.session_id
                          AND terminal.kind IN ('stop', 'error')
                      )
                    ORDER BY id
                    """
                ).fetchall()
                for (session_id,) in rows:
                    payload = {
                        "type": "session.error",
                        "source": "device",
                        "monotonicMs": round(time.monotonic() * 1000),
                        "message": "Device adapter restarted before button release",
                        "code": "device_input_interrupted",
                        "recoverable": True,
                    }
                    self._insert_operation(
                        str(session_id),
                        2,
                        "error",
                        payload,
                        round(time.time() * 1000),
                    )
                    sealed.append(str(session_id))
                self._database.execute("COMMIT")
            except Exception:
                self._database.execute("ROLLBACK")
                raise
        return sealed

    def next_ready_operation(self) -> OutboxOperation | None:
        with self._lock:
            row = self._database.execute(
                """
                SELECT current.id, current.session_id, current.ordinal,
                       current.kind, current.payload_json, current.attempts
                FROM outbox_operations AS current
                WHERE current.delivered_at_ms IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM outbox_quarantines AS quarantine
                    WHERE quarantine.session_id = current.session_id
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM outbox_operations AS earlier
                    WHERE earlier.session_id = current.session_id
                      AND earlier.ordinal < current.ordinal
                      AND earlier.delivered_at_ms IS NULL
                  )
                ORDER BY current.attempts ASC, current.id ASC
                LIMIT 1
                """
            ).fetchone()

        if row is None:
            return None

        payload = json.loads(row[4])
        if not isinstance(payload, dict):
            raise AdapterRuntimeError(f"outbox operation {row[0]} payload is not an object")
        return OutboxOperation(
            id=int(row[0]),
            session_id=str(row[1]),
            ordinal=int(row[2]),
            kind=str(row[3]),
            payload=payload,
            attempts=int(row[5]),
        )

    def mark_delivered(self, operation: OutboxOperation) -> None:
        with self._lock:
            self._database.execute("BEGIN IMMEDIATE")
            try:
                cursor = self._database.execute(
                    """
                    UPDATE outbox_operations
                    SET delivered_at_ms = ?, last_error = NULL
                    WHERE id = ?
                      AND delivered_at_ms IS NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM outbox_quarantines AS quarantine
                        WHERE quarantine.session_id = outbox_operations.session_id
                      )
                    """,
                    (round(time.time() * 1000), operation.id),
                )
                if cursor.rowcount != 1:
                    raise AdapterRuntimeError(
                        f"outbox operation {operation.id} was not pending"
                    )
                if operation.kind in self._terminal_kinds:
                    self._database.execute(
                        "DELETE FROM outbox_operations WHERE session_id = ?",
                        (operation.session_id,),
                    )
                self._database.execute("COMMIT")
            except Exception:
                self._database.execute("ROLLBACK")
                raise

    def mark_failed(self, operation: OutboxOperation, error: Exception) -> None:
        with self._lock:
            self._database.execute(
                """
                UPDATE outbox_operations
                SET attempts = attempts + 1, last_error = ?
                WHERE id = ? AND delivered_at_ms IS NULL
                """,
                (str(error)[:1000], operation.id),
            )

    def quarantine_session(
        self,
        operation: OutboxOperation,
        error: PermanentDeliveryError,
    ) -> None:
        """Permanently stop delivery for one client-generated session id.

        The quarantine row and rejected-attempt receipt commit together. All
        operations remain in SQLite for bounded operator inspection, but none
        from this session can become ready again.
        """

        quarantined_at_ms = round(time.time() * 1000)
        error_message = str(error)[:1000]
        with self._lock:
            self._database.execute("BEGIN IMMEDIATE")
            try:
                row = self._database.execute(
                    """
                    SELECT session_id, kind
                    FROM outbox_operations
                    WHERE id = ? AND delivered_at_ms IS NULL
                    """,
                    (operation.id,),
                ).fetchone()
                if row != (operation.session_id, operation.kind):
                    raise AdapterRuntimeError(
                        f"outbox operation {operation.id} was not pending"
                    )

                self._database.execute(
                    """
                    INSERT INTO outbox_quarantines (
                        session_id, quarantined_at_ms, failure_code, last_error,
                        rejected_operation_id, rejected_operation_kind
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        operation.session_id,
                        quarantined_at_ms,
                        error.code,
                        error_message,
                        operation.id,
                        operation.kind,
                    ),
                )
                self._database.execute(
                    """
                    UPDATE outbox_operations
                    SET attempts = attempts + 1, last_error = ?
                    WHERE id = ? AND delivered_at_ms IS NULL
                    """,
                    (error_message, operation.id),
                )
                self._database.execute("COMMIT")
            except Exception:
                self._database.execute("ROLLBACK")
                raise

    def pending_operations(self) -> list[OutboxOperation]:
        """Return pending operations for diagnostics and deterministic tests."""

        with self._lock:
            rows = self._database.execute(
                """
                SELECT id, session_id, ordinal, kind, payload_json, attempts
                FROM outbox_operations AS operation
                WHERE delivered_at_ms IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM outbox_quarantines AS quarantine
                    WHERE quarantine.session_id = operation.session_id
                  )
                ORDER BY id
                """
            ).fetchall()
        return [
            OutboxOperation(
                id=int(row[0]),
                session_id=str(row[1]),
                ordinal=int(row[2]),
                kind=str(row[3]),
                payload=json.loads(row[4]),
                attempts=int(row[5]),
            )
            for row in rows
        ]

    def quarantined_turns(self) -> list[QuarantinedTurn]:
        """Return durable permanent-failure receipts for operator inspection."""

        with self._lock:
            rows = self._database.execute(
                """
                SELECT quarantine.session_id, quarantine.quarantined_at_ms,
                       quarantine.failure_code, quarantine.last_error,
                       quarantine.rejected_operation_id,
                       quarantine.rejected_operation_kind,
                       rejected.attempts, operation.kind
                FROM outbox_quarantines AS quarantine
                JOIN outbox_operations AS rejected
                  ON rejected.id = quarantine.rejected_operation_id
                JOIN outbox_operations AS operation
                  ON operation.session_id = quarantine.session_id
                ORDER BY quarantine.quarantined_at_ms, quarantine.session_id,
                         operation.ordinal
                """
            ).fetchall()

        turns: list[QuarantinedTurn] = []
        for row in rows:
            session_id = str(row[0])
            if turns and turns[-1].session_id == session_id:
                previous = turns[-1]
                turns[-1] = QuarantinedTurn(
                    session_id=previous.session_id,
                    quarantined_at_ms=previous.quarantined_at_ms,
                    failure_code=previous.failure_code,
                    last_error=previous.last_error,
                    rejected_operation_id=previous.rejected_operation_id,
                    rejected_operation_kind=previous.rejected_operation_kind,
                    attempts=previous.attempts,
                    operation_kinds=previous.operation_kinds + (str(row[7]),),
                )
                continue
            turns.append(
                QuarantinedTurn(
                    session_id=session_id,
                    quarantined_at_ms=int(row[1]),
                    failure_code=str(row[2]),
                    last_error=str(row[3]),
                    rejected_operation_id=int(row[4]),
                    rejected_operation_kind=str(row[5]),
                    attempts=int(row[6]),
                    operation_kinds=(str(row[7]),),
                )
            )
        return turns

    def _insert_operation(
        self,
        session_id: str,
        ordinal: int,
        kind: str,
        payload: dict[str, Any],
        queued_at_ms: int,
    ) -> None:
        self._database.execute(
            """
            INSERT INTO outbox_operations (
                session_id, ordinal, kind, payload_json, queued_at_ms
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                session_id,
                ordinal,
                kind,
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                queued_at_ms,
            ),
        )

    def _session_has_kind(self, session_id: str, kind: str) -> bool:
        return self._database.execute(
            "SELECT 1 FROM outbox_operations WHERE session_id = ? AND kind = ?",
            (session_id, kind),
        ).fetchone() is not None

    def _session_has_terminal(self, session_id: str) -> bool:
        return self._database.execute(
            """
            SELECT 1 FROM outbox_operations
            WHERE session_id = ? AND kind IN ('stop', 'error')
            """,
            (session_id,),
        ).fetchone() is not None


class OutboxDispatcher:
    def __init__(
        self,
        outbox: DurableOutbox,
        client: JikoClient,
        retry_base_seconds: float,
        retry_max_seconds: float,
    ) -> None:
        self.outbox = outbox
        self.client = client
        self.retry_base_seconds = retry_base_seconds
        self.retry_max_seconds = retry_max_seconds
        self._wake = threading.Event()
        self._stop = threading.Event()

    def notify(self) -> None:
        self._wake.set()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def deliver_next(self) -> bool | None:
        operation = self.outbox.next_ready_operation()
        if operation is None:
            return None

        try:
            self.client.deliver(operation)
        except PermanentDeliveryError as error:
            self.outbox.quarantine_session(operation, error)
            print(
                f"Outbox quarantined session={operation.session_id} "
                f"kind={operation.kind} code={error.code}: {error}",
                file=sys.stderr,
            )
            return False
        except AdapterRuntimeError as error:
            self.outbox.mark_failed(operation, error)
            print(
                f"Outbox delivery failed session={operation.session_id} "
                f"kind={operation.kind} attempt={operation.attempts + 1}: {error}",
                file=sys.stderr,
            )
            return False

        self.outbox.mark_delivered(operation)
        print(
            f"outbox delivered session={operation.session_id} kind={operation.kind}",
            flush=True,
        )
        return True

    def run(self) -> None:
        while not self._stop.is_set():
            result = self.deliver_next()
            if result is True:
                continue

            operation = self.outbox.next_ready_operation()
            if result is False and operation is not None:
                delay = min(
                    self.retry_max_seconds,
                    self.retry_base_seconds * (2 ** min(operation.attempts, 6)),
                )
            else:
                delay = self.retry_max_seconds

            self._wake.wait(delay)
            self._wake.clear()


class ButtonEventBridge:
    def __init__(
        self,
        outbox: DurableOutbox,
        notify_dispatcher: Callable[[], None],
        fixed_session_id: str | None,
    ) -> None:
        self.outbox = outbox
        self.notify_dispatcher = notify_dispatcher
        self.fixed_session_id = fixed_session_id
        self.active_recording: ActiveRecording | None = None
        self._lock = threading.Lock()
        self._fixed_session_used = False

    def handle_pressed(self) -> None:
        with self._lock:
            if self.active_recording is not None:
                print("Button press ignored: recording is already active", file=sys.stderr)
                return
            if self.fixed_session_id and self._fixed_session_used:
                print(
                    "Button press ignored: fixed sessions support one turn only",
                    file=sys.stderr,
                )
                return

            started_at = time.monotonic()
            session_id = self.fixed_session_id or f"device-{uuid.uuid4()}"
            try:
                self.outbox.enqueue_press(session_id, round(started_at * 1000))
            except (AdapterRuntimeError, OutboxCapacityError, OSError, sqlite3.Error) as error:
                print(f"Failed to durably queue recording start: {error}", file=sys.stderr)
                return

            self.active_recording = ActiveRecording(
                session_id=session_id,
                started_at=started_at,
            )
            if self.fixed_session_id:
                self._fixed_session_used = True

        self.notify_dispatcher()
        print(f"recording started locally session={session_id}", flush=True)

    def handle_released(self) -> None:
        with self._lock:
            active = self.active_recording
            if active is None:
                print("Button release ignored: no active recording", file=sys.stderr)
                return

            stopped_at = time.monotonic()
            duration_ms = max(0, round((stopped_at - active.started_at) * 1000))
            try:
                self.outbox.enqueue_release(
                    active.session_id,
                    duration_ms,
                    round(stopped_at * 1000),
                )
            except (AdapterRuntimeError, OSError, sqlite3.Error) as error:
                print(f"Failed to durably queue recording stop: {error}", file=sys.stderr)
                # Keep the turn active so a later release can retry the exact
                # stop. Clearing it here would manufacture a local "stopped"
                # state even though the durable outbox still contains only an
                # open press (for example after ENOSPC or a read-only remount).
                return

            self.active_recording = None

        self.notify_dispatcher()
        print(
            f"recording stopped locally session={active.session_id} durationMs={duration_ms}",
            flush=True,
        )


def load_config() -> AdapterConfig:
    server_url = os.environ.get("JIKO_SERVER_URL", DEFAULT_SERVER_URL).strip()
    if not server_url:
        raise AdapterConfigurationError("JIKO_SERVER_URL cannot be empty")

    fixed_session_id = os.environ.get("JIKO_SESSION_ID")
    if fixed_session_id is not None:
        fixed_session_id = fixed_session_id.strip() or None

    outbox_path_raw = os.environ.get(
        "JIKO_DEVICE_OUTBOX_PATH",
        str(DEFAULT_OUTBOX_PATH),
    ).strip()
    if not outbox_path_raw:
        raise AdapterConfigurationError("JIKO_DEVICE_OUTBOX_PATH cannot be empty")

    outbox_max_turns = parse_int_env(
        "JIKO_DEVICE_OUTBOX_MAX_TURNS",
        DEFAULT_OUTBOX_MAX_TURNS,
    )
    if outbox_max_turns <= 0:
        raise AdapterConfigurationError("JIKO_DEVICE_OUTBOX_MAX_TURNS must be positive")

    retry_base_seconds = parse_float_env(
        "JIKO_DEVICE_RETRY_BASE_SECONDS",
        DEFAULT_RETRY_BASE_SECONDS,
    )
    retry_max_seconds = parse_float_env(
        "JIKO_DEVICE_RETRY_MAX_SECONDS",
        DEFAULT_RETRY_MAX_SECONDS,
    )
    if retry_base_seconds <= 0 or retry_max_seconds <= 0:
        raise AdapterConfigurationError("device retry intervals must be positive")
    if retry_max_seconds < retry_base_seconds:
        raise AdapterConfigurationError(
            "JIKO_DEVICE_RETRY_MAX_SECONDS must be at least JIKO_DEVICE_RETRY_BASE_SECONDS"
        )

    return AdapterConfig(
        server_url=server_url,
        fixed_session_id=fixed_session_id,
        button_pin=parse_int_env("GPIO_RECORD_BUTTON_PIN", DEFAULT_BUTTON_PIN),
        bounce_time=parse_float_env("BUTTON_BOUNCE_TIME", DEFAULT_BOUNCE_TIME),
        outbox_path=Path(outbox_path_raw).expanduser(),
        outbox_max_turns=outbox_max_turns,
        retry_base_seconds=retry_base_seconds,
        retry_max_seconds=retry_max_seconds,
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
    outbox: DurableOutbox | None = None
    try:
        config = load_config()
        outbox = DurableOutbox(config.outbox_path, config.outbox_max_turns)
        interrupted_sessions = outbox.seal_interrupted_turns()
        quarantined_turns = outbox.quarantined_turns()
        button = build_button(config.button_pin, config.bounce_time)
    except (AdapterConfigurationError, OSError, sqlite3.Error) as error:
        if outbox is not None:
            outbox.close()
        print(f"Pi button adapter cannot start: {error}", file=sys.stderr)
        return 2

    dispatcher = OutboxDispatcher(
        outbox=outbox,
        client=JikoClient(config.server_url),
        retry_base_seconds=config.retry_base_seconds,
        retry_max_seconds=config.retry_max_seconds,
    )
    dispatcher_thread = threading.Thread(
        target=dispatcher.run,
        name="jiko-device-outbox",
        daemon=True,
    )
    dispatcher_thread.start()

    bridge = ButtonEventBridge(
        outbox=outbox,
        notify_dispatcher=dispatcher.notify,
        fixed_session_id=config.fixed_session_id,
    )

    button.when_pressed = bridge.handle_pressed
    button.when_released = bridge.handle_released

    session_mode = f"fixed session {config.fixed_session_id}" if config.fixed_session_id else "new session per press"
    print(
        f"Pi button adapter ready: GPIO{config.button_pin}, server={config.server_url}, "
        f"{session_mode}, outbox={config.outbox_path}",
        flush=True,
    )
    for session_id in interrupted_sessions:
        print(
            f"queued interrupted-turn recovery session={session_id}",
            file=sys.stderr,
        )
    for turn in quarantined_turns:
        print(
            f"retained outbox quarantine session={turn.session_id} "
            f"code={turn.failure_code} rejectedKind={turn.rejected_operation_kind} "
            f"attempts={turn.attempts}",
            file=sys.stderr,
        )
    dispatcher.notify()

    try:
        signal.pause()
    except KeyboardInterrupt:
        print("Pi button adapter stopped", flush=True)
    finally:
        button.close()
        dispatcher.stop()
        dispatcher_thread.join(timeout=HTTP_TIMEOUT_SECONDS + 1)
        if dispatcher_thread.is_alive():
            print("Outbox dispatcher did not stop before shutdown timeout", file=sys.stderr)
        outbox.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
