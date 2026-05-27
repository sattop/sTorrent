import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowlistPath = path.join(rootDir, "security", "audit-allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const acceptedRisks = allowlist.acceptedRisks ?? [];

const auditCommand = process.platform === "win32" ? "cmd.exe" : "npm";
const auditArgs =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npm audit --json"]
    : ["audit", "--json"];
const audit = spawnSync(auditCommand, auditArgs, {
  cwd: rootDir,
  encoding: "utf8"
});

if (audit.error) {
  throw audit.error;
}

const report = JSON.parse(audit.stdout || "{}");
const vulnerabilities = report.vulnerabilities ?? {};
const blocking = [];
const accepted = [];

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  const matchingRisk = findAcceptedRisk(name, vulnerability, vulnerabilities);

  if (matchingRisk) {
    accepted.push(`${name} (${matchingRisk.id})`);
  } else {
    blocking.push({
      name,
      severity: vulnerability.severity,
      via: vulnerability.via
    });
  }
}

if (blocking.length > 0) {
  console.error("npm audit found vulnerabilities outside the accepted-risk allowlist:");
  for (const item of blocking) {
    console.error(`- ${item.name} [${item.severity}] via ${formatVia(item.via)}`);
  }
  process.exit(1);
}

if (accepted.length > 0) {
  console.log("npm audit passed with explicit accepted risks:");
  for (const item of accepted) {
    console.log(`- ${item}`);
  }
} else {
  console.log("npm audit passed with no vulnerabilities.");
}

function findAcceptedRisk(name, vulnerability, vulnerabilities) {
  const advisorySources = collectAdvisorySources(
    name,
    vulnerability,
    vulnerabilities,
    new Set()
  );

  if (advisorySources.length === 0) {
    return null;
  }

  return acceptedRisks.find((risk) => {
    const packages = new Set(risk.packages ?? []);

    return (
      packages.has(name) &&
      advisorySources.every((advisory) => isRiskMatch(risk, advisory))
    );
  }) ?? null;
}

function collectAdvisorySources(name, vulnerability, vulnerabilities, seen) {
  if (seen.has(name)) {
    return [];
  }

  seen.add(name);

  const sources = [];

  for (const via of vulnerability.via ?? []) {
    if (typeof via === "string") {
      const nested = vulnerabilities[via];

      if (nested) {
        sources.push(
          ...collectAdvisorySources(via, nested, vulnerabilities, seen)
        );
      }
      continue;
    }

    sources.push({
      id: getAdvisoryId(via),
      source: via.source,
      severity: via.severity
    });
  }

  return sources;
}

function getAdvisoryId(via) {
  return typeof via.url === "string" ? via.url.split("/").at(-1) : String(via.source);
}

function isRiskMatch(risk, advisory) {
  return (
    String(risk.id) === String(advisory.id) &&
    Number(risk.source) === Number(advisory.source) &&
    String(risk.severity) === String(advisory.severity)
  );
}

function formatVia(via) {
  return (via ?? [])
    .map((item) => (typeof item === "string" ? item : getAdvisoryId(item)))
    .join(", ");
}
