import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../artifacts/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    headless: true,
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "HOST=127.0.0.1 TTS_AFTER_RESULT_DELAY_MS=700 RESULT_REVEAL_MS=0 JIKO_WRITE_RECEIPTS=0 TTS_PLAY_AUDIO=0 pnpm --dir ../.. dev:server",
      url: "http://127.0.0.1:4317/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173/",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
