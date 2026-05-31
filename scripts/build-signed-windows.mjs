import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.error("Signed Windows installer builds must run on Windows.");
  process.exit(1);
}

if (!hasValue(process.env.WIN_CSC_LINK) && !hasValue(process.env.CSC_LINK)) {
  console.error(
    "WIN_CSC_LINK is required to build a signed Windows installer."
  );
  process.exit(1);
}

const signToolPath = hasValue(process.env.SIGNTOOL_PATH)
  ? process.env.SIGNTOOL_PATH
  : locateSignTool();

console.log(`Using signtool: ${signToolPath}`);

const env = {
  ...process.env,
  SIGNTOOL_PATH: signToolPath
};

runNpm(["run", "build:windows"], env);
runNpm(["run", "release:verify-signatures"], env);

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function runNpm(args, env) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function locateSignTool() {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$roots = @(
  "$env:ProgramFiles(x86)\\Windows Kits\\10\\bin",
  "$env:ProgramFiles\\Windows Kits\\10\\bin"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$tools = foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue
}

$signtool = $tools |
  Where-Object { $_.FullName -match '\\\\x64\\\\signtool\\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1

if (-not $signtool) {
  $signtool = $tools | Sort-Object FullName -Descending | Select-Object -First 1
}

if (-not $signtool) {
  throw "signtool.exe was not found in the Windows SDK. Install the Windows SDK or set SIGNTOOL_PATH."
}

$signtool.FullName
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
      windowsHide: true
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout).trim());
  }

  return result.stdout.trim();
}
