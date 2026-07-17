import dotenv from "dotenv";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "path";
import http from "http";
import { fork, ChildProcess } from "child_process";
import { registerIpcHandlers } from "./ipc/handlers";
import { openUrlInMediaWindow } from "./mediaWindow";
import "./tools"; // side-effect: registers every tool module into the registry
import "./tools/audio";

dotenv.config();

const isDev = process.env.NODE_ENV !== "production";
const SERVER_URL = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Local server lifecycle
// ---------------------------------------------------------------------------
// In dev, `npm run electron:dev` already runs `tsx server.ts` alongside us —
// we just wait for it. In a packaged/production build there is no separate
// process managing this, so JARVIC owns starting and stopping its own local
// server (the bundled dist/server.cjs) as a child process.
let serverProcess: ChildProcess | null = null;

function startBundledServer(): void {
  if (isDev) return; // dev server is started externally by the npm script

  const serverEntry = path.join(app.getAppPath(), "dist", "server.cjs");

  serverProcess = fork(serverEntry, [], {
    env: {
      ...process.env,
      WHISPER_DIR: path.join(process.resourcesPath, "whisper"),
      NODE_ENV: "production",
    },
    silent: true,
  });

  serverProcess.stdout?.on("data", (chunk) => console.log(`[server] ${chunk}`.trimEnd()));
  serverProcess.stderr?.on("data", (chunk) => console.error(`[server] ${chunk}`.trimEnd()));

  serverProcess.on("exit", (code) => {
    console.log(`JARVIC local server exited with code ${code}`);
    serverProcess = null;
  });
}

function stopBundledServer(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Single instance lock — prevent multiple JARVIC processes from running
// against the same local server / desktop tools at once.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let miniWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Floating mini-widget (appears when main window is minimized)
// ---------------------------------------------------------------------------
const MINI_WIDTH = 360;
const MINI_HEIGHT = 52;
const MINI_MARGIN = 16;

function getMiniHtmlPath(): string {
  // In development, mini.html lives next to main.ts source.
  // In production, it's alongside the packaged main.cjs.
  return path.join(app.getAppPath(), "electron", "mini.html");
}

function createMiniWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) return;

  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;
  const x = screenW - MINI_WIDTH - MINI_MARGIN;
  const y = screenH - MINI_HEIGHT - MINI_MARGIN;

  miniWindow = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload-mini.cjs"),
    },
  });

  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  miniWindow.loadFile(getMiniHtmlPath());

  miniWindow.on("closed", () => {
    miniWindow = null;
  });

  console.log("[JARVIC] Mini-widget created.");
}

function showMiniWidget(): void {
  if (!miniWindow || miniWindow.isDestroyed()) {
    createMiniWindow();
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.show();
    miniWindow.moveTop();
  }
}

function hideMiniWidget(): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.hide();
  }
}

function destroyMiniWidget(): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.close();
  }
  miniWindow = null;
}

// ---------------------------------------------------------------------------
// IPC: forward actions between mini-widget and main renderer
// ---------------------------------------------------------------------------
function registerMiniIpc(): void {
  // Mini widget → main renderer
  ipcMain.on("jarvic:mini-action", (_event, action: string, payload?: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("jarvic:from-mini", { action, payload });
    }
  });

  // Main renderer → mini widget (state updates)
  ipcMain.on("jarvic:mini-state", (_event, state: string, transcript?: string) => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send("jarvic:mini-state", state, transcript);
    }
  });

  // Mini widget requests main window restore
  ipcMain.on("jarvic:mini-restore", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // restore() brings window out of minimized state, show() makes it visible,
      // focus() brings it to the foreground.
      mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
    hideMiniWidget();
  });
}

/** Poll the local server until it responds, then resolve. */
function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#020617",
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      // --- security requirements ---
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  console.log("[JARVIC] BrowserWindow created. Bounds:", mainWindow.getBounds());

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[JARVIC] Renderer finished loading.");
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[JARVIC] Renderer process gone:", details);
  });

  mainWindow.on("unresponsive", () => {
    console.error("[JARVIC] Window became unresponsive.");
  });

  // Any attempt to open a new window (target=_blank, window.open) is handed
  // to JARVIC's own controlled BrowserWindow instead of the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openUrlInMediaWindow(url).catch((err) => console.error("Failed to open URL in media window:", err));
    return { action: "deny" };
  });

  // Block in-page navigation away from our own local server.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(SERVER_URL)) {
      event.preventDefault();
      openUrlInMediaWindow(url).catch((err) => console.error("Failed to open URL in media window:", err));
    }
  });

  try {
    await waitForServer(SERVER_URL);
    await mainWindow.loadURL(SERVER_URL);
    console.log("[JARVIC] loadURL resolved successfully.");
  } catch (err) {
    console.error("JARVIC local server did not become available:", err);
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
  console.log("[JARVIC] show()/focus()/moveTop() called. isVisible:", mainWindow.isVisible(), "bounds:", mainWindow.getBounds());

  mainWindow.on("closed", () => {
    mainWindow = null;
    destroyMiniWidget();
  });

  // ── Show floating mini-widget when main window is minimized ──────────────
  mainWindow.on("minimize", () => {
    // Hide from taskbar so only the floating mini-widget remains visible
    mainWindow?.hide();
    showMiniWidget();
  });

  mainWindow.on("restore", () => {
    hideMiniWidget();
  });

  mainWindow.on("close", () => {
    destroyMiniWidget();
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  registerMiniIpc();
  startBundledServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  destroyMiniWidget();
  stopBundledServer();
});

app.on("will-quit", () => {
  destroyMiniWidget();
  stopBundledServer();
});