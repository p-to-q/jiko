from __future__ import annotations

import io
import json
import os
import sqlite3
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from pi_button_adapter import (
    AdapterRuntimeError,
    ButtonEventBridge,
    DurableOutbox,
    JikoClient,
    MAX_HTTP_RESPONSE_BYTES,
    OutboxCapacityError,
    OutboxDispatcher,
    PermanentDeliveryError,
    SessionIdentityRetiredError,
)


class RecordingClient:
    def __init__(self, fail_kind_once: str | None = None) -> None:
        self.calls: list[tuple[str, str, dict[str, object]]] = []
        self.fail_kind_once = fail_kind_once
        self.failed = False

    def deliver(self, operation) -> None:
        self.calls.append(
            (operation.kind, operation.session_id, operation.payload.copy())
        )
        if operation.kind == self.fail_kind_once and not self.failed:
            self.failed = True
            raise AdapterRuntimeError("simulated response loss")


class RetiredIdentityClient(RecordingClient):
    def __init__(self, retired_session_id: str) -> None:
        super().__init__()
        self.retired_session_id = retired_session_id

    def deliver(self, operation) -> None:
        self.calls.append(
            (operation.kind, operation.session_id, operation.payload.copy())
        )
        if operation.session_id == self.retired_session_id:
            raise SessionIdentityRetiredError("typed retired identity")


class JikoClientTest(unittest.TestCase):
    def test_only_typed_410_is_classified_as_permanent(self) -> None:
        body = json.dumps(
            {
                "error": "Session identity is still retired",
                "code": "session_identity_retired",
                "sessionId": "retired-id",
                "retryAfterMs": 1_000,
            }
        ).encode("utf-8")
        error = HTTPError(
            "http://localhost:4317/sessions",
            410,
            "Gone",
            None,
            io.BytesIO(body),
        )

        with patch("pi_button_adapter.urlopen", side_effect=error):
            with self.assertRaises(SessionIdentityRetiredError) as caught:
                JikoClient("http://localhost:4317").create_session("retired-id")

        self.assertEqual(caught.exception.code, "session_identity_retired")

    def test_untyped_410_remains_retryable(self) -> None:
        error = HTTPError(
            "http://localhost:4317/sessions",
            410,
            "Gone",
            None,
            io.BytesIO(b'{"code":"some_other_error"}'),
        )

        with patch("pi_button_adapter.urlopen", side_effect=error):
            with self.assertRaises(AdapterRuntimeError) as caught:
                JikoClient("http://localhost:4317").create_session("retry-id")

        self.assertNotIsInstance(caught.exception, PermanentDeliveryError)

    def test_retired_410_requires_the_exact_requested_session_identity(self) -> None:
        for response_session_id in (None, "different-id"):
            body = {
                "error": "Session identity is still retired",
                "code": "session_identity_retired",
            }
            if response_session_id is not None:
                body["sessionId"] = response_session_id
            error = HTTPError(
                "http://localhost:4317/sessions",
                410,
                "Gone",
                None,
                io.BytesIO(json.dumps(body).encode("utf-8")),
            )

            with self.subTest(response_session_id=response_session_id):
                with patch("pi_button_adapter.urlopen", side_effect=error):
                    with self.assertRaises(AdapterRuntimeError) as caught:
                        JikoClient("http://localhost:4317").create_session("retired-id")
                self.assertNotIsInstance(caught.exception, PermanentDeliveryError)

    def test_oversized_success_response_is_bounded(self) -> None:
        response = FakeHttpResponse(b"x" * (MAX_HTTP_RESPONSE_BYTES + 1))
        with patch("pi_button_adapter.urlopen", return_value=response):
            with self.assertRaisesRegex(AdapterRuntimeError, "response exceeded"):
                JikoClient("http://localhost:4317").create_session("bounded-id")

        self.assertEqual(response.requested_bytes, MAX_HTTP_RESPONSE_BYTES + 1)

    def test_oversized_410_cannot_permanently_retire_a_session(self) -> None:
        body = json.dumps(
            {
                "code": "session_identity_retired",
                "sessionId": "retired-id",
                "padding": "x" * MAX_HTTP_RESPONSE_BYTES,
            }
        ).encode("utf-8")
        error = HTTPError(
            "http://localhost:4317/sessions",
            410,
            "Gone",
            None,
            io.BytesIO(body),
        )

        with patch("pi_button_adapter.urlopen", side_effect=error):
            with self.assertRaises(AdapterRuntimeError) as caught:
                JikoClient("http://localhost:4317").create_session("retired-id")

        self.assertNotIsInstance(caught.exception, PermanentDeliveryError)

    def test_invalid_utf8_success_remains_a_retryable_outbox_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            outbox = DurableOutbox(
                Path(directory) / "button.sqlite3",
                max_pending_turns=1,
            )
            try:
                outbox.enqueue_press("invalid-utf8", 1_000)
                dispatcher = OutboxDispatcher(
                    outbox=outbox,
                    client=JikoClient("http://localhost:4317"),
                    retry_base_seconds=0.001,
                    retry_max_seconds=0.01,
                )
                with patch(
                    "pi_button_adapter.urlopen",
                    return_value=FakeHttpResponse(b"\xff"),
                ):
                    self.assertFalse(dispatcher.deliver_next())

                pending = outbox.next_ready_operation()
                self.assertIsNotNone(pending)
                self.assertEqual(pending.kind, "create")
                self.assertEqual(pending.attempts, 1)
            finally:
                outbox.close()

    def test_input_event_requires_an_exact_typed_acknowledgement(self) -> None:
        payload = {
            "type": "input.recording.stopped",
            "source": "device",
            "monotonicMs": 1_400,
            "durationMs": 400,
        }
        valid = {
            "session": {"id": "typed-ack", "attemptId": "attempt-1"},
            "event": {
                "sessionId": "typed-ack",
                "attemptId": "attempt-1",
                "sequence": 3,
                **payload,
            },
        }
        client = JikoClient("http://localhost:4317")

        with patch(
            "pi_button_adapter.urlopen",
            return_value=FakeHttpResponse(json.dumps(valid).encode("utf-8")),
        ):
            client.post_input_event("typed-ack", payload)

        invalid_acknowledgements = [
            {},
            {**valid, "session": {"id": "wrong", "attemptId": "attempt-1"}},
            {
                **valid,
                "event": {**valid["event"], "sessionId": "wrong"},
            },
            {
                **valid,
                "event": {**valid["event"], "durationMs": 399},
            },
            {
                **valid,
                "session": {"id": "typed-ack", "attemptId": ""},
                "event": {**valid["event"], "attemptId": ""},
            },
            {
                **valid,
                "event": {**valid["event"], "monotonicMs": 1_400.0},
            },
        ]
        for acknowledgement in invalid_acknowledgements:
            with self.subTest(acknowledgement=acknowledgement):
                with patch(
                    "pi_button_adapter.urlopen",
                    return_value=FakeHttpResponse(
                        json.dumps(acknowledgement).encode("utf-8")
                    ),
                ):
                    with self.assertRaises(AdapterRuntimeError):
                        client.post_input_event("typed-ack", payload)

        zero_duration_payload = {**payload, "durationMs": 0}
        false_duration_acknowledgement = {
            **valid,
            "event": {
                **valid["event"],
                **zero_duration_payload,
                "durationMs": False,
            },
        }
        with patch(
            "pi_button_adapter.urlopen",
            return_value=FakeHttpResponse(
                json.dumps(false_duration_acknowledgement).encode("utf-8")
            ),
        ):
            with self.assertRaises(AdapterRuntimeError):
                client.post_input_event("typed-ack", zero_duration_payload)

        error_payload = {
            "type": "session.error",
            "source": "device",
            "monotonicMs": 1_400,
            "message": "Device adapter restarted before button release",
            "code": "device_input_interrupted",
            "recoverable": True,
        }
        integer_boolean_acknowledgement = {
            "session": {"id": "typed-ack", "attemptId": "attempt-1"},
            "event": {
                "sessionId": "typed-ack",
                "attemptId": "attempt-1",
                "sequence": 3,
                **error_payload,
                "recoverable": 1,
            },
        }
        with patch(
            "pi_button_adapter.urlopen",
            return_value=FakeHttpResponse(
                json.dumps(integer_boolean_acknowledgement).encode("utf-8")
            ),
        ):
            with self.assertRaises(AdapterRuntimeError):
                client.post_input_event("typed-ack", error_payload)


class FakeHttpResponse:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.requested_bytes: int | None = None

    def __enter__(self):
        return self

    def __exit__(self, _exception_type, _exception, _traceback) -> None:
        return None

    def read(self, requested_bytes: int) -> bytes:
        self.requested_bytes = requested_bytes
        return self.body[:requested_bytes]


class DurableOutboxTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "button.sqlite3"
        self.outbox = DurableOutbox(self.path, max_pending_turns=4)

    def tearDown(self) -> None:
        self.outbox.close()
        self.temporary_directory.cleanup()

    def dispatcher(self, client: RecordingClient) -> OutboxDispatcher:
        return OutboxDispatcher(
            outbox=self.outbox,
            client=client,
            retry_base_seconds=0.001,
            retry_max_seconds=0.01,
        )

    def test_outbox_database_and_wal_files_remain_private_under_open_umask(self) -> None:
        self.outbox.close()
        private_path = Path(self.temporary_directory.name) / "private" / "button.sqlite3"
        previous_umask = os.umask(0o000)
        try:
            self.outbox = DurableOutbox(private_path, max_pending_turns=4)
            self.outbox.enqueue_press("private-turn", 1_000)
        finally:
            os.umask(previous_umask)

        self.assertEqual(stat.S_IMODE(private_path.parent.stat().st_mode), 0o700)
        for database_path in (
            private_path,
            Path(f"{private_path}-wal"),
            Path(f"{private_path}-shm"),
        ):
            self.assertTrue(database_path.exists(), database_path)
            self.assertEqual(stat.S_IMODE(database_path.stat().st_mode), 0o600)

    def test_delivers_create_start_stop_in_order_and_clears_completed_turn(self) -> None:
        self.outbox.enqueue_press("device-turn-1", 1_000)
        self.outbox.enqueue_release("device-turn-1", 725, 1_725)
        client = RecordingClient()
        dispatcher = self.dispatcher(client)

        self.assertTrue(dispatcher.deliver_next())
        self.assertTrue(dispatcher.deliver_next())
        self.assertTrue(dispatcher.deliver_next())
        self.assertIsNone(dispatcher.deliver_next())

        self.assertEqual(
            [kind for kind, _, _ in client.calls],
            ["create", "start", "stop"],
        )
        self.assertEqual(client.calls[0][2]["sessionId"], "device-turn-1")
        self.assertEqual(client.calls[1][2]["monotonicMs"], 1_000)
        self.assertEqual(client.calls[2][2]["durationMs"], 725)
        self.assertEqual(self.outbox.pending_operations(), [])

    def test_lost_response_retries_the_exact_operation_before_stop(self) -> None:
        self.outbox.enqueue_press("device-turn-2", 5_000)
        self.outbox.enqueue_release("device-turn-2", 500, 5_500)
        client = RecordingClient(fail_kind_once="start")
        dispatcher = self.dispatcher(client)

        self.assertTrue(dispatcher.deliver_next())
        self.assertFalse(dispatcher.deliver_next())
        pending = self.outbox.next_ready_operation()
        self.assertIsNotNone(pending)
        self.assertEqual(pending.kind, "start")
        self.assertEqual(pending.attempts, 1)
        self.assertTrue(dispatcher.deliver_next())
        self.assertTrue(dispatcher.deliver_next())

        self.assertEqual(
            [kind for kind, _, _ in client.calls],
            ["create", "start", "start", "stop"],
        )
        self.assertEqual(client.calls[1][2], client.calls[2][2])

    def test_retired_identity_quarantines_the_turn_without_blocking_new_ids(self) -> None:
        self.outbox.enqueue_press("retired-turn", 6_000)
        client = RetiredIdentityClient("retired-turn")
        dispatcher = self.dispatcher(client)

        self.assertFalse(dispatcher.deliver_next())
        self.assertEqual(self.outbox.pending_operations(), [])
        self.assertIsNone(dispatcher.deliver_next())
        self.assertEqual(
            [(kind, session_id) for kind, session_id, _ in client.calls],
            [("create", "retired-turn")],
        )

        # A physical release can race the HTTP rejection. It remains part of
        # the quarantined audit trail and must never become independently ready.
        self.outbox.enqueue_release("retired-turn", 400, 6_400)
        quarantine = self.outbox.quarantined_turns()
        self.assertEqual(len(quarantine), 1)
        self.assertEqual(quarantine[0].session_id, "retired-turn")
        self.assertEqual(quarantine[0].failure_code, "session_identity_retired")
        self.assertEqual(quarantine[0].rejected_operation_kind, "create")
        self.assertEqual(quarantine[0].attempts, 1)
        self.assertEqual(quarantine[0].operation_kinds, ("create", "start", "stop"))
        self.assertIsNone(dispatcher.deliver_next())

        self.outbox.close()
        self.outbox = DurableOutbox(self.path, max_pending_turns=4)
        self.assertEqual(
            self.outbox.quarantined_turns()[0].failure_code,
            "session_identity_retired",
        )

        self.outbox.enqueue_press("fresh-turn", 7_000)
        self.assertTrue(self.dispatcher(client).deliver_next())
        self.assertEqual(client.calls[-1][1], "fresh-turn")

    def test_restart_seals_an_open_press_with_explicit_error(self) -> None:
        self.outbox.enqueue_press("device-turn-3", 8_000)
        self.outbox.close()
        self.outbox = DurableOutbox(self.path, max_pending_turns=4)

        with patch("pi_button_adapter.time.monotonic", return_value=9.25):
            sealed = self.outbox.seal_interrupted_turns()
        client = RecordingClient()
        dispatcher = self.dispatcher(client)
        while dispatcher.deliver_next() is not None:
            pass

        self.assertEqual(sealed, ["device-turn-3"])
        self.assertEqual(
            [kind for kind, _, _ in client.calls],
            ["create", "start", "error"],
        )
        error_payload = client.calls[-1][2]
        self.assertEqual(error_payload["code"], "device_input_interrupted")
        self.assertEqual(error_payload["monotonicMs"], 9_250)
        self.assertTrue(error_payload["recoverable"])

    def test_capacity_bound_rejects_a_new_turn_without_partial_rows(self) -> None:
        self.outbox.close()
        self.outbox = DurableOutbox(self.path, max_pending_turns=1)
        self.outbox.enqueue_press("device-turn-4", 10_000)

        with self.assertRaises(OutboxCapacityError):
            self.outbox.enqueue_press("device-turn-5", 11_000)

        operations = self.outbox.pending_operations()
        self.assertEqual({operation.session_id for operation in operations}, {"device-turn-4"})
        self.assertEqual([operation.kind for operation in operations], ["create", "start"])

    def test_gpio_callbacks_queue_locally_without_calling_a_client(self) -> None:
        notifications: list[str] = []
        bridge = ButtonEventBridge(
            outbox=self.outbox,
            notify_dispatcher=lambda: notifications.append("wake"),
            fixed_session_id="device-local-callback",
        )

        with patch("pi_button_adapter.time.monotonic", side_effect=[12.0, 12.4]):
            bridge.handle_pressed()
            self.assertIsNotNone(bridge.active_recording)
            bridge.handle_released()

        operations = self.outbox.pending_operations()
        self.assertEqual(
            [operation.kind for operation in operations],
            ["create", "start", "stop"],
        )
        self.assertEqual(operations[-1].payload["durationMs"], 400)
        self.assertEqual(notifications, ["wake", "wake"])
        self.assertIsNone(bridge.active_recording)

    def test_failed_stop_commit_keeps_turn_active_for_exact_retry(self) -> None:
        notifications: list[str] = []
        bridge = ButtonEventBridge(
            outbox=self.outbox,
            notify_dispatcher=lambda: notifications.append("wake"),
            fixed_session_id="device-stop-retry",
        )

        with patch(
            "pi_button_adapter.time.monotonic",
            side_effect=[20.0, 20.4, 20.6],
        ):
            bridge.handle_pressed()
            with patch.object(
                self.outbox,
                "enqueue_release",
                side_effect=sqlite3.OperationalError("disk full"),
            ):
                bridge.handle_released()

            self.assertIsNotNone(bridge.active_recording)
            self.assertEqual(notifications, ["wake"])
            self.assertEqual(
                [operation.kind for operation in self.outbox.pending_operations()],
                ["create", "start"],
            )

            bridge.handle_released()

        operations = self.outbox.pending_operations()
        self.assertEqual(
            [operation.kind for operation in operations],
            ["create", "start", "stop"],
        )
        self.assertEqual(operations[-1].payload["durationMs"], 600)
        self.assertEqual(notifications, ["wake", "wake"])
        self.assertIsNone(bridge.active_recording)


if __name__ == "__main__":
    unittest.main()
