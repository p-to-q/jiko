import { expect, test } from "@playwright/test";

const serverBaseUrl = "http://127.0.0.1:4317";

test("one visible turn stays bound and completes reveal across delayed TTS", async ({
  page,
  request,
}) => {
  await page.goto("/");

  const root = page.locator(".viewport-shell");
  const canvas = page.locator(".device-canvas");
  const manualInput = page.getByRole("textbox");
  const sendButton = page.getByRole("button", { name: "Send transcript" });
  await manualInput.fill("我不想马上放弃，但也不想继续按原来的方式做。");

  await sendButton.click();
  await expect(root).toHaveAttribute("data-device-state", "result");

  const sessionId = await root.getAttribute("data-active-session-id");
  const attemptId = await root.getAttribute("data-attempt-id");
  const resultCopy = await page.locator(".top-title").innerText();
  expect(sessionId).toBeTruthy();
  expect(attemptId).toBeTruthy();
  await expect(sendButton).toBeEnabled();
  await expect(canvas).toHaveAttribute("data-active-session-id", sessionId!);
  await expect(canvas).toHaveAttribute("data-attempt-id", attemptId!);
  // Persisted event order is stable evidence; sampling the scheduler's brief
  // active window races a fast clip and a delayed browser/SSE consumer.
  await expect.poll(async () => {
    const response = await request.get(`${serverBaseUrl}/sessions/${sessionId}`);
    if (!response.ok()) return [];
    const payload = await response.json() as {
      session?: { events?: Array<{ type?: string }> };
    };
    return (payload.session?.events ?? [])
      .map((event) => event.type)
      .filter((type) =>
        type === "session.result" ||
        type === "tts.started" ||
        type === "tts.finished"
      );
  }, { timeout: 15_000 }).toEqual([
    "session.result",
    "tts.started",
    "tts.finished",
  ]);

  // TTS lifecycle events must not clean up the result-identity reveal timers.
  await expect(root).toHaveAttribute("data-reveal-state", "ready");
  const [rootSequence, canvasSequence] = await page.evaluate(() => [
    document.querySelector(".viewport-shell")?.getAttribute("data-sequence"),
    document.querySelector(".device-canvas")?.getAttribute("data-sequence"),
  ]);
  expect(canvasSequence).toBe(rootSequence);

  const foreignSessionId = `foreign-${Date.now()}`;
  const createResponse = await request.post(`${serverBaseUrl}/sessions`, {
    data: { sessionId: foreignSessionId, source: "operator" },
  });
  expect(createResponse.status()).toBe(201);
  const foreignResponse = await request.post(
    `${serverBaseUrl}/sessions/${foreignSessionId}/manual-transcript`,
    {
      data: { transcript: "这一轮来自另一个会话。", language: "zh" },
    },
  );
  expect(foreignResponse.ok()).toBeTruthy();

  await expect(root).toHaveAttribute("data-active-session-id", sessionId!);
  await expect(canvas).toHaveAttribute("data-active-session-id", sessionId!);
  await expect(page.locator(".top-title")).toHaveText(resultCopy);

  const resetResponse = await request.post(
    `${serverBaseUrl}/sessions/${foreignSessionId}/demo-event`,
    { data: { type: "session.reset" } },
  );
  expect(resetResponse.ok()).toBeTruthy();
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("locks all result windows without ceremonial delay", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox").fill("我想先完成这一轮，再决定下一步。");
    await page.getByRole("button", { name: "Send transcript" }).click();

    const root = page.locator(".viewport-shell");
    await expect(root).toHaveAttribute("data-device-state", "result");
    await expect(root).toHaveAttribute("data-reveal-state", "ready");
    await expect(page.locator('.reading-window[data-lamp-motion="locked"]')).toHaveCount(3);
  });
});

test("device mode discovers each new device attempt without leaking the prior session", async ({
  page,
  request,
}) => {
  await page.goto("/?mode=device");
  const root = page.locator(".viewport-shell");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const firstSessionId = `device-e2e-first-${suffix}`;
  const secondSessionId = `device-e2e-second-${suffix}`;

  const first = await request.post(`${serverBaseUrl}/sessions`, {
    data: { sessionId: firstSessionId, source: "device" },
  });
  expect(first.status()).toBe(201);
  await expect(root).toHaveAttribute("data-active-session-id", firstSessionId);

  const firstStart = await request.post(
    `${serverBaseUrl}/sessions/${firstSessionId}/input-event`,
    {
      data: {
        type: "input.recording.started",
        source: "device",
        monotonicMs: 1_000,
      },
    },
  );
  expect(firstStart.ok()).toBeTruthy();
  await expect(root).toHaveAttribute("data-canonical-device-state", "recording");

  const second = await request.post(`${serverBaseUrl}/sessions`, {
    data: { sessionId: secondSessionId, source: "device" },
  });
  expect(second.status()).toBe(201);
  await expect(root).toHaveAttribute("data-active-session-id", secondSessionId);
  await expect(root).toHaveAttribute("data-canonical-device-state", "idle");

  const staleError = await request.post(
    `${serverBaseUrl}/sessions/${firstSessionId}/input-event`,
    {
      data: {
        type: "session.error",
        source: "device",
        monotonicMs: 1_100,
        code: "device_input_interrupted",
        message: "stale first attempt",
        recoverable: true,
      },
    },
  );
  expect(staleError.ok()).toBeTruthy();
  await expect(root).toHaveAttribute("data-active-session-id", secondSessionId);
  await expect(root).toHaveAttribute("data-canonical-device-state", "idle");

  const secondStart = await request.post(
    `${serverBaseUrl}/sessions/${secondSessionId}/input-event`,
    {
      data: {
        type: "input.recording.started",
        source: "device",
        monotonicMs: 2_000,
      },
    },
  );
  expect(secondStart.ok()).toBeTruthy();
  await expect(root).toHaveAttribute("data-canonical-device-state", "recording");
});

test("device canvas exposes hardware-observer status when browser capture is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
  });
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto("/?mode=device");

  await expect(page.locator(".device-record-control")).toHaveCount(0);
  await expect(page.getByRole("status", {
    name: "浏览器录音不可用，请使用硬件输入",
  })).toBeVisible();
  await expect(page.locator(".device-canvas")).toHaveCSS("width", "320px");
  await expect(page.locator(".device-canvas")).toHaveCSS("height", "480px");
});
