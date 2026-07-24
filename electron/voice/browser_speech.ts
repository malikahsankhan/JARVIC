import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { app } from "electron";
import { VoiceWebSocketServer } from "./websocket_server";
import type { BrowserSpeechEvent, BrowserTranscript } from "./types";

type SystemBrowser = { name: "chrome" | "msedge"; exePath: string };

function findSystemBrowser(): SystemBrowser | null {
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local");
  const candidates: SystemBrowser[] = [
    { name: "chrome", exePath: path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe") },
    { name: "chrome", exePath: path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe") },
    { name: "chrome", exePath: path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") },
    { name: "msedge", exePath: path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe") },
    { name: "msedge", exePath: path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe") },
  ];
  return candidates.find((candidate) => fs.existsSync(candidate.exePath)) ?? null;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForCdp(cdpUrl: string, browserProcess: ChildProcess): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Browser exited before opening debug endpoint (exit code ${browserProcess.exitCode}).`);
    }
    try {
      const res = await fetch(`${cdpUrl}/json/version`);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for browser debug endpoint at ${cdpUrl}`);
}

export class BrowserSpeechService extends EventEmitter {
  private readonly server: VoiceWebSocketServer;
  private browserContext: any = null;
  private page: any = null;
  private browserProcess: ChildProcess | null = null;
  private started = false;
  private shuttingDown = false;
  private relaunchTimer: NodeJS.Timeout | null = null;

  constructor(port = 0) {
    super();
    this.server = new VoiceWebSocketServer(port, path.join(app.getAppPath(), "electron", "voice"));
    this.server.on("connected", () => this.emit("connected"));
    this.server.on("disconnected", () => this.emit("disconnected"));
    this.server.on("event", (event: BrowserSpeechEvent) => this.handleBrowserEvent(event));
  }

  get clientUrl(): string {
    return this.server.url;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.shuttingDown = false;
    await this.server.start();
    await this.launchChrome();
  }

  startRecognition(reason: "manual" | "barge-in" = "manual"): void {
    this.clickSpeechControl("#startButton").catch((err) => {
      this.emit("error", `Could not click browser speech start button: ${err?.message ?? err}`);
      this.server.send({ type: "start", reason });
    });
  }

  stopRecognition(): void {
    this.clickSpeechControl("#stopButton").catch(() => {
      this.server.send({ type: "stop" });
    });
  }

  private async clickSpeechControl(selector: "#startButton" | "#stopButton"): Promise<void> {
    if (!this.page || this.page.isClosed?.()) {
      throw new Error("speech page is not ready");
    }
    await this.page.bringToFront().catch(() => {});
    await this.page.click(selector, { timeout: 2_000 });
  }

  startRecognitionViaSocket(reason: "manual" | "barge-in" = "manual"): void {
    this.server.send({ type: "start", reason });
  }

  stopRecognitionViaSocket(): void {
    this.server.send({ type: "stop" });
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    this.started = false;
    if (this.relaunchTimer) clearTimeout(this.relaunchTimer);
    this.relaunchTimer = null;
    this.stopRecognition();
    try {
      await this.browserContext?.browser?.()?.close?.();
    } catch {}
    try {
      await this.browserContext?.close?.();
    } catch {}
    try {
      this.browserProcess?.kill?.();
    } catch {}
    this.browserProcess = null;
    this.browserContext = null;
    this.page = null;
    await this.server.stop();
  }

  private async launchChrome(): Promise<void> {
    if (this.shuttingDown) return;

    let playwright: any;
    try {
      playwright = require("playwright");
    } catch (err: any) {
      this.emit("error", `Playwright unavailable: ${err?.message ?? err}`);
      return;
    }

    try {
      this.browserProcess?.kill?.();
    } catch {}
    this.browserProcess = null;

    const profileDir = path.join(
      app.getPath("userData"),
      "JarvicBrowserSpeechProfiles",
      `${Date.now()}-${Math.round(Math.random() * 1e6)}`
    );
    fs.mkdirSync(profileDir, { recursive: true });

    try {
      const browser = findSystemBrowser();
      if (!browser) {
        this.emit("error", "Google Chrome or Microsoft Edge was not found. Browser speech recognition needs a real system browser.");
        return;
      }
      const remoteDebuggingPort = await getFreePort();
      this.browserProcess = spawn(browser.exePath, [
        `--remote-debugging-port=${remoteDebuggingPort}`,
        `--user-data-dir=${profileDir}`,
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate,OptimizationHints",
        "--window-position=80,80",
        "--window-size=480,320",
        "about:blank",
      ], {
        detached: false,
        stdio: "ignore",
        windowsHide: false,
      });

      this.browserProcess.once("exit", () => {
        this.browserProcess = null;
        this.scheduleRelaunch("browser process exited");
      });

      const cdpUrl = `http://127.0.0.1:${remoteDebuggingPort}`;
      await waitForCdp(cdpUrl, this.browserProcess);
      const connectedBrowser = await playwright.chromium.connectOverCDP(cdpUrl);
      this.browserContext = connectedBrowser.contexts()[0] || (await connectedBrowser.newContext());

      await this.browserContext.grantPermissions(["microphone"], { origin: `http://127.0.0.1:${this.server.port}` }).catch(() => {});
      this.page = this.browserContext.pages()[0] || (await this.browserContext.newPage());
      this.page.on("console", (message: any) => console.log(`[BrowserSpeech:${message.type()}] ${message.text()}`));
      this.page.on("crash", () => this.scheduleRelaunch("page crashed"));
      this.page.on("close", () => this.scheduleRelaunch("page closed"));
      this.browserContext.on("close", () => this.scheduleRelaunch("context closed"));
      await this.page.goto(this.clientUrl, { waitUntil: "domcontentloaded" });
      console.log(`[VoiceManager] Browser speech running in system ${browser.name}`);
      this.emit("launched", this.clientUrl);
    } catch (err: any) {
      this.emit("error", `Failed to launch browser speech client: ${err?.message ?? err}`);
      this.scheduleRelaunch("launch failed");
    }
  }

  private scheduleRelaunch(reason: string): void {
    if (this.shuttingDown || this.relaunchTimer) return;
    this.browserContext = null;
    this.page = null;
    try {
      this.browserProcess?.kill?.();
    } catch {}
    this.browserProcess = null;
    this.emit("relaunching", reason);
    this.relaunchTimer = setTimeout(() => {
      this.relaunchTimer = null;
      this.launchChrome().catch((err) => this.emit("error", String(err)));
    }, 2_000);
  }

  private handleBrowserEvent(event: BrowserSpeechEvent): void {
    if (event.type === "ready") this.emit("ready");
    else if (event.type === "speech-start") this.emit("speech-start");
    else if (event.type === "partial") this.emit("partial", event.text);
    else if (event.type === "final") this.emit("transcript", { text: event.text, confidence: event.confidence, final: true } satisfies BrowserTranscript);
    else if (event.type === "stopped") this.emit("stopped", event.reason ?? "stopped");
    else if (event.type === "error") this.emit("error", event.error);
  }
}
