import { expect, test, type APIRequestContext } from "@playwright/test";

const browserServerBaseUrl = "http://localhost:4317";
const serverBaseUrl = "http://127.0.0.1:4317";

test("local capture starts and stops while session registration is still blocked", async ({
  page,
  request,
}) => {
  let releaseSessionRequest = () => undefined;
  const sessionRequestGate = new Promise<void>((resolve) => {
    releaseSessionRequest = resolve;
  });
  let sessionRequestSeen = false;
  let sessionRequestCount = 0;
  let sessionResponseReleased = false;
  let audioRequestCount = 0;
  let committedThenDroppedStart = false;

  await page.route(`${browserServerBaseUrl}/sessions`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    sessionRequestSeen = true;
    sessionRequestCount += 1;
    await sessionRequestGate;
    sessionResponseReleased = true;
    await route.continue();
  });
  await page.route(`${browserServerBaseUrl}/sessions/*/input-event`, async (route) => {
    const payload = route.request().postDataJSON() as { type?: string } | null;
    if (
      payload?.type === "input.recording.started" &&
      !committedThenDroppedStart
    ) {
      const committedResponse = await route.fetch();
      expect(committedResponse.ok()).toBe(true);
      committedThenDroppedStart = true;
      await route.abort("failed");
      return;
    }

    await route.continue();
  });
  page.on("request", (outgoingRequest) => {
    if (
      outgoingRequest.method() === "POST" &&
      new URL(outgoingRequest.url()).pathname.endsWith("/audio")
    ) {
      audioRequestCount += 1;
    }
  });

  await page.goto("/?audioCapture=batch");
  const recordButton = page.locator(".device-record-control");
  const root = page.locator(".viewport-shell");
  const manualInput = page.locator(".manual-input");

  await expect(root).toHaveAttribute("data-session-identity-state", "idle");

  await manualInput.fill("这条并发 fallback 不应取得输入所有权。");
  await expect(page.locator(".manual-submit")).toBeEnabled();

  // Two clicks in the same task model a double activation before React has
  // painted the disabled state. Recording must start once, and a manual submit
  // in the same task must not acquire a second session/input owner.
  await page.evaluate(() => {
    const record = document.querySelector<HTMLButtonElement>(".device-record-control");
    const manual = document.querySelector<HTMLButtonElement>(".manual-submit");
    record?.click();
    record?.click();
    manual?.click();
  });
  await expect(recordButton).toHaveAttribute("data-recording-state", "recording");
  await expect(page.locator(".top-title")).toHaveText("正在聆听");
  await expect(root).toHaveAttribute("data-session-identity-state", "pending");
  await expect(root).toHaveAttribute("data-active-session-id", "");
  const pendingSessionId = await root.getAttribute("data-pending-session-id");
  expect(pendingSessionId).toMatch(/^browser-[a-f0-9-]+$/);
  expect(sessionRequestSeen).toBe(true);
  expect(sessionRequestCount).toBe(1);
  expect(sessionResponseReleased).toBe(false);

  // Let the real Chrome MediaRecorder collect synthetic fake-microphone frames,
  // then seal them while POST /sessions is still deliberately unresolved.
  await page.waitForTimeout(250);
  await recordButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(recordButton).toHaveAttribute("data-recording-state", "uploading");
  expect(sessionResponseReleased).toBe(false);
  expect(audioRequestCount).toBe(0);

  releaseSessionRequest();
  await expect(root).not.toHaveAttribute("data-active-session-id", "");
  const sessionId = await root.getAttribute("data-active-session-id");
  expect(sessionId).toMatch(/^browser-[a-f0-9-]+$/);
  expect(sessionId).toBe(pendingSessionId);
  await expect(root).toHaveAttribute("data-session-identity-state", "bound");
  await expect(root).toHaveAttribute("data-pending-session-id", "");

  await expect.poll(async () => {
    const receipt = await fetchReceipt(request, sessionId!);
    return receipt.events?.some((event) => event.type === "audio.uploaded") ?? false;
  }, { timeout: 20_000 }).toBe(true);

  const receipt = await fetchReceipt(request, sessionId!);
  const eventTypes = receipt.events?.map((event) => event.type) ?? [];
  expect(committedThenDroppedStart).toBe(true);
  expect(audioRequestCount).toBe(1);
  expect(eventTypes.slice(0, 4)).toEqual([
    "session.created",
    "input.recording.started",
    "input.recording.stopped",
    "audio.uploaded",
  ]);
  expect(eventTypes.filter((type) => type === "input.recording.started")).toHaveLength(1);
  expect(eventTypes.filter((type) => type === "input.recording.stopped")).toHaveLength(1);
  expect(receipt.input?.audio?.byteSize).toBeGreaterThan(0);
});

test("microphone permission denial is shown as a permission problem", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        throw new DOMException("Permission denied by test", "NotAllowedError");
      },
    });
  });
  await page.goto("/?audioCapture=ordered-pcm");

  const recordButton = page.locator(".device-record-control");
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", "error");
  await expect(page.locator(".top-title")).toHaveText("麦克风未授权");
  await expect(page.locator(".top-subtitle")).toHaveText("MIC PERMISSION");
});

test("forced ordered PCM reports an unsupported browser separately from permission", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioWorkletNode", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/?audioCapture=ordered-pcm");

  const recordButton = page.locator(".device-record-control");
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", "error");
  await expect(page.locator(".top-title")).toHaveText("浏览器不支持");
  await expect(page.locator(".top-subtitle")).toHaveText("SECURE BROWSER");
});

test("ordered PCM fails closed when the audio context cannot resume", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        const stream = await nativeGetUserMedia(constraints);
        (window as Window & { __jikoCapturedStream?: MediaStream })
          .__jikoCapturedStream = stream;
        return stream;
      },
    });
    Object.defineProperty(window.AudioContext.prototype, "resume", {
      configurable: true,
      value: () => new Promise<void>(() => undefined),
    });
  });
  await page.goto("/?audioCapture=ordered-pcm");

  const recordButton = page.locator(".device-record-control");
  const root = page.locator(".viewport-shell");
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", "error", {
    timeout: 8_000,
  });
  await expect(page.locator(".top-title")).toHaveText("麦克风中断");
  await expect(root).toHaveAttribute("data-session-identity-state", "idle");
  expect(await page.evaluate(() => {
    const stream = (window as Window & { __jikoCapturedStream?: MediaStream })
      .__jikoCapturedStream;
    return stream?.getTracks().every((track) => track.readyState === "ended");
  })).toBe(true);
});

test("ordered PCM captures real fake-microphone frames with continuous coverage", async ({
  page,
  request,
}) => {
  await page.goto("/?audioCapture=ordered-pcm");

  const recordButton = page.locator(".device-record-control");
  const root = page.locator(".viewport-shell");
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", "recording");
  await expect(root).toHaveAttribute(
    "data-session-identity-state",
    /pending|bound/,
  );

  await page.evaluate(() => {
    const deadline = performance.now() + 300;
    while (performance.now() < deadline) {
      // Exercise the bounded worklet credit window across a long main-thread
      // task without silently losing the turn.
    }
  });
  await page.waitForTimeout(120);
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", /stopping|uploading/);
  await expect(recordButton).toHaveAttribute("data-recording-state", "idle", {
    timeout: 20_000,
  });

  await expect(root).toHaveAttribute("data-session-identity-state", "bound");
  const sessionId = await root.getAttribute("data-active-session-id");
  expect(sessionId).toMatch(/^browser-[a-f0-9-]+$/);

  const receipt = await fetchReceipt(request, sessionId!);
  const orderedPcm = receipt.input?.orderedPcm;
  expect(orderedPcm?.pcmProfile.sampleFormat).toBe("s16le");
  expect(orderedPcm?.pcmProfile.channelCount).toBe(1);
  expect(orderedPcm?.pcmProfile.sampleRateHz).toBeGreaterThan(0);
  expect(orderedPcm?.receivedByteCount).toBeGreaterThan(0);
  expect(orderedPcm?.receivedChunkCount).toBeGreaterThan(0);
  expect(
    (orderedPcm?.receivedFrameCount ?? 0) /
      (orderedPcm?.pcmProfile.sampleRateHz ?? 1),
  ).toBeGreaterThan(0.25);
  expect(orderedPcm?.finalSequence).toBe(orderedPcm?.receivedChunkCount);
  expect(orderedPcm?.receivedByteCount).toBe(orderedPcm?.emittedByteCount);
  expect(orderedPcm?.coverageComplete).toBe(true);
  expect(orderedPcm?.sourcePcmSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(orderedPcm?.missingChunkCount).toBe(0);
  expect(orderedPcm?.sequenceGapCount).toBe(0);
  expect(orderedPcm?.lossEvidence).toEqual({
    captureGapCount: 0,
    droppedFrameCount: 0,
    droppedByteCount: 0,
    overflowCount: 0,
  });
  expect(receipt.input?.audio?.mediaType).toBe("audio/wav");
  expect(receipt.input?.audio?.byteSize).toBeGreaterThan(44);
  const eventTypes = receipt.events?.map((event) => event.type) ?? [];
  expect(eventTypes.filter((type) => type === "input.recording.started")).toHaveLength(1);
  expect(eventTypes.filter((type) => type === "input.recording.stopped")).toHaveLength(1);
});

test("ordered PCM reconciles a committed result when the final acknowledgement is lost", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    class DropFinalAckWebSocket extends NativeWebSocket {
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (type !== "message") {
          super.addEventListener(type, listener, options);
          return;
        }
        const wrapped: EventListener = (event) => {
          const message = event as MessageEvent<unknown>;
          let drop = false;
          if (typeof message.data === "string") {
            try {
              const payload = JSON.parse(message.data) as {
                type?: string;
                acknowledgedType?: string;
              };
              drop = payload.type === "audio.ack" &&
                payload.acknowledgedType === "audio.stop";
            } catch {
              // The application still owns malformed-message handling.
            }
          }
          if (drop) {
            Object.assign(window, { __jikoDroppedFinalAck: true });
            return;
          }
          if (typeof listener === "function") {
            listener.call(this, event);
          } else {
            listener.handleEvent(event);
          }
        };
        super.addEventListener(type, wrapped, options);
      }
    }
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: DropFinalAckWebSocket,
    });
  });
  await page.goto("/?audioCapture=ordered-pcm");

  const recordButton = page.locator(".device-record-control");
  const root = page.locator(".viewport-shell");
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", "recording");
  await page.waitForTimeout(350);
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", "idle", {
    timeout: 20_000,
  });
  expect(await page.evaluate(() => Boolean(
    (window as Window & { __jikoDroppedFinalAck?: boolean }).__jikoDroppedFinalAck,
  ))).toBe(true);

  const sessionId = await root.getAttribute("data-active-session-id");
  expect(sessionId).toMatch(/^browser-[a-f0-9-]+$/);
  const receipt = await fetchReceipt(request, sessionId!);
  expect(receipt.events?.at(-1)?.type).toMatch(/session\.result|tts\.finished/);
  expect(receipt.input?.orderedPcm?.coverageComplete).toBe(true);
});

test("ordered PCM handshake rejection leaves a canonical terminal session error", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    class RejectedProtocolWebSocket extends NativeWebSocket {
      constructor(url: string | URL, _protocols?: string | string[]) {
        super(url, "wrong.protocol");
      }
    }
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: RejectedProtocolWebSocket,
    });
  });
  await page.goto("/?audioCapture=ordered-pcm");

  const recordButton = page.locator(".device-record-control");
  const root = page.locator(".viewport-shell");
  await recordButton.click();
  await expect(recordButton).toHaveAttribute("data-recording-state", "error", {
    timeout: 15_000,
  });
  await expect(root).toHaveAttribute("data-session-identity-state", "bound", {
    timeout: 15_000,
  });
  const sessionId = await root.getAttribute("data-active-session-id");
  expect(sessionId).toMatch(/^browser-[a-f0-9-]+$/);

  await expect.poll(async () => {
    const receipt = await fetchReceipt(request, sessionId!);
    return receipt.events?.at(-1)?.type;
  }, { timeout: 15_000 }).toBe("session.error");

  const receipt = await fetchReceipt(request, sessionId!);
  expect(receipt.events?.at(-1)?.code).toBe(
    "ordered_pcm_browser_capture_failed",
  );
});

type Receipt = {
  input?: {
    audio?: {
      byteSize?: number;
      mediaType?: string;
    };
    orderedPcm?: {
      pcmProfile: {
        sampleFormat: string;
        sampleRateHz: number;
        channelCount: number;
      };
      finalSequence: number;
      receivedChunkCount: number;
      receivedFrameCount: number;
      receivedByteCount: number;
      emittedByteCount: number;
      sequenceGapCount: number;
      missingChunkCount: number;
      coverageComplete: boolean;
      sourcePcmSha256?: string;
      lossEvidence: {
        captureGapCount: number;
        droppedFrameCount: number;
        droppedByteCount: number;
        overflowCount: number;
      };
    };
  };
  events?: Array<{ type?: string; code?: string }>;
};

async function fetchReceipt(
  request: APIRequestContext,
  sessionId: string,
): Promise<Receipt> {
  const response = await request.get(
    `${serverBaseUrl}/sessions/${encodeURIComponent(sessionId)}/receipt`,
  );
  if (!response.ok()) {
    return {};
  }

  return response.json() as Promise<Receipt>;
}
