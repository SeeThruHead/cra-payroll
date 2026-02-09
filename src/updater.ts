import { ok, err, type Result } from "neverthrow";
import { execSync } from "child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync, chmodSync } from "fs";
import { dirname, resolve } from "path";

const REPO = "SeeThruHead/cra-payroll";
const VERSION = "0.0.9";

export function currentVersion(): string {
  return VERSION;
}

interface ReleaseInfo {
  tag: string;
  version: string;
  downloadUrl: string;
}

function getTarget(): Result<string, string> {
  const os = process.platform;
  const arch = process.arch;

  if (os === "darwin" && arch === "arm64") return ok("cra-payroll-darwin-arm64");
  if (os === "darwin" && arch === "x64") return ok("cra-payroll-darwin-x64");
  if (os === "linux" && arch === "x64") return ok("cra-payroll-linux-x64");
  return err(`Unsupported platform: ${os}-${arch}`);
}

export async function checkForUpdate(): Promise<Result<ReleaseInfo | null, string>> {
  try {
    const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "Accept": "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return ok(null); // Can't check, don't block the user

    const data = await resp.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
    const latestTag = data.tag_name;
    const latestVersion = latestTag.replace(/^v/, "");

    if (!isNewer(latestVersion, VERSION)) return ok(null);

    const target = getTarget();
    if (target.isErr()) return ok(null);

    const asset = data.assets.find((a: any) => a.name === target.value);
    if (!asset) return ok(null);

    return ok({
      tag: latestTag,
      version: latestVersion,
      downloadUrl: asset.browser_download_url,
    });
  } catch {
    return ok(null); // Network error — don't block the user
  }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

export async function selfUpdate(): Promise<Result<string, string>> {
  console.log(`Current version: v${VERSION}`);
  console.log("Checking for updates...\n");

  const updateResult = await checkForUpdate();
  if (updateResult.isErr()) return err(updateResult.error);

  const update = updateResult.value;
  if (!update) {
    return ok(`Already on the latest version (v${VERSION})`);
  }

  console.log(`New version available: ${update.tag} (current: v${VERSION})`);
  console.log(`Downloading ${update.downloadUrl}...\n`);

  // Figure out where the current binary lives
  // Find the binary path
  let binaryPath = "";

  // Try process.execPath first (works for Bun compiled binaries)
  if (process.execPath && existsSync(process.execPath) && !process.execPath.endsWith("/bun")) {
    binaryPath = process.execPath;
  }

  // Fallback: which
  if (!binaryPath) {
    try {
      const which = execSync("which cra-payroll", { encoding: "utf-8" }).trim();
      if (which && existsSync(which)) binaryPath = which;
    } catch {}
  }

  if (!binaryPath) {
    return err("Can't find current binary path. Try reinstalling with the install script.");
  }

  return doUpdate(binaryPath, update);
}

function doUpdate(binaryPath: string, update: ReleaseInfo): Result<string, string> {
  const tmpPath = `${binaryPath}.update`;

  try {
    // Download
    execSync(`curl -fSL -o "${tmpPath}" "${update.downloadUrl}"`, { stdio: "inherit" });

    // Strip quarantine on macOS
    if (process.platform === "darwin") {
      try { execSync(`xattr -d com.apple.quarantine "${tmpPath}" 2>/dev/null`); } catch {}
    }

    // Make executable
    chmodSync(tmpPath, 0o755);

    // Replace current binary
    try {
      const backupPath = `${binaryPath}.bak`;
      renameSync(binaryPath, backupPath);
      renameSync(tmpPath, binaryPath);
      try { unlinkSync(backupPath); } catch {}
    } catch {
      // Might need sudo
      console.log("\nNeed sudo to replace binary...");
      execSync(`sudo mv "${tmpPath}" "${binaryPath}"`, { stdio: "inherit" });
    }

    return ok(`Updated to ${update.tag}! Run 'cra-payroll --version' to verify.`);
  } catch (e: any) {
    try { unlinkSync(tmpPath); } catch {}
    return err(`Update failed: ${e.message}`);
  }
}
