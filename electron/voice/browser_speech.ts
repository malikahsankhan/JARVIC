import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { VoiceWebSocketServer } from "./websocket_server";
import type { BrowserSpeechEvent, BrowserTranscript } from "./types";

export class BrowserSpeechService extends EventEmitter {
  private readonly server: VoiceWebSocketServer;
  private browserContext: any = null;
  private page: any = null;
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
    this.server.send({ type: "start", reason });
  }

  stopRecognition(): void {
    this.server.send({ type: "stop" });
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    this.started = false;
    if (this.relaunchTimer) clearTimeout(this.relaunchTimer);
    this.relaunchTimer = null;
    this.stopRecognition();
    try {
      await this.browserContext?.close?.();
    } catch {}
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

    const profileDir = path.join(app.getPath("userData"), "JarvicBrowserSpeechProfile");
    fs.mkdirSync(profileDir, { recursive: true });
    const launchOptions = {
      headless: true,
      args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-sandbox", "--disable-setuid-sandbox"],
    };

    try {
      try {
        this.browserContext = await playwright.chromium.launchPersistentContext(profileDir, { ...launchOptions, channel: "chrome" });
      } catch {
        this.browserContext = await playwright.chromium.launchPersistentContext(profileDir, launchOptions);
      }

      await this.browserContext.grantPermissions(["microphone"], { origin: `http://127.0.0.1:${this.server.port}` }).catch(() => {});
      this.page = this.browserContext.pages()[0] || (await this.browserContext.newPage());
      this.page.on("crash", () => this.scheduleRelaunch("page crashed"));
      this.page.on("close", () => this.scheduleRelaunch("page closed"));
      this.browserContext.on("close", () => this.scheduleRelaunch("context closed"));
      await this.page.goto(this.clientUrl, { waitUntil: "domcontentloaded" });
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
