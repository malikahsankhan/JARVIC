/**
 * electron/voice/browserSpeechEngine.ts
 *
 * Automated Browser Speech Engine (Layer 1 / Primary of the Hybrid Speech Recognition System).
 *
 * Architecture & Automated Flow:
 * 1. Jarvic starts → BrowserSpeechEngine finds an available port dynamically (default 8765+).
 * 2. Starts dedicated HTTP + WebSocket bridge server on the selected port.
 * 3. Launches hidden/headless Chrome browser using Playwright automatically.
 * 4. Loads the speech client page passing the dynamic WebSocket port automatically via location.host.
 * 5. Client page connects to WebSocket automatically without any manual configuration.
 * 6. Client auto-reconnects if WebSocket drops or server restarts.
 * 7. Playwright auto-relaunches if browser process or page crashes or closes.
 * 8. Recognized text → WebSocket → SpeechRouter → VoiceManager → AI Planner.
 */

import { EventEmitter } from "events";
import http from "http";
import path from "path";
import fs from "fs";
import { app } from "electron";

const HEARTBEAT_TIMEOUT_MS = 12_000;

const CLIENT_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>JARVIC Automated Speech Bridge</title>
<style>
  body { background:#020617; color:#7dd3fc; font-family: monospace; display:flex; flex-direction:column;
         align-items:center; justify-content:center; height:100vh; margin:0; }
  h1 { font-size: 1rem; letter-spacing: 0.1em; color:#38bdf8; }
  #status { margin-top: 1rem; font-size: 0.85rem; color:#94a3b8; }
  #transcript { margin-top: 1.5rem; max-width: 80%; text-align:center; min-height: 2em; color:#e2e8f0; }
  .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; background:#475569; }
  .dot.live { background:#22c55e; box-shadow:0 0 8px #22c55e; }
</style>
</head>
<body>
  <h1>JARVIC · AUTOMATED BROWSER SPEECH BRIDGE</h1>
  <div id="status"><span class="dot" id="dot"></span><span id="statusText">Starting…</span></div>
  <div id="transcript"></div>
<script>
(function () {
  const statusEl = document.getElementById('statusText');
  const dotEl = document.getElementById('dot');
  const transcriptEl = document.getElementById('transcript');
  let ws = null;
  let recognition = null;
  let shouldRun = true;
  let reconnectTimer = null;

  function setStatus(text, live) {
    statusEl.textContent = text;
    dotEl.className = 'dot' + (live ? ' live' : '');
  }

  function connectWs() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = wsProtocol + '//' + location.host;
      ws = new WebSocket(wsUrl);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      setStatus('Connected to JARVIC Mainframe', true);
      startRecognition();
    };

    ws.onclose = () => {
      setStatus('Disconnected — retrying connection…', false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      try { ws.close(); } catch (e) {}
    };
  }

  function scheduleReconnect() {
    if (!shouldRun) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectWs, 1500);
  }

  function send(text, confidence, final) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ text, confidence, final }));
    }
  }

  function startRecognition() {
    if (recognition) {
      try { recognition.start(); } catch (e) {}
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('Web Speech API unsupported', false); return; }

    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onspeechstart = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "speech-start" }));
      }
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        const confidence = result[0].confidence || 0.9;
        if (result.isFinal) {
          transcriptEl.textContent = text;
          send(text.trim(), confidence, true);
        } else {
          interim += text;
        }
      }
      if (interim) {
        transcriptEl.textContent = interim;
        send(interim.trim(), 0.5, false);
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setStatus('Recognition notice: ' + event.error, false);
      }
    };

    recognition.onend = () => {
      if (shouldRun) {
        setTimeout(() => { try { recognition.start(); } catch (e) {} }, 250);
      }
    };

    try {
      recognition.start();
      setStatus('Listening…', true);
    } catch (e) {
      setStatus('Listening active', true);
    }
  }

  window.addEventListener('beforeunload', () => { shouldRun = false; });
  connectWs();
})();
</script>
</body>
</html>`;

export class BrowserSpeechEngine extends EventEmitter {
  private server: http.Server | null = null;
  private wss: any = null;
  private socket: any = null;
  private lastPongAt = 0;
  private connected = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private browserContext: any = null;
  private browserPage: any = null;
  private shuttingDown = false;
  private started = false;

  private readonly requestedPort: number;
  private port: number;

  constructor(port: number = 8765) {
    super();
    this.requestedPort = port;
    this.port = port;
  }

  isHealthy(): boolean {
    return (
      this.connected &&
      !!this.socket &&
      this.socket.readyState === 1 /* OPEN */ &&
      Date.now() - this.lastPongAt < HEARTBEAT_TIMEOUT_MS
    );
  }

  get clientUrl(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  /** Automatically find an available port starting from requestedPort */
  private async findAvailablePort(startPort: number): Promise<number> {
    for (let p = startPort; p < startPort + 50; p++) {
      const available = await new Promise<boolean>((resolve) => {
        const srv = http.createServer();
        srv.once("error", () => resolve(false));
        srv.once("listening", () => {
          srv.close(() => resolve(true));
        });
        srv.listen(p, "127.0.0.1");
      });
      if (available) return p;
    }
    return startPort;
  }

  /** Automatically launch hidden Playwright Chrome speech client */
  private async launchBrowserClient(): Promise<void> {
    if (this.shuttingDown) return;

    let playwright: any;
    try {
      playwright = require("playwright");
    } catch (err: any) {
      console.warn("[BrowserSpeechEngine] Playwright unavailable:", err.message);
      return;
    }

    const speechProfileDir = path.join(app.getPath("userData"), "SpeechProfile");
    try {
      fs.mkdirSync(speechProfileDir, { recursive: true });
    } catch (err) {}

    const launchArgs = {
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--enable-speech-dispatcher",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--autoplay-policy=no-user-gesture-required",
        "--allow-file-access-from-files",
        "--disable-gesture-requirement-for-media-playback",
      ],
    };

    try {
      let context: any;
      try {
        context = await playwright.chromium.launchPersistentContext(speechProfileDir, {
          ...launchArgs,
          channel: "chrome",
        });
      } catch (err) {
        console.log("[BrowserSpeechEngine] Launching bundled Chromium speech client...");
        context = await playwright.chromium.launchPersistentContext(speechProfileDir, launchArgs);
      }

      await context.grantPermissions(["microphone"]).catch(() => {});

      this.browserContext = context;
      this.browserPage = context.pages()[0] || (await context.newPage());

      const handleBrowserExit = (reason: string) => {
        if (this.shuttingDown) return;
        console.log(`[BrowserSpeechEngine] Speech client browser/page (${reason}) exited — auto-relaunching in 2s...`);
        this.browserContext = null;
        this.browserPage = null;
        setTimeout(() => this.launchBrowserClient(), 2000);
      };

      context.on("close", () => handleBrowserExit("context closed"));
      this.browserPage.on("crash", () => handleBrowserExit("page crashed"));
      this.browserPage.on("close", () => handleBrowserExit("page closed"));

      await this.browserPage.goto(this.clientUrl, { waitUntil: "domcontentloaded" });
      console.log(`[BrowserSpeechEngine] Automated hidden Chrome speech client running at ${this.clientUrl}`);
    } catch (err) {
      console.error("[BrowserSpeechEngine] Failed to launch Playwright speech client:", err);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.shuttingDown = false;

    // 1. Dynamic port allocation
    this.port = await this.findAvailablePort(this.requestedPort);

    let WebSocketServer: any;
    try {
      ({ WebSocketServer } = require("ws"));
    } catch (err: any) {
      throw new Error(`"ws" package is not installed (${err.message}). Run: npm install ws`);
    }

    this.server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CLIENT_PAGE);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on("connection", (ws: any) => {
      console.log(`[BrowserSpeechEngine] Automated Speech Client Connected on port ${this.port}`);
      this.socket = ws;
      this.connected = true;
      this.lastPongAt = Date.now();
      this.emit("connected");

      ws.on("pong", () => {
        this.lastPongAt = Date.now();
      });

      ws.on("message", (raw: Buffer) => {
        this.lastPongAt = Date.now();
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.event === "speech-start") {
            this.emit("speech-start");
            return;
          }

          const text = String(msg.text ?? "").trim();
          const confidence = typeof msg.confidence === "number" ? msg.confidence : 0.9;
          const final = !!msg.final;
          if (!text) return;

          if (final) {
            console.log(`[BrowserSpeechEngine] Transcript: "${text}"`);
            this.emit("transcript", { text, confidence, final: true, source: "browser" });
          } else {
            this.emit("partial", text);
          }
        } catch (err) {
          console.warn("[BrowserSpeechEngine] Malformed message:", err);
        }
      });

      ws.on("close", () => {
        if (this.socket === ws) {
          this.socket = null;
          if (this.connected) {
            this.connected = false;
            console.log("[BrowserSpeechEngine] Speech Client Disconnected — awaiting reconnect...");
            this.emit("disconnected");
          }
        }
      });

      ws.on("error", () => {
        try {
          ws.close();
        } catch {}
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "127.0.0.1", () => resolve());
    });

    console.log(`[BrowserSpeechEngine] Automated bridge server online at ${this.clientUrl}`);

    // 2. Automatically launch hidden Playwright Chrome client
    this.launchBrowserClient().catch((err) => {
      console.error("[BrowserSpeechEngine] Failed to launch speech client browser:", err);
    });

    // 3. Heartbeat monitoring
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket) return;
      if (Date.now() - this.lastPongAt >= HEARTBEAT_TIMEOUT_MS) {
        if (this.connected) {
          this.connected = false;
          console.log("[BrowserSpeechEngine] Heartbeat timeout — treating as disconnected.");
          this.emit("disconnected");
        }
        return;
      }
      try {
        this.socket.ping();
      } catch {}
    }, 5000);
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    this.started = false;

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    try {
      if (this.browserContext) {
        await this.browserContext.close();
      }
    } catch {}
    this.browserContext = null;
    this.browserPage = null;

    try {
      this.socket?.close?.();
    } catch {}
    this.socket = null;
    this.connected = false;

    await new Promise<void>((resolve) => {
      if (this.wss) this.wss.close(() => resolve());
      else resolve();
    });

    await new Promise<void>((resolve) => {
      if (this.server) this.server.close(() => resolve());
      else resolve();
    });
  }
}
