#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const contractVersion = "jiko_systemd_contract_v1";
const here = path.dirname(fileURLToPath(import.meta.url));

export async function validateUnits(root = here) {
  const files = {
    server: path.join(root, "system/jiko-server.service"),
    probe: path.join(root, "system/jiko-server-probe.service"),
    timer: path.join(root, "system/jiko-server-probe.timer"),
    web: path.join(root, "system/jiko-web.service"),
    device: path.join(root, "system/jiko-device.service"),
    kiosk: path.join(root, "user/jiko-kiosk.service")
  };
  const contents = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, filePath]) => [name, await readFile(filePath, "utf8")])
    )
  );
  const checks = [];
  const check = (id, passed, detail) => {
    checks.push({ id, status: passed ? "pass" : "fail", detail });
  };

  for (const [name, content] of Object.entries(contents)) {
    check(
      `${name}-version`,
      content.startsWith("# Contract: jiko_systemd_v1\n"),
      `${name} declares jiko_systemd_v1.`
    );
  }

  check(
    "server-built-artifact",
    /^ExecStart=\/usr\/bin\/node \/opt\/jiko\/current\/apps\/server\/dist\/index\.js$/m.test(contents.server),
    "Server starts the prebuilt artifact."
  );
  check(
    "server-no-build-at-start",
    !/^ExecStart=.*\b(?:pnpm|npm|npx|tsc|vite)\b/m.test(contents.server),
    "Server does not compile or invoke a package manager at boot."
  );
  check(
    "server-loopback",
    contents.server.includes("Environment=HOST=127.0.0.1") &&
      contents.server.includes("IPAddressDeny=any") &&
      contents.server.includes("IPAddressAllow=localhost"),
    "Unauthenticated HTTP is confined to loopback."
  );
  check(
    "server-restart-bound",
    contents.server.includes("Restart=on-failure") &&
      contents.server.includes("StartLimitBurst=5") &&
      contents.server.includes("KillMode=mixed") &&
      contents.server.includes("TimeoutStopSec=10"),
    "Crash restart and shutdown escalation are bounded."
  );
  check(
    "server-state-boundary",
    contents.server.includes("StateDirectory=jiko") &&
      contents.server.includes("ReadWritePaths=/var/lib/jiko") &&
      contents.server.includes("runtime-preflight.mjs server"),
    "Mutable state is outside the release tree and preflighted."
  );
  check(
    "server-readiness",
    /^ExecStartPost=.*JIKO_PROBE_TIMEOUT_MS=75000 .*runtime-probe\.mjs server$/m.test(contents.server) &&
      contents.server.includes("TimeoutStartSec=90"),
    "Activation waits for the strict readiness probe."
  );
  check(
    "server-hardening",
    [
      "NoNewPrivileges=true",
      "PrivateTmp=true",
      "ProtectSystem=strict",
      "ProtectHome=true",
      "ProtectKernelTunables=true",
      "ProtectKernelModules=true",
      "ProtectControlGroups=true",
      "CapabilityBoundingSet="
    ].every((directive) => contents.server.includes(directive)),
    "Server carries the minimum checked hardening set."
  );
  check(
    "periodic-readiness",
    contents.timer.includes("OnUnitActiveSec=30s") &&
      contents.timer.includes("Unit=jiko-server-probe.service") &&
      contents.probe.includes("runtime-probe.mjs server"),
    "A timer records continuing readiness without an automatic restart loop."
  );
  check(
    "web-built-shell",
    /^ExecStart=\/usr\/bin\/python3 -m http\.server 4173 --bind 127\.0\.0\.1 /m.test(contents.web) &&
      !/^ExecStart=.*\b(?:pnpm|npm|npx|vite)\b/m.test(contents.web),
    "Web service serves only the prebuilt loopback shell."
  );
  check(
    "device-independent-lifecycle",
    contents.device.includes("After=jiko-server.service") &&
      contents.device.includes("Wants=jiko-server.service") &&
      !contents.device.includes("Requires=jiko-server.service") &&
      !contents.device.includes("PartOf=jiko-server.service"),
    "The device adapter starts after the server when possible but survives server failure/restart."
  );
  check(
    "device-clean-stop",
    contents.device.includes("KillSignal=SIGINT") &&
      contents.device.includes("TimeoutStopSec=10") &&
      contents.device.includes("KillMode=mixed"),
    "The current Python adapter receives its handled interrupt before escalation."
  );
  check(
    "kiosk-session-boundary",
    contents.kiosk.includes("After=graphical-session.target") &&
      contents.kiosk.includes("runtime-probe.mjs server") &&
      contents.kiosk.includes("runtime-probe.mjs web") &&
      contents.kiosk.includes("Restart=always") &&
      !contents.kiosk.includes("--no-sandbox"),
    "Kiosk remains a graphical user service and keeps the Chromium sandbox enabled."
  );

  return {
    schemaVersion: contractVersion,
    outcome: checks.every((entry) => entry.status === "pass") ? "pass" : "fail",
    checks
  };
}

async function main() {
  try {
    const result = await validateUnits();
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (result.outcome === "pass") {
      process.stdout.write(output);
      return;
    }
    process.stderr.write(output);
    process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
