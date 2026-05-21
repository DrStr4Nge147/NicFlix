const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const filesToStage = [
  "package.json",
  "package-lock.json",
  "apps/client/package.json",
  "apps/server/package.json"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function updatePackageVersion(relativePath, version) {
  const pkg = readJson(relativePath);
  if (pkg.version !== version) {
    pkg.version = version;
    writeJson(relativePath, pkg);
    console.log(`Updated ${relativePath} to ${version}`);
  }
}

function updatePackageLock(version) {
  const lockPath = "package-lock.json";
  const lock = readJson(lockPath);

  lock.version = version;
  if (lock.packages?.[""]) {
    lock.packages[""].version = version;
  }
  if (lock.packages?.["apps/client"]) {
    lock.packages["apps/client"].version = version;
  }
  if (lock.packages?.["apps/server"]) {
    lock.packages["apps/server"].version = version;
  }

  writeJson(lockPath, lock);
  console.log(`Updated ${lockPath} workspace versions to ${version}`);
}

function stageVersionFiles() {
  if (process.env.npm_config_git_tag_version === "false") return;

  const result = spawnSync("git", ["add", ...filesToStage], {
    cwd: root,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const rootPackage = readJson("package.json");
const version = rootPackage.version;

updatePackageVersion("apps/client/package.json", version);
updatePackageVersion("apps/server/package.json", version);
updatePackageLock(version);

if (process.argv.includes("--stage")) {
  stageVersionFiles();
}
