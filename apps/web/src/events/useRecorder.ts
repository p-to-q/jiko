import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BrowserSessionRegistration,
  createBrowserSession,
  fetchBrowserSessionState,
  postRecordingStarted,
  postRecordingStopped,
  postSessionError,
  resolveApiBaseUrl,
  toErrorMessage,
  uploadSessionAudio,
} from "../api/server";
import {
  canUseOrderedPcmCapture,
  startOrderedPcmCapture,
  type OrderedPcmBrowserCapture,
} from "../audio/orderedPcmCapture";

const BACKEND_TIMEOUT_MS = 6_000;
const MICROPHONE_TIMEOUT_MS = 15_000;
const ANALYSIS_TIMEOUT_MS = 90_000;
const PREFERRED_AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
] as const;

export type RecordingStatus =
  | "idle"
  | "connecting"
  | "authorizing"
  | "recording"
  | "stopping"
  | "uploading"
  | "error";

export type RecordingControlState = {
  status: RecordingStatus;
  error?: string;
  errorCategory?: "unsupported" | "unconfirmed";
  lastDurationMs?: number;
};

export type RecorderControls = {
  sessionId?: string;
  pendingSessionId?: string;
  recording: RecordingControlState;
  ensureSession: () => Promise<string>;
  acquireManualInputLease: () => (() => void) | undefined;
  toggleRecording: () => void;
};

export type RecorderOptions = {
  activeSessionId?: string;
  onSessionCreated?: (sessionId: string) => void;
};

type CaptureBase = {
  token: number;
  controller: AbortController;
  stream: MediaStream;
  startedMonotonicMs: number;
  registration?: Promise<BrowserSessionRegistration>;
  releaseInputLease: () => void;
  failureHandled: boolean;
};

type BatchActiveCapture = CaptureBase & {
  mode: "batch";
  recorder: MediaRecorder;
  chunks: Blob[];
  onDataAvailable: (event: BlobEvent) => void;
  onStop: () => void;
};

type OrderedPcmActiveCapture = CaptureBase & {
  mode: "ordered-pcm";
  pcm: OrderedPcmBrowserCapture;
  requestedSessionId: string;
};

type ActiveCapture = BatchActiveCapture | OrderedPcmActiveCapture;

export function useRecorder(options: RecorderOptions = {}): RecorderControls {
  const { activeSessionId, onSessionCreated } = options;
  const apiBaseUrl = useMemo(resolveApiBaseUrl, []);
  const [recording, setRecording] = useState<RecordingControlState>({
    status: "idle",
  });
  const [localSessionId, setLocalSessionId] = useState<string>();
  const [pendingSessionId, setPendingSessionId] = useState<string>();
  const activeCaptureRef = useRef<ActiveCapture>();
  const pendingCaptureStreamRef = useRef<{
    token: number;
    stream: MediaStream;
  }>();
  const inputLeaseRef = useRef<{ kind: "recording" | "manual"; token: symbol }>();
  const sessionIdRef = useRef<string>();
  const recordingStatusRef = useRef<RecordingStatus>("idle");
  const startAttemptRef = useRef(0);
  const unmountingRef = useRef(false);
  const sessionId = localSessionId ?? activeSessionId;

  const setRecordingStatus = useCallback((next: RecordingControlState) => {
    recordingStatusRef.current = next.status;
    setRecording(next);
  }, []);

  const acquireInputLease = useCallback((kind: "recording" | "manual") => {
    if (inputLeaseRef.current) {
      return undefined;
    }

    const token = Symbol(kind);
    inputLeaseRef.current = { kind, token };
    return () => {
      if (inputLeaseRef.current?.token === token) {
        inputLeaseRef.current = undefined;
      }
    };
  }, []);

  const acquireManualInputLease = useCallback(
    () => acquireInputLease("manual"),
    [acquireInputLease],
  );

  const bindSession = useCallback((createdSessionId: string) => {
    sessionIdRef.current = createdSessionId;
    setLocalSessionId(createdSessionId);
    setPendingSessionId((current) => current === createdSessionId ? undefined : current);
    onSessionCreated?.(createdSessionId);
  }, [onSessionCreated]);

  const requestSession = useCallback(async (
    requestedSessionId?: string,
    parentSignal?: AbortSignal,
  ) => {
    const registration = await withTransportRetry(
      (signal) => createBrowserSession(apiBaseUrl, {
        requestedSessionId,
        signal,
      }),
      BACKEND_TIMEOUT_MS,
      "本地后端连接超时。请确认 localhost:4317 正在运行。",
      parentSignal,
    );

    if (requestedSessionId && registration.sessionId !== requestedSessionId) {
      throw new Error("本地后端返回了不同的会话标识，录音已停止以避免串线。");
    }

    return registration;
  }, [apiBaseUrl]);

  const ensureSession = useCallback(async () => {
    const registration = await requestSession();
    bindSession(registration.sessionId);
    return registration.sessionId;
  }, [bindSession, requestSession]);

  const releaseCaptureDevices = useCallback((capture: ActiveCapture) => {
    if (capture.mode === "batch") {
      capture.recorder.removeEventListener("dataavailable", capture.onDataAvailable);
      capture.recorder.removeEventListener("stop", capture.onStop);
    }
    for (const track of capture.stream.getTracks()) {
      track.stop();
    }
  }, []);

  const disposeCapture = useCallback((capture: ActiveCapture, abortTransport: boolean) => {
    if (abortTransport && !capture.controller.signal.aborted) {
      capture.controller.abort();
    }

    if (capture.mode === "ordered-pcm" && abortTransport) {
      void capture.pcm.abort();
    }

    releaseCaptureDevices(capture);
    if (activeCaptureRef.current === capture) {
      activeCaptureRef.current = undefined;
    }
  }, [releaseCaptureDevices]);

  const finishBatchCapture = useCallback(
    async (
      capture: BatchActiveCapture,
      blob: Blob,
      durationMs: number,
      stoppedMonotonicMs: number,
    ) => {
      setRecordingStatus({ status: "uploading", lastDurationMs: durationMs });

      try {
        const registration = capture.registration;
        if (!registration) {
          throw new Error("录音同步尚未初始化，请重试这一轮。");
        }

        const { sessionId: targetSessionId } = await registration;
        assertActiveCapture(capture, activeCaptureRef.current);
        if (blob.size === 0) {
          await withAbortTimeout(
            (signal) => postSessionError(
              apiBaseUrl,
              targetSessionId,
              {
                message: "The local recorder produced an empty audio payload.",
                code: "empty_recording",
                recoverable: true,
              },
              signal,
            ),
            BACKEND_TIMEOUT_MS,
            "后端没有响应空录音错误事件。请确认 localhost:4317 正在运行。",
            capture.controller.signal,
          );
          assertActiveCapture(capture, activeCaptureRef.current);
          setRecordingStatus({
            status: "error",
            error: "没有录到声音。请检查麦克风输入后重试。",
            lastDurationMs: durationMs,
          });
          return;
        }

        await withTransportRetry(
          (signal) => postRecordingStopped(
            apiBaseUrl,
            targetSessionId,
            durationMs,
            stoppedMonotonicMs,
            signal,
          ),
          BACKEND_TIMEOUT_MS,
          "后端没有响应录音停止事件。请确认 localhost:4317 正在运行。",
          capture.controller.signal,
        );
        assertActiveCapture(capture, activeCaptureRef.current);

        await withAbortTimeout(
          (signal) => uploadSessionAudio(
            apiBaseUrl,
            targetSessionId,
            blob,
            durationMs,
            stoppedMonotonicMs,
            signal,
          ),
          ANALYSIS_TIMEOUT_MS,
          "本地分析超过 90 秒。请检查 FunASR 和 localhost:4317。",
          capture.controller.signal,
        );
        assertActiveCapture(capture, activeCaptureRef.current);
        setRecordingStatus({ status: "idle", lastDurationMs: durationMs });
      } catch (error) {
        if (capture.controller.signal.aborted || unmountingRef.current) {
          return;
        }

        setRecordingStatus({
          status: "error",
          error: `录音上传或分析失败：${toErrorMessage(error)}`,
          lastDurationMs: durationMs,
        });
      } finally {
        capture.releaseInputLease();
        setPendingSessionId(undefined);
        if (activeCaptureRef.current === capture) {
          activeCaptureRef.current = undefined;
        }
      }
    },
    [apiBaseUrl, setRecordingStatus],
  );

  const finishOrderedPcmCapture = useCallback(async (
    capture: OrderedPcmActiveCapture,
  ) => {
    setRecordingStatus({ status: "uploading" });

    try {
      const result = await capture.pcm.stop();
      assertActiveCapture(capture, activeCaptureRef.current);
      setRecordingStatus({
        status: "idle",
        lastDurationMs: result.durationMs,
      });
    } catch (error) {
      if (
        capture.controller.signal.aborted ||
        capture.failureHandled ||
        unmountingRef.current
      ) {
        return;
      }
      let displayedError = error;
      let errorCategory: RecordingControlState["errorCategory"];
      if (capture.registration) {
        try {
          const registration = await capture.registration;
          const snapshot = await withAbortTimeout(
            (signal) => fetchBrowserSessionState(
              apiBaseUrl,
              registration.sessionId,
              signal,
            ),
            BACKEND_TIMEOUT_MS,
            "后端没有响应最终状态核对。",
            capture.controller.signal,
          );
          assertActiveCapture(capture, activeCaptureRef.current);
          if (
            snapshot.sessionId !== registration.sessionId ||
            snapshot.attemptId !== registration.attemptId
          ) {
            throw new Error("最终状态属于不同的录音轮次。请重试。");
          }
          if (
            (snapshot.status === "result" || snapshot.status === "silence") &&
            snapshot.hasResult &&
            snapshot.orderedPcmCoverageComplete
          ) {
            capture.failureHandled = true;
            setRecordingStatus({ status: "idle" });
            return;
          }
          if (
            snapshot.status === "error" ||
            snapshot.status === "reset"
          ) {
            displayedError = new Error(
              snapshot.errorMessage ?? `本轮已终止（${snapshot.status}）。`,
            );
          } else if (
            snapshot.status === "created" ||
            snapshot.status === "recording"
          ) {
            await withAbortTimeout(
              (signal) => postSessionError(
                apiBaseUrl,
                registration.sessionId,
                {
                  message: `Ordered PCM stop failed before server acceptance: ${toErrorMessage(error)}`,
                  code: "ordered_pcm_browser_stop_failed",
                  recoverable: true,
                },
                signal,
              ),
              BACKEND_TIMEOUT_MS,
              "后端没有响应 PCM 停止错误事件。",
              capture.controller.signal,
            );
            displayedError = error;
          } else {
            displayedError = new Error(
              `最终确认丢失，后端仍处于 ${snapshot.status}；本轮状态尚未确认。`,
            );
            errorCategory = "unconfirmed";
          }
        } catch (reconcileError) {
          displayedError = new Error(
            `最终确认丢失，且无法核对后端状态：${toErrorMessage(reconcileError)}`,
          );
        }
      }

      if (
        capture.controller.signal.aborted ||
        unmountingRef.current ||
        activeCaptureRef.current !== capture
      ) {
        return;
      }

      capture.failureHandled = true;
      setRecordingStatus({
        status: "error",
        error: `PCM 传输或分析失败：${toErrorMessage(displayedError)}`,
        ...(errorCategory ? { errorCategory } : {}),
      });
    } finally {
      releaseCaptureDevices(capture);
      capture.releaseInputLease();
      if (!unmountingRef.current) {
        setPendingSessionId(undefined);
      }
      if (activeCaptureRef.current === capture) {
        activeCaptureRef.current = undefined;
      }
    }
  }, [releaseCaptureDevices, setRecordingStatus]);

  const failOrderedPcmCapture = useCallback(async (
    capture: OrderedPcmActiveCapture,
    error: Error,
  ) => {
    if (
      capture.failureHandled ||
      activeCaptureRef.current !== capture ||
      unmountingRef.current
    ) {
      return;
    }

    capture.failureHandled = true;
    capture.controller.abort();
    await capture.pcm.abort(error);
    releaseCaptureDevices(capture);
    capture.releaseInputLease();
    setPendingSessionId(undefined);
    if (activeCaptureRef.current === capture) {
      activeCaptureRef.current = undefined;
    }
    setRecordingStatus({
      status: "error",
      error: `PCM 采集已停止：${toErrorMessage(error)}。本轮未静默切换录音路径。`,
    });

    void (async () => {
      try {
        const registration = await requestSession(capture.requestedSessionId);
        if (
          !unmountingRef.current &&
          startAttemptRef.current === capture.token &&
          !activeCaptureRef.current
        ) {
          bindSession(registration.sessionId);
        }
        await withAbortTimeout(
          (signal) => postSessionError(
            apiBaseUrl,
            registration.sessionId,
            {
              message: `Ordered PCM capture failed before finalization: ${error.message}`,
              code: "ordered_pcm_browser_capture_failed",
              recoverable: true,
            },
            signal,
          ),
          BACKEND_TIMEOUT_MS,
          "后端没有响应 PCM 采集错误事件。",
        );
      } catch {
        // The local error is already visible. A server-side actor may also have
        // sealed the attempt; this best-effort path exists for failures before
        // audio.start was accepted and must not keep the microphone open.
      }
    })();
  }, [apiBaseUrl, bindSession, releaseCaptureDevices, requestSession, setRecordingStatus]);

  const stopRecording = useCallback(() => {
    const capture = activeCaptureRef.current;

    if (!capture) {
      setRecordingStatus({ status: "idle" });
      return;
    }

    if (capture.mode === "ordered-pcm") {
      setRecordingStatus({ status: "stopping" });
      void finishOrderedPcmCapture(capture);
      return;
    }

    const recorder = capture.recorder;

    if (recorder.state === "inactive") {
      return;
    }

    setRecordingStatus({ status: "stopping" });
    try {
      recorder.stop();
    } catch (error) {
      disposeCapture(capture, true);
      capture.releaseInputLease();
      setPendingSessionId(undefined);
      setRecordingStatus({ status: "error", error: recorderErrorMessage(error) });
    }
  }, [disposeCapture, finishOrderedPcmCapture, setRecordingStatus]);

  const startRecording = useCallback(async () => {
    if (activeCaptureRef.current || inputLeaseRef.current) {
      return;
    }

    const captureMode = selectCaptureMode();
    if (!captureMode || !canRecordAudio(captureMode)) {
      setRecordingStatus({
        status: "error",
        error: "当前环境不支持此录音模式。请通过 localhost 或 HTTPS 使用兼容的现代浏览器。",
        errorCategory: "unsupported",
      });
      return;
    }

    const releaseInputLease = acquireInputLease("recording");
    if (!releaseInputLease) {
      return;
    }

    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    let pendingStream: MediaStream | undefined;
    let capture: ActiveCapture | undefined;
    let pendingOrderedPcm: OrderedPcmBrowserCapture | undefined;

    try {
      setRecordingStatus({ status: "authorizing" });
      const stream = await requestMicrophoneWithTimeout(
        attempt,
        startAttemptRef,
        captureMode,
      );
      pendingStream = stream;
      pendingCaptureStreamRef.current = { token: attempt, stream };
      assertActiveAttempt(attempt, startAttemptRef.current);

      const controller = new AbortController();
      const requestedSessionId = createBrowserSessionId();
      setPendingSessionId(requestedSessionId);
      const startedMonotonicMs = performance.now();

      if (captureMode === "ordered-pcm") {
        assertRawCaptureProcessingDisabled(stream);
        let currentCapture: OrderedPcmActiveCapture | undefined;
        let pendingFailure: Error | undefined;
        const pcm = await startOrderedPcmCapture({
          apiBaseUrl,
          sessionId: requestedSessionId,
          stream,
          onFailure(error) {
            if (currentCapture) {
              void failOrderedPcmCapture(currentCapture, error);
            } else {
              pendingFailure = error;
            }
          },
        });
        pendingOrderedPcm = pcm;
        assertActiveAttempt(attempt, startAttemptRef.current);
        if (unmountingRef.current) {
          throw new Error("RECORDING_CANCELLED");
        }
        currentCapture = {
          mode: "ordered-pcm",
          token: attempt,
          controller,
          pcm,
          requestedSessionId,
          stream,
          startedMonotonicMs: pcm.startedMonotonicMs,
          releaseInputLease,
          failureHandled: false,
        };
        capture = currentCapture;
        activeCaptureRef.current = currentCapture;
        pendingStream = undefined;
        if (pendingCaptureStreamRef.current?.token === attempt) {
          pendingCaptureStreamRef.current = undefined;
        }
        pendingOrderedPcm = undefined;
        setRecordingStatus({ status: "recording" });

        currentCapture.registration = (async () => {
          const registration = await requestSession(
            requestedSessionId,
            currentCapture.controller.signal,
          );
          assertActiveCapture(currentCapture, activeCaptureRef.current);
          bindSession(registration.sessionId);
          currentCapture.pcm.attachRegistration(registration);
          return registration;
        })();

        void currentCapture.registration.catch((error) => {
          if (
            activeCaptureRef.current !== currentCapture ||
            currentCapture.controller.signal.aborted ||
            unmountingRef.current
          ) {
            return;
          }
          void failOrderedPcmCapture(
            currentCapture,
            normalizeError(error, "PCM 会话注册失败。"),
          );
        });
        if (pendingFailure) {
          void failOrderedPcmCapture(currentCapture, pendingFailure);
        }
        return;
      }

      const mimeType = getSupportedAudioType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const currentCapture: BatchActiveCapture = {
        mode: "batch",
        token: attempt,
        controller,
        recorder,
        stream,
        chunks: [],
        startedMonotonicMs,
        releaseInputLease,
        failureHandled: false,
        onDataAvailable: () => undefined,
        onStop: () => undefined,
      };
      capture = currentCapture;

      currentCapture.onDataAvailable = (event) => {
        if (event.data.size > 0) {
          currentCapture.chunks.push(event.data);
        }
      };

      currentCapture.onStop = () => {
        const stoppedMonotonicMs = performance.now();
        const durationMs = Math.max(
          0,
          stoppedMonotonicMs - currentCapture.startedMonotonicMs,
        );
        const recordedType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(currentCapture.chunks, { type: recordedType });
        releaseCaptureDevices(currentCapture);

        if (unmountingRef.current) {
          disposeCapture(currentCapture, true);
          return;
        }

        void finishBatchCapture(
          currentCapture,
          blob,
          durationMs,
          stoppedMonotonicMs,
        );
      };

      recorder.addEventListener("dataavailable", currentCapture.onDataAvailable);
      recorder.addEventListener("stop", currentCapture.onStop);
      activeCaptureRef.current = currentCapture;
      pendingStream = undefined;
      if (pendingCaptureStreamRef.current?.token === attempt) {
        pendingCaptureStreamRef.current = undefined;
      }
      recorder.start();
      setRecordingStatus({ status: "recording" });

      currentCapture.registration = (async () => {
        const registration = await requestSession(
          requestedSessionId,
          currentCapture.controller.signal,
        );
        assertActiveCapture(currentCapture, activeCaptureRef.current);
        await withTransportRetry(
          (signal) => postRecordingStarted(
            apiBaseUrl,
            registration.sessionId,
            startedMonotonicMs,
            signal,
          ),
          BACKEND_TIMEOUT_MS,
          "后端没有响应录音开始事件。请确认 localhost:4317 正在运行。",
          currentCapture.controller.signal,
        );
        assertActiveCapture(currentCapture, activeCaptureRef.current);
        bindSession(registration.sessionId);
        return registration;
      })();

      void currentCapture.registration.catch((error) => {
        if (
          activeCaptureRef.current !== currentCapture ||
          currentCapture.controller.signal.aborted ||
          unmountingRef.current ||
          recorder.state === "inactive"
        ) {
          return;
        }

        setRecordingStatus({
          status: "recording",
          error: `本地录音已开始，但后端同步失败：${toErrorMessage(error)}。请停止后重试。`,
        });
      });
    } catch (error) {
      if (capture) {
        if (capture.mode === "batch" && capture.recorder.state !== "inactive") {
          capture.recorder.stop();
        }
        disposeCapture(capture, true);
      } else {
        await pendingOrderedPcm?.abort();
        stopMediaStream(pendingStream);
      }
      if (pendingCaptureStreamRef.current?.token === attempt) {
        pendingCaptureStreamRef.current = undefined;
      }
      releaseInputLease();
      setPendingSessionId(undefined);

      if (attempt !== startAttemptRef.current || unmountingRef.current) {
        return;
      }

      setRecordingStatus({ status: "error", error: recorderErrorMessage(error) });
    }
  }, [
    acquireInputLease,
    apiBaseUrl,
    bindSession,
    disposeCapture,
    failOrderedPcmCapture,
    finishBatchCapture,
    releaseCaptureDevices,
    requestSession,
    setRecordingStatus,
  ]);

  const toggleRecording = useCallback(() => {
    const status = recordingStatusRef.current;

    if (status === "recording") {
      stopRecording();
      return;
    }

    if (
      status === "connecting" ||
      status === "authorizing" ||
      status === "stopping" ||
      status === "uploading"
    ) {
      return;
    }

    void startRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => {
    unmountingRef.current = false;

    return () => {
      unmountingRef.current = true;
      startAttemptRef.current += 1;
      const capture = activeCaptureRef.current;
      const pendingCapture = pendingCaptureStreamRef.current;
      pendingCaptureStreamRef.current = undefined;
      stopMediaStream(pendingCapture?.stream);
      if (capture) {
        capture.controller.abort();
        if (capture.mode === "batch") {
          capture.recorder.removeEventListener("dataavailable", capture.onDataAvailable);
          capture.recorder.removeEventListener("stop", capture.onStop);
          if (capture.recorder.state !== "inactive") {
            capture.recorder.stop();
          }
        }
        disposeCapture(capture, true);
        capture.releaseInputLease();
      }
    };
  }, [disposeCapture]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    sessionIdRef.current = activeSessionId;
    setLocalSessionId(activeSessionId);
  }, [activeSessionId]);

  return {
    sessionId,
    pendingSessionId,
    recording,
    ensureSession,
    acquireManualInputLease,
    toggleRecording,
  };
}

type BrowserCaptureMode = "ordered-pcm" | "batch" | undefined;

function selectCaptureMode(): BrowserCaptureMode {
  const requestedMode = new URLSearchParams(window.location.search).get("audioCapture");
  if (requestedMode === "batch") {
    return typeof MediaRecorder !== "undefined" ? "batch" : undefined;
  }
  if (requestedMode === "ordered-pcm") {
    return canUseOrderedPcmCapture() ? "ordered-pcm" : undefined;
  }
  if (canUseOrderedPcmCapture()) {
    return "ordered-pcm";
  }
  if (typeof MediaRecorder !== "undefined") {
    return "batch";
  }
  return undefined;
}

function canRecordAudio(mode: BrowserCaptureMode) {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  return Boolean(
    mediaDevices &&
      "getUserMedia" in mediaDevices &&
      mode,
  );
}

async function requestMicrophoneWithTimeout(
  attempt: number,
  attemptRef: { current: number },
  captureMode: Exclude<BrowserCaptureMode, undefined>,
): Promise<MediaStream> {
  const microphonePromise = navigator.mediaDevices.getUserMedia({
    audio: captureMode === "ordered-pcm"
      ? {
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : true,
  });
  let timeoutId = 0;
  let timedOut = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      reject(new Error("MICROPHONE_TIMEOUT"));
    }, MICROPHONE_TIMEOUT_MS);
  });

  microphonePromise.then((lateStream) => {
    if (timedOut || attempt !== attemptRef.current) {
      for (const track of lateStream.getTracks()) {
        track.stop();
      }
    }
  }).catch(() => undefined);

  try {
    return await Promise.race([microphonePromise, timeoutPromise]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function withAbortTimeout<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await action(controller.signal);
  } catch (error) {
    if (parentSignal?.aborted) {
      throw new Error("RECORDING_CANCELLED");
    }
    if (timedOut) {
      throw new TransportTimeoutError(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function withTransportRetry<T>(
  action: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withAbortTimeout(
        action,
        timeoutMs,
        timeoutMessage,
        parentSignal,
      );
    } catch (error) {
      lastError = error;
      if (
        attempt === 1 ||
        parentSignal?.aborted ||
        !isRetryableTransportError(error)
      ) {
        throw error;
      }
    }
  }

  throw lastError;
}

class TransportTimeoutError extends Error {
  override readonly name = "TransportTimeoutError";
}

function isRetryableTransportError(error: unknown) {
  return error instanceof TransportTimeoutError ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "AbortError");
}

function assertActiveAttempt(attempt: number, currentAttempt: number) {
  if (attempt !== currentAttempt) {
    throw new Error("RECORDING_CANCELLED");
  }
}

function assertActiveCapture(
  capture: ActiveCapture,
  activeCapture: ActiveCapture | undefined,
) {
  if (
    capture !== activeCapture ||
    capture.token !== activeCapture?.token ||
    capture.controller.signal.aborted
  ) {
    throw new Error("RECORDING_CANCELLED");
  }
}

function createBrowserSessionId() {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("当前浏览器不能生成安全的本地会话标识。");
  }

  return `browser-${globalThis.crypto.randomUUID()}`;
}

function stopMediaStream(stream: MediaStream | undefined) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

function assertRawCaptureProcessingDisabled(stream: MediaStream) {
  const track = stream.getAudioTracks()[0];
  if (!track) {
    throw new Error("麦克风没有提供音频轨道。");
  }

  const settings = track.getSettings();
  const enabledProcessing = [
    ["echoCancellation", settings.echoCancellation],
    ["noiseSuppression", settings.noiseSuppression],
    ["autoGainControl", settings.autoGainControl],
  ].filter((entry): entry is [string, true] => entry[1] === true);
  if (enabledProcessing.length > 0) {
    throw new Error(
      `浏览器仍启用了 ${enabledProcessing.map(([name]) => name).join(", ")}，本轮 PCM 不能作为原始声学证据。`,
    );
  }
}

function normalizeError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function recorderErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "麦克风权限被拒绝。请在浏览器地址栏允许 localhost 使用麦克风后重试。";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "没有找到可用麦克风。请连接或选择一个输入设备。";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "麦克风正被其他应用占用。关闭占用程序后重试。";
    }
  }

  if (error instanceof Error && error.message === "MICROPHONE_TIMEOUT") {
    return "等待麦克风授权超时。请处理浏览器权限提示后再次点击。";
  }

  return toErrorMessage(error);
}

function getSupportedAudioType() {
  return PREFERRED_AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}
