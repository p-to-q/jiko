import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateSttBenchmarkReceipt } from "./receipt.mjs";

const requestedPath = process.argv.slice(2).find((argument) => argument !== "--");
if (!requestedPath) {
  throw new Error("usage: node benchmarks/stt/validate-receipt.mjs <receipt.json>");
}

const receiptPath = path.resolve(process.cwd(), requestedPath);
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const validation = validateSttBenchmarkReceipt(receipt);
if (!validation.ok) {
  for (const issue of validation.issues) {
    console.error(`${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`valid stt_benchmark_v1 receipt: ${receiptPath}`);
}
