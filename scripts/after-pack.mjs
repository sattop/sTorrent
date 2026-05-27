import { readFile } from "node:fs/promises";
import path from "node:path";
import { rcedit } from "rcedit";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const projectDir = context.packager.projectDir;
  const packageJson = JSON.parse(
    await readFile(path.join(projectDir, "package.json"), "utf8")
  );
  const appInfo = context.packager.appInfo;
  const productName = appInfo.productName || packageJson.build?.productName;
  const executableName = `${appInfo.productFilename}.exe`;

  await rcedit(path.join(context.appOutDir, executableName), {
    icon: path.join(projectDir, "assets", "icon.ico"),
    "file-version": toWindowsVersion(packageJson.version),
    "product-version": toWindowsVersion(packageJson.version),
    "requested-execution-level": "asInvoker",
    "version-string": {
      CompanyName: getAuthorName(packageJson.author),
      FileDescription: packageJson.description,
      FileVersion: packageJson.version,
      InternalName: appInfo.productFilename,
      LegalCopyright: packageJson.copyright,
      OriginalFilename: executableName,
      ProductName: productName,
      ProductVersion: packageJson.version
    }
  });
}

function getAuthorName(author) {
  if (typeof author === "string") {
    return author;
  }

  return author?.name || "sTorent contributors";
}

function toWindowsVersion(version) {
  const parts = String(version)
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isInteger(part));

  while (parts.length < 4) {
    parts.push(0);
  }

  return parts.slice(0, 4).join(".");
}
