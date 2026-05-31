import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inputFiles = process.argv.slice(2);
const files = inputFiles.length > 0
  ? inputFiles
  : [
      "release/sTorent-Setup.exe"
    ];

if (process.platform !== "win32") {
  console.error("Windows signature verification must run on Windows.");
  process.exit(1);
}

let hasFailure = false;

for (const file of files) {
  const filePath = path.isAbsolute(file) ? file : path.join(rootDir, file);
  const signature = getAuthenticodeSignature(filePath);
  const relativePath = path.relative(rootDir, filePath);

  if (signature.Status !== "Valid") {
    hasFailure = true;
    console.error(
      `${relativePath} is not a valid signed Windows binary: ${signature.Status}`
    );

    if (signature.StatusMessage) {
      console.error(signature.StatusMessage);
    }

    continue;
  }

  console.log(
    `${relativePath} is signed by ${signature.Subject} (${signature.Thumbprint}).`
  );
}

if (hasFailure) {
  process.exit(1);
}

function getAuthenticodeSignature(filePath) {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$path = [System.IO.Path]::GetFullPath($env:SIGNATURE_FILE_PATH)
if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
  throw "Missing file: $path"
}

$signature = Get-AuthenticodeSignature -LiteralPath $path
$certificate = $signature.SignerCertificate
[pscustomobject]@{
  Path = $path
  Status = [string]$signature.Status
  StatusMessage = [string]$signature.StatusMessage
  Subject = if ($certificate) { [string]$certificate.Subject } else { "" }
  Thumbprint = if ($certificate) { [string]$certificate.Thumbprint } else { "" }
  NotAfter = if ($certificate) { $certificate.NotAfter.ToString("o") } else { "" }
} | ConvertTo-Json -Compress
`;

  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SIGNATURE_FILE_PATH: filePath
      },
      windowsHide: true
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim());
  }

  return JSON.parse(result.stdout.trim());
}
