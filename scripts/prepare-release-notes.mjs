import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(rootDir, "release");
const changelogPath = path.join(rootDir, "CHANGELOG.md");
const packageJson = JSON.parse(
  await readFile(path.join(rootDir, "package.json"), "utf8")
);

const rawTag = process.argv[2] || process.env.GITHUB_REF_NAME || `v${packageJson.version}`;
const tag = rawTag.startsWith("v") ? rawTag : `v${rawTag}`;
const version = tag.slice(1);
const changelog = await readFile(changelogPath, "utf8");
const notes = extractVersionNotes(changelog, version);

if (!notes) {
  console.error(`CHANGELOG.md does not contain release notes for ${version}.`);
  process.exit(1);
}

await mkdir(releaseDir, { recursive: true });
await writeFile(
  path.join(releaseDir, "RELEASE_NOTES.md"),
  `# sTorent ${tag}\n\n${notes.trim()}\n`,
  "utf8"
);

console.log(`Prepared release notes for ${tag}.`);

function extractVersionNotes(changelogText, versionNumber) {
  const lines = changelogText.split(/\r?\n/);
  const escapedVersion = escapeRegExp(versionNumber);
  const headingPattern = new RegExp(`^##\\s+\\[?${escapedVersion}\\]?(?:\\s+-\\s+.*)?$`);
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));

  if (start === -1) {
    return "";
  }

  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end).join("\n").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
