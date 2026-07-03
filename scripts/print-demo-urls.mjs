import os from "node:os";

const webPort = process.env.VITE_PORT ?? process.env.WEB_PORT ?? "5173";
const serverPort = process.env.PORT ?? process.env.SERVER_PORT ?? "4317";
const candidates = getNetworkAddresses();

if (candidates.length === 0) {
  console.log("No LAN IPv4 address found.");
  console.log(`Laptop preview: http://localhost:${webPort}/`);
  console.log(`Device preview: http://localhost:${webPort}/?mode=device`);
  console.log(`Server health:  http://localhost:${serverPort}/health`);
  process.exit(0);
}

const primary = candidates[0];

console.log(`Laptop preview: http://${primary.address}:${webPort}/`);
console.log(`Pi kiosk URL:   http://${primary.address}:${webPort}/?mode=device`);
console.log(`Showcase stage: http://${primary.address}:${webPort}/showcase.html`);
console.log(`Server health:  http://${primary.address}:${serverPort}/health`);
console.log(`API base:       http://${primary.address}:${serverPort}`);

if (candidates.length > 1) {
  console.log("");
  console.log("Other possible addresses:");

  for (const candidate of candidates.slice(1)) {
    console.log(`- ${candidate.name}: http://${candidate.address}:${webPort}/?mode=device`);
  }
}

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      addresses.push({
        name,
        address: entry.address,
        score: scoreInterface(name, entry.address),
      });
    }
  }

  return addresses.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function scoreInterface(name, address) {
  let score = 0;

  if (name === "en0") {
    score += 40;
  }

  if (name.startsWith("en")) {
    score += 20;
  }

  if (name.startsWith("bridge") || name.startsWith("utun") || name.startsWith("awdl")) {
    score -= 30;
  }

  if (address.startsWith("192.168.") || address.startsWith("10.") || address.startsWith("172.")) {
    score += 10;
  }

  return score;
}
