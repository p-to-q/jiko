#!/usr/bin/env python3
"""Bounded Raspberry Pi ALSA -> jiko ordered-PCM edge adapter.

The hardware-specific part of this module is deliberately small: ``arecord``
writes raw mono s16le PCM to a pipe.  A bounded in-memory queue separates that
capture process from the canonical JPCM/WebSocket transport used by the
browser.  Audio is never written to a named file on the device.

This is an edge adapter, not an STT implementation.  The server remains the
owner of attempt admission, normalization, STT, readings, and result commit.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import queue
import re
import signal
import socket
import ssl
import struct
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, BinaryIO, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, urlopen


ORDERED_PCM_PROTOCOL_VERSION = "ordered_pcm_v1"
ORDERED_PCM_RECEIPT_VERSION = "ordered_pcm_receipt_v1"
ORDERED_PCM_WS_SUBPROTOCOL = "jiko.ordered-pcm.v1"
JPCM_MAGIC = b"JPCM"
JPCM_ENVELOPE_VERSION = 1
JPCM_FIXED_HEADER_BYTES = 10
MAX_JPCM_METADATA_BYTES = 16_384
MAX_JPCM_CHUNK_BYTES = 1_048_576
SUPPORTED_SAMPLE_RATES_HZ = frozenset({16_000, 44_100, 48_000})
IDENTIFIER_PATTERN = re.compile(r"^[a-zA-Z0-9._:-]{1,96}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
XRUN_PATTERN = re.compile(rb"\b(?:xrun|overrun)\b", re.IGNORECASE)

DEFAULT_SERVER_URL = "http://127.0.0.1:4317"
DEFAULT_ORIGIN = "http://localhost:5173"
DEFAULT_ALSA_DEVICE = "default"
DEFAULT_SAMPLE_RATE_HZ = 16_000
DEFAULT_CHUNK_DURATION_MS = 80
DEFAULT_QUEUE_CHUNKS = 16
DEFAULT_FIRST_CHUNK_TIMEOUT_SECONDS = 2.0
DEFAULT_CONTROL_ACK_TIMEOUT_SECONDS = 3.0
# The server contract permits SESSION_DEADLINE_MS up to 60 seconds after
# audio.stop. Leave a bounded five-second envelope for final receipt delivery.
DEFAULT_FINALIZATION_TIMEOUT_SECONDS = 65.0
DEFAULT_PROCESS_STOP_TIMEOUT_SECONDS = 2.0
DEFAULT_TURN_STOP_TIMEOUT_SECONDS = 70.0
MAX_SERVER_MESSAGE_BYTES = 128 * 1024
MAX_HANDSHAKE_BYTES = 16 * 1024
MAX_HTTP_RESPONSE_BYTES = 64 * 1024
TERMINAL_ERROR_ATTEMPTS = 2


class DeviceAudioError(Exception):
    """Base error for the device audio edge."""


class DeviceAudioConfigurationError(DeviceAudioError):
    """Raised before capture when configuration is unsafe or unsupported."""


class DeviceAudioCaptureError(DeviceAudioError):
    """Raised when the local PCM source cannot provide complete audio."""


class DeviceAudioTransportError(DeviceAudioError):
    """Raised when the ordered-PCM transport cannot make progress safely."""


class DeviceAudioResponseTooLargeError(DeviceAudioTransportError):
    """Raised before an unbounded HTTP response can consume device memory."""


class DeviceAudioServerError(DeviceAudioError):
    """Raised for a typed ``audio.error`` response from the jiko server."""

    def __init__(self, code: str, message: str, recoverable: bool) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.recoverable = recoverable


@dataclass(frozen=True)
class PcmProfile:
    sample_rate_hz: int = DEFAULT_SAMPLE_RATE_HZ
    channel_count: int = 1
    sample_format: str = "s16le"

    def __post_init__(self) -> None:
        if self.sample_rate_hz not in SUPPORTED_SAMPLE_RATES_HZ:
            raise DeviceAudioConfigurationError(
                "sample rate must be one of 16000, 44100, or 48000 Hz"
            )
        if self.channel_count != 1 or self.sample_format != "s16le":
            raise DeviceAudioConfigurationError(
                "ordered PCM currently requires mono s16le audio"
            )

    @property
    def bytes_per_frame(self) -> int:
        return self.channel_count * 2

    def protocol_value(self) -> dict[str, Any]:
        return {
            "sampleFormat": self.sample_format,
            "sampleRateHz": self.sample_rate_hz,
            "channelCount": self.channel_count,
        }

    def canonical_json(self) -> str:
        # This key order is part of packages/protocol's profile-hash contract.
        return json.dumps(
            {
                "channelCount": self.channel_count,
                "sampleFormat": self.sample_format,
                "sampleRateHz": self.sample_rate_hz,
            },
            separators=(",", ":"),
        )

    def sha256(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class OrderedPcmIdentity:
    session_id: str
    attempt_id: str
    source_id: str
    audio_profile_hash: str

    def __post_init__(self) -> None:
        for label, value in (
            ("session_id", self.session_id),
            ("attempt_id", self.attempt_id),
            ("source_id", self.source_id),
        ):
            if not IDENTIFIER_PATTERN.fullmatch(value):
                raise DeviceAudioConfigurationError(f"invalid {label}: {value!r}")
        if not SHA256_PATTERN.fullmatch(self.audio_profile_hash):
            raise DeviceAudioConfigurationError("audio_profile_hash must be SHA-256 hex")

    def protocol_value(self) -> dict[str, str]:
        return {
            "sessionId": self.session_id,
            "attemptId": self.attempt_id,
            "sourceId": self.source_id,
            "audioProfileHash": self.audio_profile_hash,
        }


@dataclass(frozen=True)
class LossEvidence:
    capture_gap_count: int = 0
    dropped_frame_count: int = 0
    dropped_byte_count: int = 0
    overflow_count: int = 0

    @property
    def complete(self) -> bool:
        return (
            self.capture_gap_count == 0
            and self.dropped_frame_count == 0
            and self.dropped_byte_count == 0
            and self.overflow_count == 0
        )

    def protocol_value(self) -> dict[str, int]:
        return {
            "captureGapCount": self.capture_gap_count,
            "droppedFrameCount": self.dropped_frame_count,
            "droppedByteCount": self.dropped_byte_count,
            "overflowCount": self.overflow_count,
        }


@dataclass(frozen=True)
class CapturedPcmBlock:
    pcm_bytes: bytes
    frame_count: int
    source_monotonic_ms: float


class CaptureProcess(Protocol):
    stdout: BinaryIO | None
    stderr: BinaryIO | None

    def poll(self) -> int | None: ...

    def send_signal(self, signal_number: int) -> None: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...

    def wait(self, timeout: float | None = None) -> int: ...


class OrderedPcmTransport(Protocol):
    def exchange(self, envelope: bytes, timeout_seconds: float) -> Mapping[str, Any]: ...

    def close(self) -> None: ...


def encode_jpcm_envelope(metadata: Mapping[str, Any], pcm_bytes: bytes = b"") -> bytes:
    """Encode the exact binary envelope consumed by packages/protocol."""

    message_type = metadata.get("type")
    kind_by_type = {"audio.start": 1, "audio.chunk": 2, "audio.stop": 3}
    kind = kind_by_type.get(message_type)
    if kind is None:
        raise DeviceAudioConfigurationError(f"unsupported JPCM message type: {message_type!r}")
    if message_type == "audio.chunk":
        if not pcm_bytes:
            raise DeviceAudioConfigurationError("audio.chunk PCM payload must not be empty")
    elif pcm_bytes:
        raise DeviceAudioConfigurationError(f"{message_type} must not carry PCM bytes")
    if len(pcm_bytes) > MAX_JPCM_CHUNK_BYTES:
        raise DeviceAudioConfigurationError("JPCM PCM payload exceeds the protocol limit")

    metadata_bytes = json.dumps(
        dict(metadata),
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    if not metadata_bytes or len(metadata_bytes) > MAX_JPCM_METADATA_BYTES:
        raise DeviceAudioConfigurationError("JPCM metadata exceeds the protocol limit")

    return b"".join(
        (
            JPCM_MAGIC,
            bytes((JPCM_ENVELOPE_VERSION, kind)),
            struct.pack(">I", len(metadata_bytes)),
            metadata_bytes,
            pcm_bytes,
        )
    )


def decode_jpcm_envelope_for_test(envelope: bytes) -> tuple[dict[str, Any], bytes]:
    """Small independent decoder used by device tests and fake transports."""

    if len(envelope) < JPCM_FIXED_HEADER_BYTES or envelope[:4] != JPCM_MAGIC:
        raise DeviceAudioTransportError("invalid JPCM envelope header")
    if envelope[4] != JPCM_ENVELOPE_VERSION:
        raise DeviceAudioTransportError("unsupported JPCM envelope version")
    expected_type = {1: "audio.start", 2: "audio.chunk", 3: "audio.stop"}.get(envelope[5])
    if expected_type is None:
        raise DeviceAudioTransportError("unknown JPCM message kind")
    metadata_length = struct.unpack(">I", envelope[6:10])[0]
    metadata_end = JPCM_FIXED_HEADER_BYTES + metadata_length
    if metadata_length == 0 or metadata_end > len(envelope):
        raise DeviceAudioTransportError("truncated JPCM metadata")
    try:
        metadata = json.loads(envelope[JPCM_FIXED_HEADER_BYTES:metadata_end])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeviceAudioTransportError("invalid JPCM metadata") from error
    if not isinstance(metadata, dict) or metadata.get("type") != expected_type:
        raise DeviceAudioTransportError("JPCM kind does not match its metadata")
    payload = envelope[metadata_end:]
    if expected_type != "audio.chunk" and payload:
        raise DeviceAudioTransportError("non-chunk JPCM message carried a payload")
    return metadata, payload


class ArecordPcmCapture:
    """Own one bounded ``arecord`` process and its in-memory PCM queue."""

    def __init__(
        self,
        *,
        alsa_device: str = DEFAULT_ALSA_DEVICE,
        profile: PcmProfile | None = None,
        chunk_duration_ms: int = DEFAULT_CHUNK_DURATION_MS,
        queue_chunks: int = DEFAULT_QUEUE_CHUNKS,
        first_chunk_timeout_seconds: float = DEFAULT_FIRST_CHUNK_TIMEOUT_SECONDS,
        process_factory: Callable[[list[str]], CaptureProcess] | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.profile = profile or PcmProfile()
        if not alsa_device or any(character in alsa_device for character in "\r\n\0"):
            raise DeviceAudioConfigurationError("ALSA device name is empty or unsafe")
        if chunk_duration_ms <= 0:
            raise DeviceAudioConfigurationError("chunk duration must be positive")
        chunk_frames_numerator = self.profile.sample_rate_hz * chunk_duration_ms
        if chunk_frames_numerator % 1_000 != 0:
            raise DeviceAudioConfigurationError(
                "chunk duration must produce an integral PCM frame count"
            )
        if queue_chunks <= 0:
            raise DeviceAudioConfigurationError("PCM queue bound must be positive")
        if first_chunk_timeout_seconds <= 0:
            raise DeviceAudioConfigurationError("first-chunk timeout must be positive")

        self.alsa_device = alsa_device
        self.chunk_duration_ms = chunk_duration_ms
        self.chunk_frames = chunk_frames_numerator // 1_000
        self.chunk_bytes = self.chunk_frames * self.profile.bytes_per_frame
        if self.chunk_bytes > MAX_JPCM_CHUNK_BYTES:
            raise DeviceAudioConfigurationError("PCM chunk exceeds the protocol limit")
        self.first_chunk_timeout_seconds = first_chunk_timeout_seconds
        self._process_factory = process_factory or self._spawn_arecord
        self._monotonic = monotonic
        self._queue: queue.Queue[CapturedPcmBlock] = queue.Queue(maxsize=queue_chunks)
        self._done = threading.Event()
        self._first_block = threading.Event()
        self._stop_requested = threading.Event()
        self._lock = threading.Lock()
        self._process: CaptureProcess | None = None
        self._reader_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None
        self._source_started_monotonic_ms: float | None = None
        self._source_stopped_monotonic_ms: float | None = None
        self._captured_frame_count = 0
        self._error: DeviceAudioCaptureError | None = None
        self._capture_gap_count = 0
        self._dropped_frame_count = 0
        self._dropped_byte_count = 0
        self._overflow_count = 0
        self._stderr_tail = bytearray()

    @property
    def command(self) -> list[str]:
        return [
            "arecord",
            "--quiet",
            "--device",
            self.alsa_device,
            "--type",
            "raw",
            "--format",
            "S16_LE",
            "--channels",
            str(self.profile.channel_count),
            "--rate",
            str(self.profile.sample_rate_hz),
        ]

    @property
    def source_started_monotonic_ms(self) -> float:
        if self._source_started_monotonic_ms is None:
            raise DeviceAudioCaptureError("PCM capture has not produced its first frame")
        return self._source_started_monotonic_ms

    @property
    def source_stopped_monotonic_ms(self) -> float:
        if self._source_stopped_monotonic_ms is None:
            raise DeviceAudioCaptureError("PCM capture has not stopped")
        return self._source_stopped_monotonic_ms

    @property
    def done(self) -> bool:
        return self._done.is_set()

    @property
    def error(self) -> DeviceAudioCaptureError | None:
        with self._lock:
            return self._error

    @property
    def stderr_tail(self) -> str:
        with self._lock:
            return bytes(self._stderr_tail).decode("utf-8", errors="replace")

    def loss_evidence(self) -> LossEvidence:
        with self._lock:
            return LossEvidence(
                capture_gap_count=self._capture_gap_count,
                dropped_frame_count=self._dropped_frame_count,
                dropped_byte_count=self._dropped_byte_count,
                overflow_count=self._overflow_count,
            )

    def start(self) -> None:
        if self._process is not None:
            raise DeviceAudioCaptureError("PCM capture is already started")
        try:
            process = self._process_factory(self.command)
        except (OSError, subprocess.SubprocessError) as error:
            raise DeviceAudioCaptureError(f"could not start arecord: {error}") from error
        if process.stdout is None or process.stderr is None:
            self._terminate_process(process, self._monotonic() + 0.25)
            raise DeviceAudioCaptureError("arecord must expose stdout and stderr pipes")
        self._process = process
        self._reader_thread = threading.Thread(
            target=self._read_pcm,
            name="jiko-alsa-pcm-reader",
            daemon=True,
        )
        self._stderr_thread = threading.Thread(
            target=self._read_stderr,
            name="jiko-alsa-stderr-reader",
            daemon=True,
        )
        self._reader_thread.start()
        self._stderr_thread.start()

        deadline = self._monotonic() + self.first_chunk_timeout_seconds
        while not self._first_block.wait(timeout=0.01):
            error = self.error
            if error is not None:
                self.abort()
                raise error
            if self._done.is_set():
                self.abort()
                detail = self.stderr_tail.strip()
                suffix = f": {detail}" if detail else ""
                raise DeviceAudioCaptureError(
                    f"arecord ended before the first PCM frame{suffix}"
                )
            if self._monotonic() >= deadline:
                self.abort()
                raise DeviceAudioCaptureError(
                    f"arecord produced no PCM within {self.first_chunk_timeout_seconds:g}s"
                )

    def read_block(self, timeout_seconds: float) -> CapturedPcmBlock | None:
        if timeout_seconds <= 0:
            raise DeviceAudioConfigurationError("PCM read timeout must be positive")
        while True:
            try:
                return self._queue.get(timeout=timeout_seconds)
            except queue.Empty:
                error = self.error
                if error is not None:
                    raise error
                if self._done.is_set():
                    return None

    def stop(
        self,
        timeout_seconds: float = DEFAULT_PROCESS_STOP_TIMEOUT_SECONDS,
        *,
        deadline_monotonic: float | None = None,
    ) -> None:
        if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise DeviceAudioConfigurationError("process stop timeout must be finite and positive")
        deadline = self._monotonic() + timeout_seconds
        if deadline_monotonic is not None:
            deadline = min(deadline, deadline_monotonic)
        self._stop_requested.set()
        process = self._process
        if process is None:
            return
        self._terminate_process(process, deadline)
        self._join_capture_threads(deadline)
        error = self.error
        if error is not None:
            raise error

    def abort(self, *, deadline_monotonic: float | None = None) -> None:
        deadline = self._monotonic() + 0.25
        if deadline_monotonic is not None:
            deadline = min(deadline, deadline_monotonic)
        self._stop_requested.set()
        process = self._process
        if process is not None:
            self._terminate_process(process, deadline)
        self._join_capture_threads(deadline)

    def _spawn_arecord(self, command: list[str]) -> CaptureProcess:
        return subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
            start_new_session=True,
        )

    def _read_pcm(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            self._set_error(DeviceAudioCaptureError("arecord stdout is unavailable"))
            self._done.set()
            return

        pending = bytearray()
        try:
            while True:
                block = process.stdout.read(self.chunk_bytes - len(pending))
                if not block:
                    break
                pending.extend(block)
                if len(pending) == self.chunk_bytes:
                    self._enqueue_pcm(bytes(pending))
                    pending.clear()
            if pending:
                self._enqueue_pcm(bytes(pending))
            if not self._stop_requested.is_set():
                exit_code = process.poll()
                detail = self.stderr_tail.strip()
                suffix = f": {detail}" if detail else ""
                self._set_error(
                    DeviceAudioCaptureError(
                        f"arecord ended unexpectedly (exit={exit_code}){suffix}"
                    )
                )
        except (OSError, ValueError) as error:
            if not self._stop_requested.is_set():
                self._set_error(DeviceAudioCaptureError(f"arecord PCM read failed: {error}"))
        finally:
            with self._lock:
                if self._source_started_monotonic_ms is None:
                    self._source_stopped_monotonic_ms = self._monotonic() * 1_000
                else:
                    self._source_stopped_monotonic_ms = (
                        self._source_started_monotonic_ms
                        + self._captured_frame_count
                        / self.profile.sample_rate_hz
                        * 1_000
                    )
            self._done.set()

    def _enqueue_pcm(self, pcm_bytes: bytes) -> None:
        if not pcm_bytes:
            return
        if len(pcm_bytes) % self.profile.bytes_per_frame != 0:
            self._set_error(
                DeviceAudioCaptureError("arecord ended on a partial PCM frame")
            )
            return
        frame_count = len(pcm_bytes) // self.profile.bytes_per_frame
        captured_at_ms = self._monotonic() * 1_000
        with self._lock:
            if self._source_started_monotonic_ms is None:
                duration_ms = frame_count / self.profile.sample_rate_hz * 1_000
                self._source_started_monotonic_ms = max(0.0, captured_at_ms - duration_ms)
            self._captured_frame_count += frame_count
            # arecord's stdout does not expose ALSA hardware timestamps. Anchor
            # the source clock once to CLOCK_MONOTONIC, then advance it by exact
            # source frames. Queue drops therefore create a visible timestamp
            # jump plus cumulative loss evidence instead of scheduler jitter.
            source_monotonic_ms = (
                self._source_started_monotonic_ms
                + self._captured_frame_count
                / self.profile.sample_rate_hz
                * 1_000
            )
        block = CapturedPcmBlock(
            pcm_bytes=pcm_bytes,
            frame_count=frame_count,
            source_monotonic_ms=source_monotonic_ms,
        )
        try:
            self._queue.put_nowait(block)
            self._first_block.set()
        except queue.Full:
            with self._lock:
                self._capture_gap_count += 1
                self._dropped_frame_count += frame_count
                self._dropped_byte_count += len(pcm_bytes)
                self._overflow_count += 1

    def _read_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        try:
            while True:
                line = process.stderr.readline()
                if not line:
                    if (
                        not self._stop_requested.is_set()
                        and process.poll() is None
                    ):
                        self._mark_stderr_monitor_failure(
                            "arecord stderr monitor ended unexpectedly"
                        )
                    break
                xrun_count = len(XRUN_PATTERN.findall(line))
                with self._lock:
                    self._stderr_tail.extend(line)
                    if len(self._stderr_tail) > 4_096:
                        del self._stderr_tail[:-4_096]
                    # arecord does not expose lost frame counts on stdout.  A
                    # visible gap count makes coverage incomplete without
                    # inventing a duration that ALSA did not report.
                    self._capture_gap_count += xrun_count
        except (OSError, ValueError) as error:
            if self._stop_requested.is_set():
                return
            self._mark_stderr_monitor_failure(
                f"arecord stderr monitor failed: {error}"
            )

    def _mark_stderr_monitor_failure(self, message: str) -> None:
        with self._lock:
            # Once stderr is unreadable, xrun coverage is unknowable. Fail
            # closed rather than allowing a receipt to claim complete audio.
            self._capture_gap_count += 1
            if self._error is None:
                self._error = DeviceAudioCaptureError(message)

    def _set_error(self, error: DeviceAudioCaptureError) -> None:
        with self._lock:
            if self._error is None:
                self._error = error

    def _terminate_process(self, process: CaptureProcess, deadline: float) -> None:
        if process.poll() is not None:
            return
        actions = (
            lambda: process.send_signal(signal.SIGINT),
            process.terminate,
            process.kill,
        )
        for index, action in enumerate(actions):
            try:
                action()
            except (OSError, ProcessLookupError):
                pass
            stages_remaining = len(actions) - index
            if self._wait_process(process, deadline, stages_remaining):
                return
        self._set_error(DeviceAudioCaptureError("arecord did not exit after SIGKILL"))

    def _wait_process(
        self,
        process: CaptureProcess,
        deadline: float,
        stages_remaining: int,
    ) -> bool:
        remaining = max(0.0, deadline - self._monotonic())
        if remaining <= 0:
            return process.poll() is not None
        stage_timeout = remaining / max(1, stages_remaining)
        try:
            process.wait(timeout=stage_timeout)
            return True
        except (subprocess.TimeoutExpired, TimeoutError):
            return False

    def _join_capture_threads(self, deadline: float) -> None:
        for thread in (self._reader_thread, self._stderr_thread):
            if thread is None:
                continue
            remaining = max(0.0, deadline - self._monotonic())
            thread.join(remaining)
            if thread.is_alive():
                self._set_error(
                    DeviceAudioCaptureError(f"{thread.name} did not stop within its deadline")
                )


class OrderedPcmCaptureTurn:
    """Publish one arecord turn through the canonical ordered-PCM contract."""

    def __init__(
        self,
        *,
        capture: ArecordPcmCapture,
        transport: OrderedPcmTransport,
        identity: OrderedPcmIdentity,
        ack_timeout_seconds: float = DEFAULT_CONTROL_ACK_TIMEOUT_SECONDS,
        finalization_timeout_seconds: float = DEFAULT_FINALIZATION_TIMEOUT_SECONDS,
        process_stop_timeout_seconds: float = DEFAULT_PROCESS_STOP_TIMEOUT_SECONDS,
    ) -> None:
        if identity.audio_profile_hash != capture.profile.sha256():
            raise DeviceAudioConfigurationError(
                "capture profile does not match the ordered-PCM identity hash"
            )
        if any(
            not math.isfinite(value) or value <= 0
            for value in (
                ack_timeout_seconds,
                finalization_timeout_seconds,
                process_stop_timeout_seconds,
            )
        ):
            raise DeviceAudioConfigurationError("turn timeouts must be finite and positive")
        self.capture = capture
        self.transport = transport
        self.identity = identity
        self.ack_timeout_seconds = ack_timeout_seconds
        self.finalization_timeout_seconds = finalization_timeout_seconds
        self.process_stop_timeout_seconds = process_stop_timeout_seconds
        self._lock = threading.Lock()
        self._started = False
        self._stop_requested = False
        self._failure: DeviceAudioError | None = None
        self._publisher_thread: threading.Thread | None = None
        self._final_sequence = 0
        self._emitted_frame_count = 0
        self._emitted_byte_count = 0
        self._source_hash = hashlib.sha256()

    @property
    def failure(self) -> DeviceAudioError | None:
        with self._lock:
            return self._failure

    def start(self) -> None:
        with self._lock:
            if self._started:
                raise DeviceAudioCaptureError("ordered PCM turn is already started")
        try:
            self.capture.start()
            start_message: dict[str, Any] = {
                "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
                "type": "audio.start",
                **self.identity.protocol_value(),
                "sourceMonotonicMs": self.capture.source_started_monotonic_ms,
                "pcmProfile": self.capture.profile.protocol_value(),
            }
            response = self.transport.exchange(
                encode_jpcm_envelope(start_message),
                self.ack_timeout_seconds,
            )
            self._validate_ack(response, "audio.start", 0, "spooled")
        except DeviceAudioError:
            self.capture.abort()
            self.transport.close()
            raise
        except Exception as error:
            self.capture.abort()
            self.transport.close()
            raise DeviceAudioTransportError(
                f"could not start ordered PCM transport: {error}"
            ) from error

        with self._lock:
            self._started = True
        self._publisher_thread = threading.Thread(
            target=self._publish_pcm,
            name="jiko-ordered-pcm-publisher",
            daemon=True,
        )
        self._publisher_thread.start()

    def stop(
        self,
        timeout_seconds: float = DEFAULT_TURN_STOP_TIMEOUT_SECONDS,
    ) -> Mapping[str, Any]:
        if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
            raise DeviceAudioConfigurationError(
                "turn stop timeout must be finite and positive"
            )
        with self._lock:
            if not self._started:
                raise DeviceAudioCaptureError("ordered PCM turn has not started")
            if self._stop_requested:
                raise DeviceAudioCaptureError("ordered PCM turn stop was already requested")
            self._stop_requested = True

        deadline = time.monotonic() + timeout_seconds
        try:
            self.capture.stop(
                self.process_stop_timeout_seconds,
                deadline_monotonic=deadline,
            )
        except DeviceAudioError as error:
            self._record_failure(error)
        publisher = self._publisher_thread
        if publisher is not None:
            publisher.join(max(0.0, deadline - time.monotonic()))
            if publisher.is_alive():
                self._record_failure(
                    DeviceAudioTransportError("PCM publisher did not drain before stop deadline")
                )
                self.transport.close()
                self.capture.abort(deadline_monotonic=deadline)
                publisher.join(max(0.0, deadline - time.monotonic()))

        failure = self.failure
        if failure is not None:
            self.transport.close()
            raise failure

        loss_evidence = self.capture.loss_evidence()
        stop_message: dict[str, Any] = {
            "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
            "type": "audio.stop",
            **self.identity.protocol_value(),
            "sourceMonotonicMs": self.capture.source_stopped_monotonic_ms,
            "finalSequence": self._final_sequence,
            "emittedFrameCount": self._emitted_frame_count,
            "emittedByteCount": self._emitted_byte_count,
            "lossEvidence": loss_evidence.protocol_value(),
            "sourcePcmSha256": self._source_hash.hexdigest(),
        }
        try:
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                raise DeviceAudioTransportError(
                    "ordered PCM turn stop deadline expired before finalization"
                )
            response = self.transport.exchange(
                encode_jpcm_envelope(stop_message),
                min(self.finalization_timeout_seconds, remaining_seconds),
            )
            self._validate_ack(
                response,
                "audio.stop",
                self._final_sequence,
                "finalized",
                require_receipt=True,
            )
            if not loss_evidence.complete:
                raise DeviceAudioCaptureError(
                    "server finalized a turn that carries explicit PCM loss evidence"
                )
            return response
        finally:
            self.transport.close()

    def abort(self) -> None:
        try:
            self.capture.abort()
        finally:
            self.transport.close()

    def _publish_pcm(self) -> None:
        try:
            while True:
                block = self.capture.read_block(0.05)
                if block is None:
                    break
                sequence = self._final_sequence + 1
                chunk_message: dict[str, Any] = {
                    "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
                    "type": "audio.chunk",
                    **self.identity.protocol_value(),
                    "sequence": sequence,
                    "sourceMonotonicMs": block.source_monotonic_ms,
                    "frameCount": block.frame_count,
                    "byteCount": len(block.pcm_bytes),
                    "lossEvidence": self.capture.loss_evidence().protocol_value(),
                }
                response = self.transport.exchange(
                    encode_jpcm_envelope(chunk_message, block.pcm_bytes),
                    self.ack_timeout_seconds,
                )
                self._validate_ack(response, "audio.chunk", sequence, "spooled")
                self._source_hash.update(block.pcm_bytes)
                self._final_sequence = sequence
                self._emitted_frame_count += block.frame_count
                self._emitted_byte_count += len(block.pcm_bytes)
            error = self.capture.error
            if error is not None:
                raise error
        except DeviceAudioError as error:
            self._record_failure(error)
            self.capture.abort()
        except Exception as error:
            self._record_failure(
                DeviceAudioTransportError(f"ordered PCM publisher failed: {error}")
            )
            self.capture.abort()

    def _record_failure(self, error: DeviceAudioError) -> None:
        with self._lock:
            if self._failure is None:
                self._failure = error

    def _validate_ack(
        self,
        response: Mapping[str, Any],
        acknowledged_type: str,
        acknowledged_sequence: int,
        commit_state: str,
        *,
        require_receipt: bool = False,
    ) -> None:
        if response.get("protocolVersion") != ORDERED_PCM_PROTOCOL_VERSION:
            raise DeviceAudioTransportError("server returned an unsupported protocol version")
        if response.get("type") == "audio.error":
            code = response.get("code")
            message = response.get("message")
            recoverable = response.get("recoverable")
            if not isinstance(code, str) or not isinstance(message, str) or not isinstance(recoverable, bool):
                raise DeviceAudioTransportError("server returned a malformed audio.error")
            raise DeviceAudioServerError(code, message, recoverable)
        if response.get("type") != "audio.ack":
            raise DeviceAudioTransportError("server response was not audio.ack or audio.error")
        for field, expected in self.identity.protocol_value().items():
            if response.get(field) != expected:
                raise DeviceAudioTransportError(f"server ACK {field} does not match this turn")
        if (
            response.get("acknowledgedType") != acknowledged_type
            or response.get("acknowledgedSequence") != acknowledged_sequence
            or response.get("commitState") != commit_state
        ):
            raise DeviceAudioTransportError("server ACK does not match the sent JPCM message")
        if require_receipt:
            receipt = response.get("receipt")
            if not isinstance(receipt, dict):
                raise DeviceAudioTransportError("final audio.stop ACK omitted its receipt")
            for field, expected in self.identity.protocol_value().items():
                if receipt.get(field) != expected:
                    raise DeviceAudioTransportError(
                        f"final receipt {field} does not match this turn"
                    )
            if receipt.get("finalSequence") != acknowledged_sequence:
                raise DeviceAudioTransportError("final receipt sequence does not match its ACK")
            loss_evidence = self.capture.loss_evidence()
            expected_receipt_fields: dict[str, Any] = {
                "schemaVersion": ORDERED_PCM_RECEIPT_VERSION,
                "protocolVersion": ORDERED_PCM_PROTOCOL_VERSION,
                "pcmProfile": self.capture.profile.protocol_value(),
                "sourceStartedMonotonicMs": self.capture.source_started_monotonic_ms,
                "sourceStoppedMonotonicMs": self.capture.source_stopped_monotonic_ms,
                "receivedChunkCount": self._final_sequence,
                "receivedFrameCount": self._emitted_frame_count,
                "receivedByteCount": self._emitted_byte_count,
                "emittedFrameCount": self._emitted_frame_count,
                "emittedByteCount": self._emitted_byte_count,
                "sequenceGapCount": 0,
                "missingChunkCount": 0,
                "lossEvidence": loss_evidence.protocol_value(),
                "coverageComplete": loss_evidence.complete,
                "sourcePcmSha256": self._source_hash.hexdigest(),
            }
            for field, expected in expected_receipt_fields.items():
                if receipt.get(field) != expected:
                    raise DeviceAudioTransportError(
                        f"final receipt {field} does not match the transmitted turn"
                    )


class Rfc6455OrderedPcmTransport:
    """Minimal dependency-free RFC 6455 client for the local JPCM endpoint."""

    def __init__(self, connection: socket.socket, receive_buffer: bytes = b"") -> None:
        self._connection = connection
        self._receive_buffer = bytearray(receive_buffer)
        self._exchange_lock = threading.Lock()
        self._close_lock = threading.Lock()
        self._closed = False

    @classmethod
    def connect(
        cls,
        url: str,
        *,
        origin: str,
        timeout_seconds: float,
    ) -> "Rfc6455OrderedPcmTransport":
        if timeout_seconds <= 0:
            raise DeviceAudioConfigurationError("WebSocket connect timeout must be positive")
        if not origin or any(character in origin for character in "\r\n\0"):
            raise DeviceAudioConfigurationError("WebSocket Origin is empty or unsafe")
        parsed = urlsplit(url)
        if parsed.scheme not in {"ws", "wss"} or not parsed.hostname:
            raise DeviceAudioConfigurationError("ordered PCM URL must be ws:// or wss://")
        if parsed.username or parsed.password or parsed.fragment:
            raise DeviceAudioConfigurationError("ordered PCM URL must not contain credentials or a fragment")
        try:
            port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        except ValueError as error:
            raise DeviceAudioConfigurationError("ordered PCM URL port is invalid") from error
        try:
            raw_connection = socket.create_connection(
                (parsed.hostname, port), timeout=timeout_seconds
            )
        except OSError as error:
            raise DeviceAudioTransportError(
                f"could not connect ordered PCM WebSocket: {error}"
            ) from error
        connection: socket.socket = raw_connection
        if parsed.scheme == "wss":
            try:
                connection = ssl.create_default_context().wrap_socket(
                    raw_connection, server_hostname=parsed.hostname
                )
            except (OSError, ssl.SSLError) as error:
                raw_connection.close()
                raise DeviceAudioTransportError(
                    f"could not establish ordered PCM TLS: {error}"
                ) from error
        connection.settimeout(timeout_seconds)
        websocket_key = base64.b64encode(os.urandom(16)).decode("ascii")
        host = parsed.hostname
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        default_port = 443 if parsed.scheme == "wss" else 80
        host_header = host if port == default_port else f"{host}:{port}"
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        try:
            request = (
                f"GET {target} HTTP/1.1\r\n"
                f"Host: {host_header}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {websocket_key}\r\n"
                "Sec-WebSocket-Version: 13\r\n"
                f"Sec-WebSocket-Protocol: {ORDERED_PCM_WS_SUBPROTOCOL}\r\n"
                f"Origin: {origin}\r\n"
                "\r\n"
            ).encode("ascii")
            connection.sendall(request)
            header_bytes, remainder = cls._read_handshake(connection)
            cls._validate_handshake(header_bytes, websocket_key)
            return cls(connection, remainder)
        except DeviceAudioError:
            connection.close()
            raise
        except (OSError, UnicodeEncodeError) as error:
            connection.close()
            raise DeviceAudioTransportError(
                f"ordered PCM WebSocket handshake failed: {error}"
            ) from error

    def exchange(self, envelope: bytes, timeout_seconds: float) -> Mapping[str, Any]:
        if timeout_seconds <= 0:
            raise DeviceAudioConfigurationError("WebSocket exchange timeout must be positive")
        with self._exchange_lock:
            with self._close_lock:
                if self._closed:
                    raise DeviceAudioTransportError("ordered PCM WebSocket is closed")
            self._connection.settimeout(timeout_seconds)
            try:
                self._send_frame(0x2, envelope)
                message = self._receive_text_message()
                parsed = json.loads(message)
            except (OSError, TimeoutError, json.JSONDecodeError) as error:
                raise DeviceAudioTransportError(
                    f"ordered PCM WebSocket exchange failed: {error}"
                ) from error
            if not isinstance(parsed, dict):
                raise DeviceAudioTransportError("ordered PCM server response was not an object")
            return parsed

    def close(self) -> None:
        with self._close_lock:
            if self._closed:
                return
            self._closed = True

        # Do not wait behind a blocked ACK read. Socket shutdown is the
        # cancellation mechanism that wakes the publisher within its deadline.
        acquired_exchange = self._exchange_lock.acquire(blocking=False)
        if acquired_exchange:
            try:
                self._connection.settimeout(0.25)
                self._send_frame(0x8, struct.pack(">H", 1000))
            except OSError:
                pass
            finally:
                self._exchange_lock.release()
        try:
            self._connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._connection.close()

    @staticmethod
    def _read_handshake(connection: socket.socket) -> tuple[bytes, bytes]:
        response = bytearray()
        while b"\r\n\r\n" not in response:
            block = connection.recv(4_096)
            if not block:
                raise DeviceAudioTransportError("WebSocket closed during handshake")
            response.extend(block)
            if len(response) > MAX_HANDSHAKE_BYTES:
                raise DeviceAudioTransportError("WebSocket handshake exceeded its bound")
        header_end = response.index(b"\r\n\r\n") + 4
        return bytes(response[:header_end]), bytes(response[header_end:])

    @staticmethod
    def _validate_handshake(header_bytes: bytes, websocket_key: str) -> None:
        try:
            lines = header_bytes.decode("iso-8859-1").split("\r\n")
        except UnicodeDecodeError as error:
            raise DeviceAudioTransportError("WebSocket handshake was not HTTP text") from error
        if not lines or " 101 " not in lines[0]:
            raise DeviceAudioTransportError(
                f"WebSocket upgrade was rejected: {lines[0] if lines else 'empty response'}"
            )
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if not line or ":" not in line:
                continue
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
        expected_accept = base64.b64encode(
            hashlib.sha1(
                (websocket_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
            ).digest()
        ).decode("ascii")
        if headers.get("sec-websocket-accept") != expected_accept:
            raise DeviceAudioTransportError("WebSocket accept hash did not match")
        if headers.get("upgrade", "").lower() != "websocket":
            raise DeviceAudioTransportError("server did not confirm the WebSocket upgrade")
        connection_tokens = {
            token.strip().lower()
            for token in headers.get("connection", "").split(",")
        }
        if "upgrade" not in connection_tokens:
            raise DeviceAudioTransportError("server did not confirm Connection: Upgrade")
        if headers.get("sec-websocket-protocol") != ORDERED_PCM_WS_SUBPROTOCOL:
            raise DeviceAudioTransportError("server did not select the ordered PCM subprotocol")

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        first_byte = 0x80 | opcode
        length = len(payload)
        if length < 126:
            header = bytes((first_byte, 0x80 | length))
        elif length <= 0xFFFF:
            header = bytes((first_byte, 0x80 | 126)) + struct.pack(">H", length)
        else:
            header = bytes((first_byte, 0x80 | 127)) + struct.pack(">Q", length)
        mask = os.urandom(4)
        masked_payload = bytearray(payload)
        for index in range(length):
            masked_payload[index] ^= mask[index & 3]
        self._connection.sendall(header + mask + masked_payload)

    def _receive_text_message(self) -> str:
        fragments = bytearray()
        started = False
        while True:
            final, opcode, payload = self._receive_frame()
            if opcode == 0x8:
                raise DeviceAudioTransportError("server closed the WebSocket before its ACK")
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode == 0x1 and not started:
                started = True
            elif opcode != 0x0 or not started:
                raise DeviceAudioTransportError("server returned a non-text WebSocket message")
            fragments.extend(payload)
            if len(fragments) > MAX_SERVER_MESSAGE_BYTES:
                raise DeviceAudioTransportError("server WebSocket response exceeded its bound")
            if final:
                try:
                    return fragments.decode("utf-8")
                except UnicodeDecodeError as error:
                    raise DeviceAudioTransportError(
                        "server WebSocket response was not UTF-8"
                    ) from error

    def _receive_frame(self) -> tuple[bool, int, bytes]:
        header = self._read_exact(2)
        final = bool(header[0] & 0x80)
        opcode = header[0] & 0x0F
        masked = bool(header[1] & 0x80)
        length = header[1] & 0x7F
        if masked:
            raise DeviceAudioTransportError("server WebSocket frames must not be masked")
        if length == 126:
            length = struct.unpack(">H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._read_exact(8))[0]
        if length > MAX_SERVER_MESSAGE_BYTES:
            raise DeviceAudioTransportError("server WebSocket frame exceeded its bound")
        return final, opcode, self._read_exact(length)

    def _read_exact(self, length: int) -> bytes:
        while len(self._receive_buffer) < length:
            block = self._connection.recv(max(4_096, length - len(self._receive_buffer)))
            if not block:
                raise DeviceAudioTransportError("WebSocket closed during a message")
            self._receive_buffer.extend(block)
        value = bytes(self._receive_buffer[:length])
        del self._receive_buffer[:length]
        return value


def register_device_session(
    server_url: str,
    session_id: str,
    profile: PcmProfile | None = None,
    timeout_seconds: float = 5.0,
) -> OrderedPcmIdentity:
    if not IDENTIFIER_PATTERN.fullmatch(session_id):
        raise DeviceAudioConfigurationError("session id is not protocol-safe")
    _validate_server_url(server_url)
    body = json.dumps(
        {"sessionId": session_id, "source": "device"}, separators=(",", ":")
    ).encode("utf-8")
    request = Request(
        f"{server_url.rstrip('/')}/sessions",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            value = _read_bounded_json_response(response, "session registration")
    except HTTPError as error:
        try:
            detail = _read_bounded_http_body(
                error,
                "session registration error",
            ).decode("utf-8", errors="replace")[:512]
        finally:
            error.close()
        raise DeviceAudioTransportError(
            f"session registration failed with HTTP {error.code}: {detail}"
        ) from error
    except (URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeviceAudioTransportError(f"session registration failed: {error}") from error
    session = value.get("session") if isinstance(value, dict) else None
    if not isinstance(session, dict):
        raise DeviceAudioTransportError("session registration omitted session")
    if (
        session.get("id") != session_id
        or session.get("source") != "device"
        or session.get("status") != "created"
        or not isinstance(session.get("attemptId"), str)
    ):
        raise DeviceAudioTransportError(
            "registered session identity/source/status is unsafe for new audio"
        )
    resolved_profile = profile or PcmProfile()
    return OrderedPcmIdentity(
        session_id=session_id,
        attempt_id=session["attemptId"],
        source_id=f"pi-alsa-{uuid.uuid4().hex}",
        audio_profile_hash=resolved_profile.sha256(),
    )


def ordered_pcm_websocket_url(server_url: str, session_id: str) -> str:
    _validate_server_url(server_url)
    parsed = urlsplit(server_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    base_path = parsed.path.rstrip("/")
    path = f"{base_path}/sessions/{quote(session_id, safe='')}/audio-stream"
    return urlunsplit((scheme, parsed.netloc, path, "", ""))


def _validate_server_url(server_url: str) -> None:
    try:
        parsed = urlsplit(server_url)
        _port = parsed.port
    except ValueError as error:
        raise DeviceAudioConfigurationError("server URL has an invalid port") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise DeviceAudioConfigurationError("server URL must be http:// or https://")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise DeviceAudioConfigurationError(
            "server URL must not contain credentials, a query, or a fragment"
        )


def _read_bounded_http_body(response: Any, context: str) -> bytes:
    try:
        body = response.read(MAX_HTTP_RESPONSE_BYTES + 1)
    except (OSError, ValueError) as error:
        raise DeviceAudioTransportError(f"{context} response read failed: {error}") from error
    if len(body) > MAX_HTTP_RESPONSE_BYTES:
        raise DeviceAudioResponseTooLargeError(
            f"{context} response exceeded {MAX_HTTP_RESPONSE_BYTES} bytes"
        )
    return body


def _read_bounded_json_response(response: Any, context: str) -> Any:
    return json.loads(_read_bounded_http_body(response, context).decode("utf-8"))


def post_device_terminal_error(
    server_url: str,
    session_id: str,
    *,
    code: str,
    message: str,
    timeout_seconds: float,
    monotonic_ms: int | None = None,
    attempts: int = TERMINAL_ERROR_ATTEMPTS,
) -> str:
    """Seal a confirmed pre-start session through the canonical event route.

    The exact JSON body is reused across retries. If the first response is lost
    after commit, the server's event replay contract makes the retry idempotent.
    A 409 means another input owner already claimed the attempt, so its own
    canonical lifecycle is responsible for the terminal transition.
    """

    _validate_server_url(server_url)
    if not IDENTIFIER_PATTERN.fullmatch(session_id):
        raise DeviceAudioConfigurationError("session id is not protocol-safe")
    if not code or not message:
        raise DeviceAudioConfigurationError("terminal device error requires code and message")
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise DeviceAudioConfigurationError(
            "terminal error timeout must be finite and positive"
        )
    if not isinstance(attempts, int) or attempts < 1:
        raise DeviceAudioConfigurationError("terminal error attempts must be positive")
    event_monotonic_ms = (
        round(time.monotonic() * 1_000)
        if monotonic_ms is None
        else monotonic_ms
    )
    if not isinstance(event_monotonic_ms, int) or event_monotonic_ms < 0:
        raise DeviceAudioConfigurationError(
            "terminal error monotonic timestamp must be a non-negative integer"
        )

    body = json.dumps(
        {
            "type": "session.error",
            "source": "device",
            "monotonicMs": event_monotonic_ms,
            "message": message,
            "code": code,
            "recoverable": True,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    target = (
        f"{server_url.rstrip('/')}/sessions/"
        f"{quote(session_id, safe='')}/input-event"
    )
    last_error: DeviceAudioTransportError | None = None
    for _attempt in range(attempts):
        request = Request(
            target,
            data=body,
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                value = _read_bounded_json_response(
                    response,
                    "device terminal error",
                )
        except HTTPError as error:
            try:
                error_body = _read_bounded_http_body(
                    error,
                    "device terminal error",
                )
            finally:
                error.close()
            detail = error_body.decode("utf-8", errors="replace")[:512]
            if error.code == 409:
                try:
                    conflict = json.loads(error_body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    conflict = None
                conflict_session = (
                    conflict.get("session")
                    if isinstance(conflict, dict)
                    else None
                )
                conflict_status = (
                    conflict_session.get("status")
                    if isinstance(conflict_session, dict)
                    else conflict.get("status")
                    if isinstance(conflict, dict)
                    else None
                )
                if conflict_status == "error":
                    return "sealed_by_audio_transport"
                last_error = DeviceAudioTransportError(
                    "device terminal error conflicted before terminal state "
                    f"was confirmed: {detail}"
                )
                continue
            last_error = DeviceAudioTransportError(
                f"device terminal error failed with HTTP {error.code}: {detail}"
            )
            continue
        except (URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError) as error:
            last_error = DeviceAudioTransportError(
                f"device terminal error delivery failed: {error}"
            )
            continue

        session = value.get("session") if isinstance(value, dict) else None
        event = value.get("event") if isinstance(value, dict) else None
        if (
            not isinstance(session, dict)
            or session.get("id") != session_id
            or session.get("status") != "error"
            or not isinstance(event, dict)
            or event.get("type") != "session.error"
            or event.get("source") != "device"
            or event.get("monotonicMs") != event_monotonic_ms
            or event.get("message") != message
            or event.get("code") != code
            or event.get("recoverable") is not True
        ):
            last_error = DeviceAudioTransportError(
                "device terminal error response did not confirm the exact event"
            )
            continue
        return "sealed"

    if last_error is None:
        raise DeviceAudioTransportError("device terminal error delivery did not run")
    raise last_error


def run_timed_capture(args: argparse.Namespace) -> Mapping[str, Any]:
    profile = PcmProfile(sample_rate_hz=args.sample_rate_hz)
    capture = ArecordPcmCapture(
        alsa_device=args.alsa_device,
        profile=profile,
        chunk_duration_ms=args.chunk_duration_ms,
        queue_chunks=args.queue_chunks,
        first_chunk_timeout_seconds=args.first_chunk_timeout_seconds,
    )
    identity = register_device_session(
        args.server_url,
        args.session_id,
        profile,
        timeout_seconds=args.connect_timeout_seconds,
    )
    stop_requested = threading.Event()
    transport: Rfc6455OrderedPcmTransport | None = None
    turn: OrderedPcmCaptureTurn | None = None
    start_acknowledged = False
    previous_sigint: Any = None
    previous_sigterm: Any = None
    sigint_handler_installed = False
    sigterm_handler_installed = False

    def request_stop(_signal_number: int, _frame: Any) -> None:
        stop_requested.set()

    try:
        transport = Rfc6455OrderedPcmTransport.connect(
            ordered_pcm_websocket_url(args.server_url, identity.session_id),
            origin=args.origin,
            timeout_seconds=args.connect_timeout_seconds,
        )
        turn = OrderedPcmCaptureTurn(
            capture=capture,
            transport=transport,
            identity=identity,
            ack_timeout_seconds=args.ack_timeout_seconds,
            finalization_timeout_seconds=args.finalization_timeout_seconds,
            process_stop_timeout_seconds=args.process_stop_timeout_seconds,
        )
        previous_sigint = signal.signal(signal.SIGINT, request_stop)
        sigint_handler_installed = True
        previous_sigterm = signal.signal(signal.SIGTERM, request_stop)
        sigterm_handler_installed = True
        turn.start()
        start_acknowledged = True
        started = time.monotonic()
        while not stop_requested.wait(0.05):
            if turn.failure is not None:
                raise turn.failure
            if args.duration_seconds is not None:
                if time.monotonic() - started >= args.duration_seconds:
                    break
        return turn.stop(timeout_seconds=args.stop_timeout_seconds)
    except BaseException as error:
        cleanup_error: BaseException | None = None
        try:
            if turn is not None:
                turn.abort()
            elif transport is not None:
                transport.close()
        except BaseException as caught_cleanup_error:
            cleanup_error = caught_cleanup_error
        if not start_acknowledged:
            try:
                post_device_terminal_error(
                    args.server_url,
                    identity.session_id,
                    code="device_audio_start_failed",
                    message="Device audio capture could not start",
                    timeout_seconds=args.connect_timeout_seconds,
                )
            except BaseException as terminal_error:
                cleanup_suffix = (
                    f"; local cleanup also failed: {cleanup_error}"
                    if cleanup_error is not None
                    else ""
                )
                raise DeviceAudioTransportError(
                    f"{error}; pre-start session sealing was not confirmed: "
                    f"{terminal_error}{cleanup_suffix}"
                ) from error
        if cleanup_error is not None:
            raise DeviceAudioTransportError(
                f"{error}; local audio cleanup also failed: {cleanup_error}"
            ) from error
        raise
    finally:
        if sigterm_handler_installed:
            signal.signal(signal.SIGTERM, previous_sigterm)
        if sigint_handler_installed:
            signal.signal(signal.SIGINT, previous_sigint)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stream Raspberry Pi ALSA PCM through jiko ordered_pcm_v1"
    )
    parser.add_argument("--server-url", default=DEFAULT_SERVER_URL)
    parser.add_argument("--origin", default=DEFAULT_ORIGIN)
    parser.add_argument(
        "--session-id", default=f"device-audio-{uuid.uuid4().hex}"
    )
    parser.add_argument("--alsa-device", default=DEFAULT_ALSA_DEVICE)
    parser.add_argument(
        "--sample-rate-hz", type=int, default=DEFAULT_SAMPLE_RATE_HZ
    )
    parser.add_argument(
        "--chunk-duration-ms", type=int, default=DEFAULT_CHUNK_DURATION_MS
    )
    parser.add_argument("--queue-chunks", type=int, default=DEFAULT_QUEUE_CHUNKS)
    parser.add_argument("--duration-seconds", type=float)
    parser.add_argument(
        "--first-chunk-timeout-seconds",
        type=float,
        default=DEFAULT_FIRST_CHUNK_TIMEOUT_SECONDS,
    )
    parser.add_argument(
        "--connect-timeout-seconds", type=float, default=3.0
    )
    parser.add_argument(
        "--ack-timeout-seconds",
        type=float,
        default=DEFAULT_CONTROL_ACK_TIMEOUT_SECONDS,
    )
    parser.add_argument(
        "--finalization-timeout-seconds",
        type=float,
        default=DEFAULT_FINALIZATION_TIMEOUT_SECONDS,
    )
    parser.add_argument(
        "--process-stop-timeout-seconds",
        type=float,
        default=DEFAULT_PROCESS_STOP_TIMEOUT_SECONDS,
    )
    parser.add_argument(
        "--stop-timeout-seconds",
        type=float,
        default=DEFAULT_TURN_STOP_TIMEOUT_SECONDS,
    )
    args = parser.parse_args(argv)
    for name in (
        "duration_seconds",
        "first_chunk_timeout_seconds",
        "connect_timeout_seconds",
        "ack_timeout_seconds",
        "finalization_timeout_seconds",
        "process_stop_timeout_seconds",
        "stop_timeout_seconds",
    ):
        value = getattr(args, name)
        if value is not None and (not math.isfinite(value) or value <= 0):
            parser.error(
                f"--{name.replace('_', '-')} must be finite and positive"
            )
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        acknowledgement = run_timed_capture(args)
    except DeviceAudioError as error:
        print(f"Device audio adapter failed: {error}", file=sys.stderr)
        return 1
    receipt = acknowledgement.get("receipt")
    summary = {
        "status": "finalized",
        "sessionId": args.session_id,
        "finalSequence": receipt.get("finalSequence") if isinstance(receipt, dict) else None,
        "receivedByteCount": receipt.get("receivedByteCount") if isinstance(receipt, dict) else None,
        "coverageComplete": receipt.get("coverageComplete") if isinstance(receipt, dict) else None,
    }
    print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
