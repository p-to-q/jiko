import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateHardwareHilReceipt } from "./receipt.mjs";

const hardwareDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(hardwareDir, "..", "..");
const requestedPath = process.argv.slice(2).find((argument) => argument !== "--");

if (!requestedPath) {
  console.error(
    "usage: pnpm benchmark:hil:validate -- artifacts/benchmarks/hardware-hil-v1/<run>/receipt.json"
  );
  process.exitCode = 2;
} else {
  try {
    const receiptPath = path.resolve(process.cwd(), requestedPath);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const validation = await validateHardwareHilReceipt(receipt, {
      repositoryRoot,
      verifyArtifacts: true
    });
    if (!validation.ok) {
      for (const issue of validation.issues) {
        console.error(`${issue.path}: ${issue.message}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`valid hardware_hil_v1 receipt: ${path.relative(repositoryRoot, receiptPath)}`);
      console.log(
        `evidence=${receipt.evidenceClass} qualification=${receipt.qualification.verdict}`
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
