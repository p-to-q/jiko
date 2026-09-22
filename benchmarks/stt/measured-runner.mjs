import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMeasuredSttBenchmark } from "./runner.mjs";

const sttDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(sttDirectory, "../..");
const configIndex = process.argv.indexOf("--config");
if (configIndex < 0 || !process.argv[configIndex + 1]) {
  throw new Error("usage: node benchmarks/stt/measured-runner.mjs --config <config.json>");
}
const configPath = path.resolve(repositoryRoot, process.argv[configIndex + 1]);
const { receipt, runPath } = await runMeasuredSttBenchmark({
  configPath,
  repositoryRoot,
  writeReceipt: true
});

console.log(`STT benchmark evidence: ${receipt.qualification.evidenceLevel}`);
console.log(`qualification: ${receipt.qualification.verdict}`);
console.log(`receipt: ${path.relative(repositoryRoot, runPath)}`);
