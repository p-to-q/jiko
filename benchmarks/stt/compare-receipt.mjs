import { readFile } from "node:fs/promises";
import path from "node:path";

import { compareSttCandidates } from "./comparison.mjs";

const requestedPath = process.argv.slice(2).find((argument) => argument !== "--");
if (!requestedPath) {
  console.error("usage: pnpm benchmark:stt:compare -- <receipt.json>");
  process.exitCode = 2;
} else {
  try {
    const receiptPath = path.resolve(process.cwd(), requestedPath);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    console.log(JSON.stringify(compareSttCandidates(receipt), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
