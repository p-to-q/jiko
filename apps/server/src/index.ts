import http from "node:http";
import { EventBus } from "./eventBus.js";
import { ReceiptWriter } from "./receipts.js";
import { createRequestHandler } from "./routes.js";
import { SessionStore } from "./sessionStore.js";

const port = readPort(process.env.PORT);
const host = process.env.HOST ?? "0.0.0.0";

const bus = new EventBus();
const receipts = new ReceiptWriter();
const store = new SessionStore();

const server = http.createServer(createRequestHandler({ bus, receipts, store }));

server.listen(port, host, () => {
  console.log(`jiko mock server listening on http://${host}:${port}`);
  console.log(`receipts ${receipts.enabled ? "enabled" : "disabled"}`);
});

process.on("SIGINT", () => {
  server.close(() => {
    process.exitCode = 0;
  });
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exitCode = 0;
  });
});

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? "4317");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return 4317;
  }

  return parsed;
}
