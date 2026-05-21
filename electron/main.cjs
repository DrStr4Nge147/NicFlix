const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const { app, dialog, Menu, nativeImage, shell, Tray } = require("electron");

const APP_PORT = Number(process.env.PORT || 4000);
const APP_URL = `http://localhost:${APP_PORT}`;

let tray = null;
let server = null;
let isQuitting = false;

function logStartup(message, error) {
  try {
    const logPath = path.join(app.getPath("userData"), "startup.log");
    const detail = error ? `\n${error?.stack || error?.message || String(error)}` : "";
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`);
  } catch {
    // Startup logging must never be allowed to break the tray app.
  }
}

function createTrayIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "..", "build", "icon.ico");

  if (fs.existsSync(iconPath)) {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon.resize({ width: 16, height: 16 });
    }
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <g transform="scale(1.3333333)" fill="none" stroke="#e63b3b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2"/>
        <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>
      </g>
    </svg>
  `;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function openNicFlix() {
  shell.openExternal(APP_URL);
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Open NicFlix", click: openNicFlix },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          path: process.execPath
        });
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("NicFlix");
  tray.setContextMenu(buildTrayMenu());
  tray.on("double-click", openNicFlix);
}

function configureRuntimePaths() {
  const dataRoot = path.join(app.getPath("userData"), "data");
  process.env.PORT = String(APP_PORT);
  process.env.DATA_ROOT = dataRoot;
  process.env.DATABASE_PATH = path.join(dataRoot, "app.db");
  process.env.CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

  if (app.isPackaged) {
    process.env.FFMPEG_PATH = path.join(process.resourcesPath, "bin", "ffmpeg.exe");
    process.env.FFPROBE_PATH = path.join(process.resourcesPath, "bin", "ffprobe.exe");
  }
}

async function startNicFlixServer() {
  configureRuntimePaths();
  const serverEntry = pathToFileURL(path.join(__dirname, "..", "apps", "server", "src", "index.js")).href;
  const serverModule = await import(serverEntry);
  server = await serverModule.startServer();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", openNicFlix);

  app.whenReady().then(async () => {
    try {
      logStartup("Electron ready");
      createTray();
      logStartup("Tray created");
      await startNicFlixServer();
      logStartup(`Server started on ${APP_URL}`);
      if (process.env.NICFLIX_NO_OPEN !== "1") {
        openNicFlix();
      }
    } catch (error) {
      logStartup("Startup failed", error);
      dialog.showErrorBox("NicFlix failed to start", error?.message || String(error));
      app.quit();
    }
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", (event) => {
  if (!isQuitting) event.preventDefault();
});

app.on("quit", () => {
  if (server) {
    server.close();
  }
});
