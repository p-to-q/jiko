import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const hardwareDir = path.dirname(fileURLToPath(import.meta.url));
export const hardwareHilSchemaPath = path.join(
  hardwareDir,
  "schema",
  "hardware-hil-v1.schema.json"
);

const schema = JSON.parse(readFileSync(hardwareHilSchemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);

const physicalMeasurementGroups = ["capture", "dutPower", "dutThermal"];
const gateMinimumDurationMs = {
  architecture_8h: 8 * 60 * 60 * 1000,
  evt_24h: 24 * 60 * 60 * 1000,
  dvt_72h: 72 * 60 * 60 * 1000
};
const requiredIdentifiedComponents = [
  "os_image",
  "application",
  "model_bundle",
  "configuration",
  "audio_profile"
];
const requiredDeclaredComponents = ["mcu_firmware", "dsp_firmware"];

export async function validateHardwareHilReceipt(
  receipt,
  { repositoryRoot, verifyArtifacts = false } = {}
) {
  const issues = [];
  const schemaValid = validateSchema(receipt);

  if (!schemaValid) {
    for (const error of validateSchema.errors ?? []) {
      issues.push({
        path: error.instancePath || "/",
        message: `schema: ${error.message ?? "invalid value"}`
      });
    }
  }

  if (receipt && typeof receipt === "object") {
    validateTime(receipt, issues);
    validateCampaign(receipt, issues);
    validateCases(receipt, issues);
    validateFaults(receipt, issues);
    validateDistributions(receipt, issues);
    validateEvidenceBoundary(receipt, issues);
    validateQualification(receipt, issues);
    validateArtifactReferences(receipt, issues);

    if (verifyArtifacts) {
      if (!repositoryRoot) {
        issues.push({
          path: "/artifacts",
          message: "artifact verification requires repositoryRoot"
        });
      } else if (Array.isArray(receipt.artifacts)) {
        await verifyReceiptArtifacts(receipt.artifacts, repositoryRoot, issues);
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export async function assertHardwareHilReceipt(receipt, options) {
  const result = await validateHardwareHilReceipt(receipt, options);
  if (!result.ok) {
    const detail = result.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid hardware_hil_v1 receipt:\n${detail}`);
  }
  return receipt;
}

export function deriveQualificationVerdict(receipt) {
  if (receipt?.qualification?.profile === "none") {
    return "not_evaluated";
  }

  const requiredChecks = Array.isArray(receipt?.checks)
    ? receipt.checks.filter((check) => check?.required === true)
    : [];
  if (requiredChecks.some((check) => check.verdict === "fail")) {
    return "fail";
  }
  if (
    requiredChecks.length === 0 ||
    requiredChecks.some((check) => check.verdict !== "pass")
  ) {
    return "not_evaluated";
  }
  return "pass";
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateTime(receipt, issues) {
  const startedAt = Date.parse(receipt.startedAt);
  const finishedAt = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(startedAt)) {
    issues.push({ path: "/startedAt", message: "must be a valid UTC timestamp" });
  }
  if (!Number.isFinite(finishedAt)) {
    issues.push({ path: "/finishedAt", message: "must be a valid UTC timestamp" });
  }
  if (Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt < startedAt) {
    issues.push({ path: "/finishedAt", message: "must not precede startedAt" });
  }
}

function validateCampaign(receipt, issues) {
  const campaign = receipt.campaign;
  if (!campaign || typeof campaign !== "object") {
    return;
  }
  if (
    Number.isInteger(campaign.plannedTurns) &&
    Number.isInteger(campaign.completedTurns) &&
    campaign.completedTurns > campaign.plannedTurns
  ) {
    issues.push({
      path: "/campaign/completedTurns",
      message: "cannot exceed plannedTurns"
    });
  }
}

function validateCases(receipt, issues) {
  if (!Array.isArray(receipt.cases) || !receipt.campaign) {
    return;
  }

  const caseIds = new Set();
  let plannedTurns = 0;
  let completedTurns = 0;
  for (const [index, caseSummary] of receipt.cases.entries()) {
    if (!caseSummary || typeof caseSummary !== "object") {
      continue;
    }
    if (caseIds.has(caseSummary.id)) {
      issues.push({
        path: `/cases/${index}/id`,
        message: "case ids must be unique"
      });
    }
    caseIds.add(caseSummary.id);
    plannedTurns += Number.isInteger(caseSummary.plannedTurns)
      ? caseSummary.plannedTurns
      : 0;
    completedTurns += Number.isInteger(caseSummary.completedTurns)
      ? caseSummary.completedTurns
      : 0;

    if (caseSummary.completedTurns > caseSummary.plannedTurns) {
      issues.push({
        path: `/cases/${index}/completedTurns`,
        message: "cannot exceed plannedTurns"
      });
    }
    if (Array.isArray(caseSummary.outcomes)) {
      const outcomeTotal = caseSummary.outcomes.reduce(
        (sum, outcome) => sum + (Number.isInteger(outcome?.count) ? outcome.count : 0),
        0
      );
      if (outcomeTotal !== caseSummary.completedTurns) {
        issues.push({
          path: `/cases/${index}/outcomes`,
          message: "outcome counts must equal completedTurns"
        });
      }
    }
  }

  if (plannedTurns !== receipt.campaign.plannedTurns) {
    issues.push({
      path: "/cases",
      message: "case plannedTurns must sum to campaign.plannedTurns"
    });
  }
  if (completedTurns !== receipt.campaign.completedTurns) {
    issues.push({
      path: "/cases",
      message: "case completedTurns must sum to campaign.completedTurns"
    });
  }
}

function validateFaults(receipt, issues) {
  if (!Array.isArray(receipt.faults)) {
    return;
  }
  const ids = new Set();
  for (const [index, fault] of receipt.faults.entries()) {
    if (!fault || typeof fault !== "object") {
      continue;
    }
    if (ids.has(fault.id)) {
      issues.push({ path: `/faults/${index}/id`, message: "fault ids must be unique" });
    }
    ids.add(fault.id);

    if (!fault.injected && (fault.type !== "none" || fault.domain !== "none")) {
      issues.push({
        path: `/faults/${index}`,
        message: "a non-injected fault must use type and domain 'none'"
      });
    }
    if (fault.injected && (fault.type === "none" || fault.domain === "none")) {
      issues.push({
        path: `/faults/${index}`,
        message: "an injected fault must declare a non-none type and domain"
      });
    }
    if (
      fault.verdict === "pass" &&
      fault.expectedOutcome !== fault.observedOutcome
    ) {
      issues.push({
        path: `/faults/${index}/verdict`,
        message: "cannot pass when expected and observed outcomes differ"
      });
    }
  }
}

function validateDistributions(receipt, issues) {
  walk(receipt, "", (value, pointer) => {
    if (
      !value ||
      typeof value !== "object" ||
      value.availability !== "measured" ||
      !("p50" in value) ||
      !("p95" in value) ||
      !("max" in value)
    ) {
      return;
    }

    const values = [value.p50, value.p95];
    if ("p99" in value) {
      values.push(value.p99);
    }
    values.push(value.max);
    if (values.some((sample) => typeof sample !== "number" || !Number.isFinite(sample))) {
      return;
    }
    if (values.some((sample, index) => index > 0 && sample < values[index - 1])) {
      issues.push({
        path: pointer || "/",
        message: "distribution must satisfy p50 <= p95 <= p99 <= max"
      });
    }
  });
}

function validateEvidenceBoundary(receipt, issues) {
  if (receipt.evidenceClass === "host_simulation") {
    if (receipt.dut?.present !== false) {
      issues.push({
        path: "/dut/present",
        message: "host_simulation must declare dut.present=false"
      });
    }
    if (receipt.fixture?.kind !== "synthetic") {
      issues.push({
        path: "/fixture/kind",
        message: "host_simulation must use a synthetic fixture"
      });
    }
    if (receipt.qualification?.profile !== "none") {
      issues.push({
        path: "/qualification/profile",
        message: "host_simulation must use qualification profile 'none'"
      });
    }
    if (receipt.qualification?.verdict !== "not_evaluated") {
      issues.push({
        path: "/qualification/verdict",
        message: "host_simulation hardware qualification is always not_evaluated"
      });
    }
    if (
      receipt.pathCoverage?.control === "physical_button" ||
      receipt.pathCoverage?.audio === "acoustic_capture" ||
      receipt.pathCoverage?.output === "electrical" ||
      receipt.pathCoverage?.output === "acoustic"
    ) {
      issues.push({
        path: "/pathCoverage",
        message: "host_simulation cannot claim a physical control, capture, or output path"
      });
    }

    for (const groupName of physicalMeasurementGroups) {
      const group = receipt.measurements?.[groupName];
      if (group && hasMeasuredLeaf(group)) {
        issues.push({
          path: `/measurements/${groupName}`,
          message: "host_simulation cannot report DUT physical measurements as measured"
        });
      }
    }
  }

  if (receipt.evidenceClass === "hardware_in_loop") {
    if (receipt.dut?.present !== true) {
      issues.push({
        path: "/dut/present",
        message: "hardware_in_loop requires a present DUT"
      });
    }
    if (receipt.fixture?.kind !== "physical") {
      issues.push({
        path: "/fixture/kind",
        message: "hardware_in_loop requires a physical fixture"
      });
    }
  }
}

function validateQualification(receipt, issues) {
  const qualification = receipt.qualification;
  if (!qualification || typeof qualification !== "object") {
    return;
  }

  const derivedVerdict = deriveQualificationVerdict(receipt);
  if (qualification.verdict !== derivedVerdict) {
    issues.push({
      path: "/qualification/verdict",
      message: `must be derived from profile and required checks as ${derivedVerdict}`
    });
  }
  if (qualification.verdict !== "pass" && qualification.reasons?.length === 0) {
    issues.push({
      path: "/qualification/reasons",
      message: "non-passing qualification requires at least one reason"
    });
  }
  if (qualification.verdict !== "pass") {
    return;
  }

  if (receipt.evidenceClass !== "hardware_in_loop") {
    issues.push({
      path: "/qualification/verdict",
      message: "only hardware_in_loop evidence can pass a hardware qualification"
    });
    return;
  }
  if (receipt.harnessStatus !== "completed") {
    issues.push({
      path: "/harnessStatus",
      message: "a passing qualification requires a completed harness"
    });
  }
  if (
    receipt.pathCoverage?.control !== "physical_button" ||
    receipt.pathCoverage?.audio !== "acoustic_capture" ||
    !["electrical", "acoustic"].includes(receipt.pathCoverage?.output)
  ) {
    issues.push({
      path: "/pathCoverage",
      message: "a passing qualification requires physical control, acoustic capture, and measured output coverage"
    });
  }

  const minimumDuration = gateMinimumDurationMs[qualification.profile];
  if (minimumDuration !== undefined && receipt.elapsedMonotonicMs < minimumDuration) {
    issues.push({
      path: "/elapsedMonotonicMs",
      message: `${qualification.profile} requires at least ${minimumDuration} monotonic milliseconds`
    });
  }
  if (qualification.profile === "dvt_duty_cycle" && !receipt.campaign?.dutyCycleManifestSha256) {
    issues.push({
      path: "/campaign/dutyCycleManifestSha256",
      message: "dvt_duty_cycle requires a hashed duty-cycle manifest"
    });
  }
  if (receipt.campaign?.completedTurns < 10_000) {
    issues.push({
      path: "/campaign/completedTurns",
      message: "a passing hardware qualification requires at least 10,000 completed turns"
    });
  }

  requireMeasuredGroup(receipt.measurements?.capture, "/measurements/capture", issues);
  requireMeasuredGroup(receipt.measurements?.integrity, "/measurements/integrity", issues);
  requireMeasuredGroup(receipt.measurements?.latency, "/measurements/latency", issues);
  requireMeasuredGroup(receipt.measurements?.dutPower, "/measurements/dutPower", issues);
  requireMeasuredGroup(receipt.measurements?.dutThermal, "/measurements/dutThermal", issues);
  requireMeasuredGroup(receipt.fixture?.ambient, "/fixture/ambient", issues);
  requireMeasuredGroup(receipt.dut?.update, "/dut/update", issues);
  validateRequiredComponents(receipt.dut?.components, issues);

  if (
    receipt.privacy?.rawCapturedAudio === "external_access_controlled" ||
    receipt.privacy?.transcriptContent !== "omitted" ||
    receipt.privacy?.containsPersonalData !== false
  ) {
    issues.push({
      path: "/privacy",
      message: "a passing gate requires no retained raw audio, omitted transcript content, and no personal data"
    });
  }
}

function validateRequiredComponents(components, issues) {
  if (!Array.isArray(components)) {
    return;
  }
  const byRole = new Map();
  for (const [index, component] of components.entries()) {
    if (byRole.has(component?.role)) {
      issues.push({
        path: `/dut/components/${index}/role`,
        message: "component roles must be unique"
      });
    }
    byRole.set(component?.role, component);
  }

  for (const role of requiredIdentifiedComponents) {
    if (byRole.get(role)?.availability !== "identified") {
      issues.push({
        path: "/dut/components",
        message: `a passing gate requires identified ${role}`
      });
    }
  }
  for (const role of requiredDeclaredComponents) {
    if (!byRole.has(role)) {
      issues.push({
        path: "/dut/components",
        message: `a passing gate must identify or explicitly declare absent ${role}`
      });
    }
  }
}

function validateArtifactReferences(receipt, issues) {
  if (!Array.isArray(receipt.artifacts)) {
    return;
  }
  const paths = new Set();
  const hashes = new Set();
  for (const [index, artifact] of receipt.artifacts.entries()) {
    if (!artifact || typeof artifact !== "object") {
      continue;
    }
    if (!isSafeRelativePath(artifact.path)) {
      issues.push({
        path: `/artifacts/${index}/path`,
        message: "must be a normalized repository-relative path without traversal"
      });
    }
    if (paths.has(artifact.path)) {
      issues.push({
        path: `/artifacts/${index}/path`,
        message: "artifact paths must be unique"
      });
    }
    paths.add(artifact.path);
    hashes.add(artifact.sha256);
  }

  walk(receipt, "", (value, pointer, key) => {
    if (
      (key === "artifactSha256" ||
        key === "evidenceArtifactSha256" ||
        key === "traceArtifactSha256") &&
      typeof value === "string" &&
      !hashes.has(value)
    ) {
      issues.push({
        path: pointer,
        message: "must reference a declared artifact sha256"
      });
    }
  });

  const fixtureArtifacts = receipt.artifacts.filter(
    (artifact) => artifact?.role === "fixture_manifest"
  );
  const expectedFixtureHash = receipt.reproducibility?.source?.fixtureManifestSha256;
  if (
    typeof expectedFixtureHash === "string" &&
    !fixtureArtifacts.some((artifact) => artifact.sha256 === expectedFixtureHash)
  ) {
    issues.push({
      path: "/reproducibility/source/fixtureManifestSha256",
      message: "must match a declared fixture_manifest artifact"
    });
  }
  if (
    receipt.fixture?.kind === "synthetic" &&
    receipt.fixture.manifestSha256 !== expectedFixtureHash
  ) {
    issues.push({
      path: "/fixture/manifestSha256",
      message: "must match reproducibility.source.fixtureManifestSha256"
    });
  }

  const configurationHash = receipt.reproducibility?.source?.configurationSha256;
  if (
    typeof configurationHash === "string" &&
    !receipt.artifacts.some(
      (artifact) => artifact?.role === "configuration" && artifact.sha256 === configurationHash
    )
  ) {
    issues.push({
      path: "/reproducibility/source/configurationSha256",
      message: "must match a declared configuration artifact"
    });
  }
}

async function verifyReceiptArtifacts(artifacts, repositoryRoot, issues) {
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(repositoryRoot);
  } catch (error) {
    issues.push({
      path: "/artifacts",
      message: `cannot resolve repositoryRoot: ${errorMessage(error)}`
    });
    return;
  }

  await Promise.all(
    artifacts.map(async (artifact, index) => {
      if (!artifact || typeof artifact.path !== "string" || !isSafeRelativePath(artifact.path)) {
        return;
      }
      const candidate = path.resolve(canonicalRoot, artifact.path);
      if (!isInside(canonicalRoot, candidate)) {
        issues.push({
          path: `/artifacts/${index}/path`,
          message: "resolves outside repositoryRoot"
        });
        return;
      }

      try {
        const canonicalPath = await realpath(candidate);
        if (!isInside(canonicalRoot, canonicalPath)) {
          issues.push({
            path: `/artifacts/${index}/path`,
            message: "symlink resolves outside repositoryRoot"
          });
          return;
        }
        const [metadata, bytes] = await Promise.all([
          stat(canonicalPath),
          readFile(canonicalPath)
        ]);
        if (!metadata.isFile()) {
          issues.push({
            path: `/artifacts/${index}/path`,
            message: "must reference a regular file"
          });
          return;
        }
        if (bytes.byteLength !== artifact.byteSize) {
          issues.push({
            path: `/artifacts/${index}/byteSize`,
            message: `expected ${artifact.byteSize}, found ${bytes.byteLength}`
          });
        }
        const digest = sha256(bytes);
        if (digest !== artifact.sha256) {
          issues.push({
            path: `/artifacts/${index}/sha256`,
            message: `expected ${artifact.sha256}, found ${digest}`
          });
        }
      } catch (error) {
        issues.push({
          path: `/artifacts/${index}/path`,
          message: `cannot read artifact: ${errorMessage(error)}`
        });
      }
    })
  );
}

function requireMeasuredGroup(group, pointer, issues) {
  if (!group || typeof group !== "object") {
    return;
  }
  for (const [key, measurement] of Object.entries(group)) {
    if (measurement?.availability !== "measured") {
      issues.push({
        path: `${pointer}/${escapePointer(key)}`,
        message: "a passing gate requires a measured value"
      });
    }
  }
}

function hasMeasuredLeaf(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (value.availability === "measured") {
    return true;
  }
  return Object.values(value).some((child) => hasMeasuredLeaf(child));
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    return false;
  }
  if (value.includes("\\")) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && value !== ".." && !value.startsWith("../") && !value.includes("/../");
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function walk(value, pointer, visitor, key) {
  visitor(value, pointer || "/", key);
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, `${pointer}/${index}`, visitor, String(index)));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [childKey, child] of Object.entries(value)) {
    walk(child, `${pointer}/${escapePointer(childKey)}`, visitor, childKey);
  }
}

function escapePointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
