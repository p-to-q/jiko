import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const sttDirectory = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(
  readFileSync(
    path.join(sttDirectory, "schema", "stt-benchmark-config-v1.schema.json"),
    "utf8"
  )
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

export async function loadSttBenchmarkConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const bytes = await readFile(absolutePath);
  const config = JSON.parse(bytes.toString("utf8"));
  const validation = validateSttBenchmarkConfig(config);
  if (!validation.ok) {
    throw new Error(
      `Invalid stt_benchmark_config_v1:\n${validation.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("\n")}`
    );
  }
  return {
    config,
    bytes,
    path: absolutePath,
    directory: path.dirname(absolutePath)
  };
}

export function validateSttBenchmarkConfig(config) {
  const issues = [];
  if (!validateSchema(config)) {
    for (const error of validateSchema.errors ?? []) {
      issues.push({
        path: error.instancePath || "/",
        message: `schema: ${error.message ?? "invalid value"}`
      });
    }
  }
  if (Array.isArray(config?.candidates)) {
    const ids = new Set();
    const families = new Set();
    for (const [index, candidate] of config.candidates.entries()) {
      if (ids.has(candidate?.id)) {
        issues.push({ path: `/candidates/${index}/id`, message: "must be unique" });
      }
      ids.add(candidate?.id);
      if (families.has(candidate?.family)) {
        issues.push({ path: `/candidates/${index}/family`, message: "must be unique" });
      }
      families.add(candidate?.family);
    }
  }
  return { ok: issues.length === 0, issues };
}
