import dotenv from "dotenv";
import { app, BrowserWindow, shell } from "electron";
import path from "path";
import http from "http";
import { fork, ChildProcess } from "child_process";
import { registerIpcHandlers } from "./ipc/handlers";
import "./tools"; // side-effect: registers every tool module into the registry

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
  // to the OS default browser instead of spawning an unmanaged BrowserWindow.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Block in-page navigation away from our own local server.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(SERVER_URL)) {
      event.preventDefault();
      shell.openExternal(url);
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
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
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
  stopBundledServer();
});

app.on("will-quit", () => {
  stopBundledServer();
});