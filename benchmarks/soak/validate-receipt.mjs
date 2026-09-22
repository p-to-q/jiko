import { readFile } from "node:fs/promises";
import path from "node:path";

import { validateHostSoakReceipt } from "./receipt.mjs";

const requestedPath = process.argv.slice(2).find((argument) => argument !== "--");
if (!requestedPath) {
  throw new Error(
    "usage: pnpm benchmark:soak:validate -- artifacts/benchmarks/host-soak-v1/<run>/receipt.json"
  );
}

const receiptPath = path.resolve(process.cwd(), requestedPath);
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
const result = validateHostSoakReceipt(receipt);

if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`valid host_soak_v1 receipt: ${receiptPath}`);
  console.log(
    `host software integrity=${receipt.qualification.hostSoftwareIntegrity}; ` +
      "hardware/STT/thermal=not_evaluated"
  );
}
