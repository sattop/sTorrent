import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(rootDir, "release");
const installerName = "sTorent Setup.exe";
const installerPath = path.join(releaseDir, installerName);
const checksumPath = path.join(releaseDir, "SHA256SUMS.txt");
const blockedReleasePatterns = [
  /\.torrent$/i,
  /\.fastresume$/i,
  /\.resume$/i,
  /\.log$/i,
  /^\.env(?:\.|$)/i,
  /\.(?:pem|key|pfx|p12)$/i
];

const installer = await readFile(installerPath).catch((error) => {
  if (error.code === "ENOENT") {
    console.error(`Missing expected installer: ${path.relative(rootDir, installerPath)}`);
    process.exit(1);
  }

  throw error;
});

const hash = createHash("sha256").update(installer).digest("hex");
const checksumLine = `${hash}  ${installerName}`;

await writeFile(checksumPath, `${checksumLine}\n`, "utf8");

const savedChecksum = (await readFile(checksumPath, "utf8")).trim();

if (savedChecksum !== checksumLine) {
  console.error("SHA256SUMS.txt does not match the generated installer checksum.");
  process.exit(1);
}

const blockedFiles = await findBlockedReleaseFiles(releaseDir);

if (blockedFiles.length > 0) {
  console.error("Release output contains blocked user-data or secret file types:");
  for (const file of blockedFiles) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`Wrote SHA256SUMS.txt for ${installerName}: ${hash}`);

async function findBlockedReleaseFiles(directory) {
  const found = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(rootDir, fullPath);

    if (blockedReleasePatterns.some((pattern) => pattern.test(entry.name))) {
      found.push(relativePath);
    }

    if (entry.isDirectory()) {
      found.push(...await findBlockedReleaseFiles(fullPath));
    }
  }

  return found;
}
