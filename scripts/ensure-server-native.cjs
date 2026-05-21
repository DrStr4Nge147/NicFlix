const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const serverRoot = path.join(repoRoot, "apps", "server");
const serverRequire = createRequire(path.join(serverRoot, "package.json"));
const serverNodeModules = path.join(serverRoot, "node_modules") + path.sep;

function isServerNativeReady() {
  try {
    const resolved = serverRequire.resolve("better-sqlite3");
    if (!resolved.startsWith(serverNodeModules)) return false;
    serverRequire("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}

if (isServerNativeReady()) {
  process.exit(0);
}

console.log("Preparing server native dependency for this Node version...");

const result = spawnSync(
  "npm.cmd",
  ["i", "better-sqlite3@12.10.0", "--no-save", "--workspaces=false", "--foreground-scripts"],
  {
    cwd: serverRoot,
    stdio: "inherit",
    windowsHide: true
  }
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

if (!isServerNativeReady()) {
  console.error("Server native dependency is still not available from apps/server/node_modules.");
  process.exit(1);
}
