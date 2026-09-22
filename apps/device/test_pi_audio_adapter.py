from __future__ import annotations

import base64
import hashlib
import io
import json
import socket
import subprocess
import threading
import time
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from pi_audio_adapter import (
    DEFAULT_FINALIZATION_TIMEOUT_SECONDS,
    DEFAULT_TURN_STOP_TIMEOUT_SECONDS,
    MAX_HTTP_RESPONSE_BYTES,
    ORDERED_PCM_PROTOCOL_VERSION,
    ORDERED_PCM_RECEIPT_VERSION,
    ArecordPcmCapture,
    DeviceAudioCaptureError,
    DeviceAudioConfigurationError,
    DeviceAudioResponseTooLargeError,
    DeviceAudioTransportError,
    OrderedPcmCaptureTurn,
    OrderedPcmIdentity,
    PcmProfile,
    Rfc6455OrderedPcmTransport,
    decode_jpcm_envelope_for_test,
    encode_jpcm_envelope,
    main,
    ordered_pcm_websocket_url,
    parse_args,
    post_device_terminal_error,
    register_device_session,
    run_timed_capture,
)


PCM_BLOCK = bytes((index % 251 for index in range(2_560)))


class BlockingStream:
    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._buffer = bytearray()
        self._closed = False

    def feed(self, value: bytes) -> None:
        with self._condition:
            if self._closed:
                return
            self._buffer.extend(value)
            self._condition.notify_all()

    def close_input(self) -> None:
        with self._condition:
            self._closed = True
            self._condition.notify_all()

    def read(self, size: int = -1) -> bytes:
        with self._condition:
            while not self._buffer and not self._closed:
                self._condition.wait()
            if not self._buffer:
                return b""
            selected_size = len(self._buffer) if size < 0 else min(size, len(self._buffer))
            value = bytes(self._buffer[:selected_size])
            del self._buffer[:selected_size]
            return value

    def readline(self) -> bytes:
        with self._condition:
            while b"\n" not in self._buffer and not self._closed:
                self._condition.wait()
            if not self._buffer:
                return b""
            newline = self._buffer.find(b"\n")
            selected_size = len(self._buffer) if newline < 0 else newline + 1
            value = bytes(self._buffer[:selected_size])
            del self._buffer[:selected_size]
            return value


class FailingStderrStream(BlockingStream):
    def readline(self) -> bytes:
        raise OSError("simulated stderr reader failure")


class FakeHttpResponse:
    def __init__(self, body: bytes) -> None:
        self._body = io.BytesIO(body)

    def __enter__(self) -> "FakeHttpResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        return self._body.read(size)


class FakeCaptureProcess:
    def __init__(
        self,
        blocks: list[bytes],
        *,
        block_interval_seconds: float = 0.001,
        stderr_lines: list[bytes] | None = None,
        stderr_stream: BlockingStream | None = None,
        ignore_sigint: bool = False,
        ignore_terminate: bool = False,
    ) -> None:
        self.stdout = BlockingStream()
        self.stderr = stderr_stream or BlockingStream()
        self.blocks = blocks
        self.block_interval_seconds = block_interval_seconds
        self.ignore_sigint = ignore_sigint
        self.ignore_terminate = ignore_terminate
        self.signals: list[int] = []
        self.terminate_calls = 0
        self.kill_calls = 0
        self.wait_timeouts: list[float] = []
        self._stopped = threading.Event()
        self._producer = threading.Thread(target=self._produce, daemon=True)
        self._stderr_lines = stderr_lines or []
        self._producer.start()

    def _produce(self) -> None:
        for line in self._stderr_lines:
            self.stderr.feed(line)
        for block in self.blocks:
            if self._stopped.is_set():
                break
            self.stdout.feed(block)
            time.sleep(self.block_interval_seconds)
        self._stopped.wait()
        self.stdout.close_input()
        self.stderr.close_input()

    def poll(self) -> int | None:
        return 0 if self._stopped.is_set() else None

    def send_signal(self, signal_number: int) -> None:
        self.signals.append(signal_number)
        if not self.ignore_sigint:
            self._stopped.set()

    def terminate(self) -> None:
        self.terminate_calls += 1
        if not self.ignore_terminate:
            self._stopped.set()

    def kill(self) -> None:
        self.kill_calls += 1
        self._stopped.set()

    def wait(self, timeout: float | None = None) -> int:
        self.wait_timeouts.append(0.0 if timeout is None else timeout)
        if not self._stopped.wait(timeout):
            raise subprocess.TimeoutExpired("fake-arecord", timeout)
        return 0


class RecordingTransport:
    def __init__(
        self,
        *,
        start_delay_seconds: float = 0.0,
        fail_chunk_sequence: int | None = None,
        forged_stop_receipt_patch: dict[str, object] | None = None,
    ) -> None:
        self.start_delay_seconds = start_delay_seconds
        self.fail_chunk_sequence = fail_chunk_sequence
        self.forged_stop_receipt_patch = forged_stop_receipt_patch
        self.messages: list[tuple[dict[str, object], bytes]] = []
        self.timeouts: list[tuple[str, float]] = []
        self.closed = False
        self.start_metadata: dict[str, object] | None = None

    def exchange(self, envelope: bytes, timeout_seconds: float):
        metadata, payload = decode_jpcm_envelope_for_test(envelope)
        self.messages.append((metadata, payload))
        message_type = metadata["type"]
        self.timeouts.append((message_type, timeout_seconds))
        if message_type == "audio.start":
            self.start_metadata = metadata
        if message_type == "audio.start" and self.start_delay_seconds:
            time.sleep(self.start_delay_seconds)
        if (
            message_type == "audio.chunk"
            and metadata["sequence"] == self.fail_chunk_sequence
        ):
            raise DeviceAudioTransportError("simulated ACK timeout")
        sequence = metadata.get("sequence", metadata.get("finalSequence", 0))
        response: dict[str, object] = {
            "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
            "type": "audio.ack",
            "sessionId": metadata["sessionId"],
            "attemptId": metadata["attemptId"],
            "sourceId": metadata["sourceId"],
            "audioProfileHash": metadata["audioProfileHash"],
            "acknowledgedType": message_type,
            "acknowledgedSequence": sequence,
            "commitState": "finalized" if message_type == "audio.stop" else "spooled",
        }
        if message_type == "audio.stop":
            if self.start_metadata is None:
                raise AssertionError("audio.stop arrived before audio.start")
            receipt: dict[str, object] = {
                "schemaVersion": ORDERED_PCM_RECEIPT_VERSION,
                "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
                "sessionId": metadata["sessionId"],
                "attemptId": metadata["attemptId"],
                "sourceId": metadata["sourceId"],
                "audioProfileHash": metadata["audioProfileHash"],
                "pcmProfile": self.start_metadata["pcmProfile"],
                "sourceStartedMonotonicMs": self.start_metadata["sourceMonotonicMs"],
                "sourceStoppedMonotonicMs": metadata["sourceMonotonicMs"],
                "finalSequence": metadata["finalSequence"],
                "receivedChunkCount": metadata["finalSequence"],
                "receivedFrameCount": metadata["emittedFrameCount"],
                "receivedByteCount": metadata["emittedByteCount"],
                "emittedFrameCount": metadata["emittedFrameCount"],
                "emittedByteCount": metadata["emittedByteCount"],
                "sequenceGapCount": 0,
                "missingChunkCount": 0,
                "lossEvidence": metadata["lossEvidence"],
                "coverageComplete": all(
                    value == 0 for value in metadata["lossEvidence"].values()
                ),
                "sourcePcmSha256": metadata["sourcePcmSha256"],
            }
            receipt.update(self.forged_stop_receipt_patch or {})
            response["receipt"] = receipt
        return response

    def close(self) -> None:
        self.closed = True


class CleanupFailingTransport(RecordingTransport):
    def close(self) -> None:
        self.closed = True
        raise DeviceAudioTransportError("simulated cleanup failure")


class SingleExchangeWebSocketServer:
    def __init__(self) -> None:
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.port = self.listener.getsockname()[1]
        self.message: tuple[dict[str, object], bytes] | None = None
        self.error: Exception | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def join(self) -> None:
        self.thread.join(1.0)
        self.listener.close()
        if self.thread.is_alive():
            raise AssertionError("fake WebSocket server did not exit")
        if self.error is not None:
            raise self.error

    def _run(self) -> None:
        try:
            connection, _address = self.listener.accept()
            with connection:
                request = bytearray()
                while b"\r\n\r\n" not in request:
                    request.extend(connection.recv(4_096))
                headers = {}
                for line in request.decode("ascii").split("\r\n")[1:]:
                    if ":" in line:
                        name, value = line.split(":", 1)
                        headers[name.strip().lower()] = value.strip()
                key = headers["sec-websocket-key"]
                accept = base64.b64encode(
                    hashlib.sha1(
                        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
                    ).digest()
                ).decode("ascii")
                connection.sendall(
                    (
                        "HTTP/1.1 101 Switching Protocols\r\n"
                        "Upgrade: websocket\r\n"
                        "Connection: Upgrade\r\n"
                        f"Sec-WebSocket-Accept: {accept}\r\n"
                        "Sec-WebSocket-Protocol: jiko.ordered-pcm.v1\r\n"
                        "\r\n"
                    ).encode("ascii")
                )
                opcode, payload = self._read_client_frame(connection)
                if opcode != 0x2:
                    raise AssertionError(f"expected binary frame, got opcode {opcode}")
                metadata, pcm = decode_jpcm_envelope_for_test(payload)
                self.message = (metadata, pcm)
                acknowledgement = json.dumps(
                    {
                        "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
                        "type": "audio.ack",
                        "sessionId": metadata["sessionId"],
                        "attemptId": metadata["attemptId"],
                        "sourceId": metadata["sourceId"],
                        "audioProfileHash": metadata["audioProfileHash"],
                        "acknowledgedType": metadata["type"],
                        "acknowledgedSequence": 0,
                        "commitState": "spooled",
                    },
                    separators=(",", ":"),
                ).encode("utf-8")
                connection.sendall(self._server_frame(0x1, acknowledgement))
        except Exception as error:
            self.error = error

    @staticmethod
    def _read_client_frame(connection: socket.socket) -> tuple[int, bytes]:
        header = SingleExchangeWebSocketServer._read_exact(connection, 2)
        opcode = header[0] & 0x0F
        length = header[1] & 0x7F
        if not header[1] & 0x80:
            raise AssertionError("client WebSocket frame was not masked")
        if length == 126:
            length = int.from_bytes(
                SingleExchangeWebSocketServer._read_exact(connection, 2), "big"
            )
        elif length == 127:
            length = int.from_bytes(
                SingleExchangeWebSocketServer._read_exact(connection, 8), "big"
            )
        mask = SingleExchangeWebSocketServer._read_exact(connection, 4)
        payload = bytearray(
            SingleExchangeWebSocketServer._read_exact(connection, length)
        )
        for index in range(length):
            payload[index] ^= mask[index & 3]
        return opcode, bytes(payload)

    @staticmethod
    def _server_frame(opcode: int, payload: bytes) -> bytes:
        if len(payload) < 126:
            return bytes((0x80 | opcode, len(payload))) + payload
        return bytes((0x80 | opcode, 126)) + len(payload).to_bytes(2, "big") + payload

    @staticmethod
    def _read_exact(connection: socket.socket, length: int) -> bytes:
        value = bytearray()
        while len(value) < length:
            block = connection.recv(length - len(value))
            if not block:
                raise AssertionError("client closed before completing a WebSocket frame")
            value.extend(block)
        return bytes(value)


def make_identity(profile: PcmProfile) -> OrderedPcmIdentity:
    return OrderedPcmIdentity(
        session_id="device-session-1",
        attempt_id="attempt-1",
        source_id="pi-alsa-test",
        audio_profile_hash=profile.sha256(),
    )


def wait_for(predicate, timeout_seconds: float = 1.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError("condition did not become true before timeout")


class PiAudioAdapterTest(unittest.TestCase):
    def test_invalid_cli_profile_fails_visibly_before_network_or_capture(self) -> None:
        error_output = io.StringIO()
        with redirect_stderr(error_output):
            exit_code = main(
                [
                    "--sample-rate-hz",
                    "8000",
                    "--duration-seconds",
                    "1",
                ]
            )
        self.assertEqual(exit_code, 1)
        self.assertIn("Device audio adapter failed", error_output.getvalue())
        self.assertIn("sample rate", error_output.getvalue())

    def test_invalid_server_url_is_rejected_as_configuration(self) -> None:
        with self.assertRaisesRegex(
            DeviceAudioConfigurationError, "server URL must be http"
        ):
            ordered_pcm_websocket_url("localhost:4317", "device-session-1")

    def test_non_finite_cli_timeouts_are_rejected(self) -> None:
        for option in (
            "--duration-seconds",
            "--ack-timeout-seconds",
            "--finalization-timeout-seconds",
            "--stop-timeout-seconds",
        ):
            for value in ("nan", "inf", "-inf"):
                with self.subTest(option=option, value=value):
                    with redirect_stderr(io.StringIO()):
                        with self.assertRaises(SystemExit):
                            parse_args([option, value])

    def test_session_registration_rejects_oversized_http_response(self) -> None:
        oversized_body = b"x" * (MAX_HTTP_RESPONSE_BYTES + 1)
        with patch(
            "pi_audio_adapter.urlopen",
            return_value=FakeHttpResponse(oversized_body),
        ):
            with self.assertRaisesRegex(
                DeviceAudioResponseTooLargeError,
                "session registration response exceeded",
            ):
                register_device_session(
                    "http://127.0.0.1:4317",
                    "device-session-oversized-response",
                )

    def test_prestart_transport_failure_seals_confirmed_session(self) -> None:
        args = parse_args(
            [
                "--session-id",
                "device-prestart-failure",
                "--duration-seconds",
                "1",
            ]
        )
        profile = PcmProfile(sample_rate_hz=args.sample_rate_hz)
        identity = OrderedPcmIdentity(
            session_id=args.session_id,
            attempt_id="attempt-prestart-failure",
            source_id="pi-alsa-prestart-failure",
            audio_profile_hash=profile.sha256(),
        )
        connect_error = DeviceAudioTransportError("simulated connect failure")

        with (
            patch(
                "pi_audio_adapter.register_device_session",
                return_value=identity,
            ),
            patch.object(
                Rfc6455OrderedPcmTransport,
                "connect",
                side_effect=connect_error,
            ),
            patch(
                "pi_audio_adapter.post_device_terminal_error",
                return_value="sealed",
            ) as post_terminal_error,
        ):
            with self.assertRaisesRegex(
                DeviceAudioTransportError,
                "simulated connect failure",
            ):
                run_timed_capture(args)

        post_terminal_error.assert_called_once_with(
            args.server_url,
            args.session_id,
            code="device_audio_start_failed",
            message="Device audio capture could not start",
            timeout_seconds=args.connect_timeout_seconds,
        )

    def test_prestart_cleanup_failure_does_not_skip_terminal_sealing(self) -> None:
        args = parse_args(["--session-id", "device-prestart-cleanup-failure"])
        profile = PcmProfile(sample_rate_hz=args.sample_rate_hz)
        identity = OrderedPcmIdentity(
            session_id=args.session_id,
            attempt_id="attempt-prestart-cleanup-failure",
            source_id="pi-alsa-prestart-cleanup-failure",
            audio_profile_hash=profile.sha256(),
        )
        transport = CleanupFailingTransport()

        with (
            patch(
                "pi_audio_adapter.register_device_session",
                return_value=identity,
            ),
            patch.object(
                Rfc6455OrderedPcmTransport,
                "connect",
                return_value=transport,
            ),
            patch(
                "pi_audio_adapter.signal.signal",
                side_effect=ValueError("simulated signal setup failure"),
            ),
            patch(
                "pi_audio_adapter.post_device_terminal_error",
                return_value="sealed",
            ) as post_terminal_error,
        ):
            with self.assertRaisesRegex(
                DeviceAudioTransportError,
                "local audio cleanup also failed",
            ):
                run_timed_capture(args)

        post_terminal_error.assert_called_once()
        self.assertTrue(transport.closed)

    def test_terminal_error_retry_reuses_exact_event_identity(self) -> None:
        request_bodies: list[bytes] = []

        def fake_urlopen(request, *, timeout: float):
            self.assertEqual(timeout, 0.5)
            self.assertIsInstance(request.data, bytes)
            request_bodies.append(request.data)
            if len(request_bodies) == 1:
                raise URLError("simulated lost response")
            event = json.loads(request.data)
            response = {
                "session": {
                    "id": "device-terminal-retry",
                    "status": "error",
                },
                "event": event,
                "replayed": True,
            }
            return FakeHttpResponse(
                json.dumps(response, separators=(",", ":")).encode("utf-8")
            )

        with patch("pi_audio_adapter.urlopen", side_effect=fake_urlopen):
            result = post_device_terminal_error(
                "http://127.0.0.1:4317",
                "device-terminal-retry",
                code="device_audio_start_failed",
                message="Device audio capture could not start",
                timeout_seconds=0.5,
                monotonic_ms=1_234,
                attempts=2,
            )

        self.assertEqual(result, "sealed")
        self.assertEqual(len(request_bodies), 2)
        self.assertEqual(request_bodies[0], request_bodies[1])
        self.assertEqual(
            json.loads(request_bodies[0]),
            {
                "type": "session.error",
                "source": "device",
                "monotonicMs": 1_234,
                "message": "Device audio capture could not start",
                "code": "device_audio_start_failed",
                "recoverable": True,
            },
        )

    def test_terminal_error_claim_conflict_requires_confirmed_error_state(self) -> None:
        def conflict(status: str) -> HTTPError:
            body = json.dumps(
                {
                    "error": "attempt input already owned",
                    "session": {
                        "id": "device-terminal-conflict",
                        "status": status,
                    },
                },
                separators=(",", ":"),
            ).encode("utf-8")
            return HTTPError(
                "http://127.0.0.1:4317/sessions/device-terminal-conflict/input-event",
                409,
                "Conflict",
                hdrs=None,
                fp=io.BytesIO(body),
            )

        with patch(
            "pi_audio_adapter.urlopen",
            side_effect=conflict("error"),
        ):
            result = post_device_terminal_error(
                "http://127.0.0.1:4317",
                "device-terminal-conflict",
                code="device_audio_start_failed",
                message="Device audio capture could not start",
                timeout_seconds=0.5,
                monotonic_ms=1_235,
                attempts=1,
            )
        self.assertEqual(result, "sealed_by_audio_transport")

        with patch(
            "pi_audio_adapter.urlopen",
            side_effect=conflict("recording"),
        ):
            with self.assertRaisesRegex(
                DeviceAudioTransportError,
                "before terminal state was confirmed",
            ):
                post_device_terminal_error(
                    "http://127.0.0.1:4317",
                    "device-terminal-conflict",
                    code="device_audio_start_failed",
                    message="Device audio capture could not start",
                    timeout_seconds=0.5,
                    monotonic_ms=1_236,
                    attempts=1,
                )

    def test_profile_hash_matches_typescript_canonical_contract(self) -> None:
        profile = PcmProfile()
        self.assertEqual(
            profile.canonical_json(),
            '{"channelCount":1,"sampleFormat":"s16le","sampleRateHz":16000}',
        )
        self.assertEqual(
            profile.sha256(),
            "de8505a853c6f178d4455830fb1d1cd73f07aed11b3cfc5cccd3169c04e444a3",
        )

    def test_dependency_free_websocket_client_negotiates_and_masks_jpcm(self) -> None:
        server = SingleExchangeWebSocketServer()
        server.start()
        profile = PcmProfile()
        identity = make_identity(profile)
        start_message = {
            "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
            "type": "audio.start",
            **identity.protocol_value(),
            "sourceMonotonicMs": 1_000,
            "pcmProfile": profile.protocol_value(),
        }
        transport = Rfc6455OrderedPcmTransport.connect(
            f"ws://127.0.0.1:{server.port}/sessions/device-session-1/audio-stream",
            origin="http://localhost:5173",
            timeout_seconds=1.0,
        )
        try:
            response = transport.exchange(
                encode_jpcm_envelope(start_message), timeout_seconds=1.0
            )
        finally:
            transport.close()
            server.join()

        self.assertEqual(response["type"], "audio.ack")
        self.assertIsNotNone(server.message)
        self.assertEqual(server.message[0]["type"], "audio.start")
        self.assertEqual(server.message[1], b"")

    def test_fake_arecord_turn_emits_start_chunks_stop_and_source_hash(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess([PCM_BLOCK, PCM_BLOCK])
        commands: list[list[str]] = []

        def process_factory(command: list[str]):
            commands.append(command)
            return process

        capture = ArecordPcmCapture(
            profile=profile,
            queue_chunks=4,
            process_factory=process_factory,
        )
        transport = RecordingTransport()
        turn = OrderedPcmCaptureTurn(
            capture=capture,
            transport=transport,
            identity=make_identity(profile),
        )

        turn.start()
        wait_for(
            lambda: len(
                [message for message, _ in transport.messages if message["type"] == "audio.chunk"]
            )
            >= 2
        )
        acknowledgement = turn.stop()

        messages = [message for message, _ in transport.messages]
        payloads = [payload for message, payload in transport.messages if message["type"] == "audio.chunk"]
        self.assertEqual([message["type"] for message in messages], [
            "audio.start",
            "audio.chunk",
            "audio.chunk",
            "audio.stop",
        ])
        self.assertEqual([messages[1]["sequence"], messages[2]["sequence"]], [1, 2])
        self.assertAlmostEqual(
            messages[1]["sourceMonotonicMs"] - messages[0]["sourceMonotonicMs"],
            80.0,
            places=3,
        )
        self.assertAlmostEqual(
            messages[2]["sourceMonotonicMs"] - messages[0]["sourceMonotonicMs"],
            160.0,
            places=3,
        )
        self.assertEqual(messages[-1]["emittedFrameCount"], 2_560)
        self.assertEqual(messages[-1]["emittedByteCount"], 5_120)
        self.assertAlmostEqual(
            messages[-1]["sourceMonotonicMs"] - messages[0]["sourceMonotonicMs"],
            160.0,
            places=3,
        )
        self.assertEqual(
            messages[-1]["sourcePcmSha256"],
            __import__("hashlib").sha256(PCM_BLOCK + PCM_BLOCK).hexdigest(),
        )
        self.assertEqual(payloads, [PCM_BLOCK, PCM_BLOCK])
        self.assertTrue(acknowledgement["receipt"]["coverageComplete"])
        self.assertTrue(transport.closed)
        self.assertEqual(commands[0][0], "arecord")
        self.assertIn("raw", commands[0])
        self.assertNotIn("--output", commands[0])

    def test_control_and_finalization_timeouts_are_separate_and_bounded(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess([PCM_BLOCK])
        capture = ArecordPcmCapture(
            profile=profile,
            process_factory=lambda _command: process,
        )
        transport = RecordingTransport()
        turn = OrderedPcmCaptureTurn(
            capture=capture,
            transport=transport,
            identity=make_identity(profile),
            ack_timeout_seconds=0.25,
            finalization_timeout_seconds=1.5,
        )

        turn.start()
        wait_for(
            lambda: any(
                message[0]["type"] == "audio.chunk"
                for message in transport.messages
            )
        )
        turn.stop(timeout_seconds=2.0)

        timeout_by_type = dict(transport.timeouts)
        self.assertEqual(timeout_by_type["audio.start"], 0.25)
        self.assertEqual(timeout_by_type["audio.chunk"], 0.25)
        self.assertGreater(timeout_by_type["audio.stop"], 1.0)
        self.assertLessEqual(timeout_by_type["audio.stop"], 1.5)
        self.assertGreater(DEFAULT_FINALIZATION_TIMEOUT_SECONDS, 60.0)
        self.assertGreater(
            DEFAULT_TURN_STOP_TIMEOUT_SECONDS,
            DEFAULT_FINALIZATION_TIMEOUT_SECONDS,
        )

    def test_bounded_queue_reports_dropped_pcm_instead_of_hiding_it(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess(
            [PCM_BLOCK] * 12,
            block_interval_seconds=0.0001,
        )
        capture = ArecordPcmCapture(
            profile=profile,
            queue_chunks=1,
            process_factory=lambda _command: process,
        )
        transport = RecordingTransport(start_delay_seconds=0.05)
        turn = OrderedPcmCaptureTurn(
            capture=capture,
            transport=transport,
            identity=make_identity(profile),
        )

        turn.start()
        with self.assertRaisesRegex(
            DeviceAudioCaptureError,
            "explicit PCM loss evidence",
        ):
            turn.stop()

        stop_message = transport.messages[-1][0]
        evidence = stop_message["lossEvidence"]
        self.assertGreater(evidence["captureGapCount"], 0)
        self.assertGreater(evidence["droppedFrameCount"], 0)
        self.assertEqual(
            evidence["droppedByteCount"], evidence["droppedFrameCount"] * 2
        )
        self.assertGreater(evidence["overflowCount"], 0)
        accounted_frames = (
            stop_message["emittedFrameCount"] + evidence["droppedFrameCount"]
        )
        self.assertAlmostEqual(
            stop_message["sourceMonotonicMs"]
            - transport.messages[0][0]["sourceMonotonicMs"],
            accounted_frames / profile.sample_rate_hz * 1_000,
            places=3,
        )

    def test_arecord_xrun_is_cumulative_in_loss_evidence(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess(
            [PCM_BLOCK],
            stderr_lines=[b"arecord: pcm_read: overrun!!!\n"],
        )
        capture = ArecordPcmCapture(
            profile=profile,
            process_factory=lambda _command: process,
        )
        transport = RecordingTransport()
        turn = OrderedPcmCaptureTurn(
            capture=capture,
            transport=transport,
            identity=make_identity(profile),
        )

        turn.start()
        wait_for(
            lambda: any(
                message["type"] == "audio.chunk" for message, _ in transport.messages
            )
        )
        with self.assertRaisesRegex(DeviceAudioCaptureError, "loss evidence"):
            turn.stop()

        stop_message = transport.messages[-1][0]
        self.assertEqual(stop_message["lossEvidence"]["captureGapCount"], 1)
        self.assertEqual(stop_message["lossEvidence"]["droppedFrameCount"], 0)
        self.assertEqual(capture.stderr_tail.count("overrun"), 1)

    def test_forged_final_receipt_is_rejected_before_success(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess([PCM_BLOCK])
        capture = ArecordPcmCapture(
            profile=profile,
            process_factory=lambda _command: process,
        )
        transport = RecordingTransport(
            forged_stop_receipt_patch={"receivedByteCount": 1}
        )
        turn = OrderedPcmCaptureTurn(
            capture=capture,
            transport=transport,
            identity=make_identity(profile),
        )

        turn.start()
        wait_for(
            lambda: any(
                message["type"] == "audio.chunk" for message, _ in transport.messages
            )
        )
        with self.assertRaisesRegex(
            DeviceAudioTransportError, "receipt receivedByteCount"
        ):
            turn.stop()

        self.assertTrue(transport.closed)

    def test_transport_failure_cancels_arecord_process(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess([PCM_BLOCK, PCM_BLOCK])
        capture = ArecordPcmCapture(
            profile=profile,
            process_factory=lambda _command: process,
        )
        transport = RecordingTransport(fail_chunk_sequence=1)
        turn = OrderedPcmCaptureTurn(
            capture=capture,
            transport=transport,
            identity=make_identity(profile),
        )

        turn.start()
        wait_for(lambda: turn.failure is not None)
        with self.assertRaisesRegex(DeviceAudioTransportError, "ACK timeout"):
            turn.stop()

        self.assertTrue(process.signals)
        self.assertTrue(transport.closed)

    def test_first_chunk_timeout_stops_a_silent_process(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess([])
        capture = ArecordPcmCapture(
            profile=profile,
            first_chunk_timeout_seconds=0.02,
            process_factory=lambda _command: process,
        )

        with self.assertRaisesRegex(DeviceAudioCaptureError, "produced no PCM"):
            capture.start()

        self.assertTrue(process.signals)

    def test_stderr_monitor_failure_fails_closed(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess(
            [],
            stderr_stream=FailingStderrStream(),
        )
        capture = ArecordPcmCapture(
            profile=profile,
            first_chunk_timeout_seconds=0.2,
            process_factory=lambda _command: process,
        )

        with self.assertRaisesRegex(
            DeviceAudioCaptureError,
            "stderr monitor failed",
        ):
            capture.start()

        self.assertEqual(capture.loss_evidence().capture_gap_count, 1)
        self.assertTrue(process.signals)

    def test_process_that_ignores_sigint_and_terminate_is_killed(self) -> None:
        profile = PcmProfile()
        process = FakeCaptureProcess(
            [PCM_BLOCK],
            ignore_sigint=True,
            ignore_terminate=True,
        )
        capture = ArecordPcmCapture(
            profile=profile,
            process_factory=lambda _command: process,
        )
        capture.start()
        # Keep one absolute budget across both escalation waits and thread
        # joins, while leaving a loaded host enough time to schedule EOF.
        started = time.monotonic()
        capture.stop(timeout_seconds=1.0)
        elapsed = time.monotonic() - started

        self.assertEqual(process.terminate_calls, 1)
        self.assertEqual(process.kill_calls, 1)
        self.assertLessEqual(sum(process.wait_timeouts), 1.05)
        self.assertLess(elapsed, 1.25)

    def test_python_envelopes_decode_with_authoritative_typescript_protocol(self) -> None:
        repository = Path(__file__).resolve().parents[2]
        protocol_dist = repository / "packages/protocol/dist/index.js"
        if not protocol_dist.exists():
            self.skipTest("packages/protocol/dist is absent; run pnpm build for cross-runtime proof")
        profile = PcmProfile()
        identity = make_identity(profile).protocol_value()
        no_loss = {
            "captureGapCount": 0,
            "droppedFrameCount": 0,
            "droppedByteCount": 0,
            "overflowCount": 0,
        }
        start = {
            "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
            "type": "audio.start",
            **identity,
            "sourceMonotonicMs": 1_000,
            "pcmProfile": profile.protocol_value(),
        }
        chunk = {
            "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
            "type": "audio.chunk",
            **identity,
            "sequence": 1,
            "sourceMonotonicMs": 1_080,
            "frameCount": len(PCM_BLOCK) // 2,
            "byteCount": len(PCM_BLOCK),
            "lossEvidence": no_loss,
        }
        stop = {
            "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
            "type": "audio.stop",
            **identity,
            "sourceMonotonicMs": 1_080,
            "finalSequence": 1,
            "emittedFrameCount": len(PCM_BLOCK) // 2,
            "emittedByteCount": len(PCM_BLOCK),
            "lossEvidence": no_loss,
            "sourcePcmSha256": __import__("hashlib").sha256(PCM_BLOCK).hexdigest(),
        }
        envelopes = [
            encode_jpcm_envelope(start),
            encode_jpcm_envelope(chunk, PCM_BLOCK),
            encode_jpcm_envelope(stop),
        ]
        script = f"""
import {{ decodeOrderedPcmBinaryEnvelope }} from {json.dumps(protocol_dist.as_uri())};
let input = '';
for await (const block of process.stdin) input += block;
const decoded = JSON.parse(input).map((encoded) => {{
  const message = decodeOrderedPcmBinaryEnvelope(Buffer.from(encoded, 'base64'));
  return {{
    type: message.type,
    sequence: message.sequence ?? message.finalSequence ?? 0,
    payloadBytes: message.pcmBytes?.byteLength ?? 0
  }};
}});
process.stdout.write(JSON.stringify(decoded));
"""
        completed = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            input=json.dumps(
                [base64.b64encode(envelope).decode("ascii") for envelope in envelopes]
            ),
            text=True,
            capture_output=True,
            check=False,
            cwd=repository,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(
            json.loads(completed.stdout),
            [
                {"type": "audio.start", "sequence": 0, "payloadBytes": 0},
                {"type": "audio.chunk", "sequence": 1, "payloadBytes": 2_560},
                {"type": "audio.stop", "sequence": 1, "payloadBytes": 0},
            ],
        )


if __name__ == "__main__":
    unittest.main()
