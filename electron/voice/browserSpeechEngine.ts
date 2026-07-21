/**
 * electron/voice/browserSpeechEngine.ts
 *
 * Browser Speech Engine (layer 1 / primary of the Hybrid Speech Recognition
 * system).
 *
 * Electron's bundled Chromium does not ship a working Web Speech API speech
 * backend, so `webkitSpeechRecognition` silently fails inside JARVIC's own
 * renderer (this was the open question from earlier sessions). The fix:
 * run the actual Web Speech API in a REAL browser tab (system Chrome/Edge),
 * and bridge its recognized text to the desktop app over a local WebSocket
 * — no polling, just push events both ways.
 *
 *   Browser tab → Web Speech API → WebSocket → JARVIC → SpeechRouter
 *
 * This class owns a small dedicated HTTP+WebSocket server (independent of
 * the main Express app in server.ts, so nothing about the AI planner/API
 * server is touched). It serves one static page (the Web Speech client)
 * and accepts one JSON message shape from it:
 *
 *   { "text": "Open Chrome", "confidence": 0.97, "final": true }
 *
 * Health/failover: the engine is considered "healthy" only while a client
 * socket is connected AND has sent something recently (heartbeat). Losing
 * the connection, an explicit close, or a heartbeat timeout all mark it
 * unhealthy so SpeechRouter can fail over to the OfflineSpeechEngine.
 */

import { EventEmitter } from "events";
import http from "http";

const HEARTBEAT_TIMEOUT_MS = 12_000;

const CLIENT_PAGE = (wsPort: number) => `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>JARVIC Browser Speech Bridge</title>
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
  <h1>JARVIC · BROWSER SPEECH BRIDGE</h1>
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

  function setStatus(text, live) {
    statusEl.textContent = text;
    dotEl.className = 'dot' + (live ? ' live' : '');
  }

  function connectWs() {
    ws = new WebSocket('ws://127.0.0.1:${wsPort}');
    ws.onopen = () => { setStatus('Connected to JARVIC', true); startRecognition(); };
    ws.onclose = () => { setStatus('Disconnected — retrying…', false); setTimeout(connectWs, 1500); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function send(text, confidence, final) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ text, confidence, final }));
    }
  }

  function startRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('This browser has no Web Speech API support', false); return; }
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

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
      if (interim) transcriptEl.textContent = interim;
    };

    recognition.onerror = (event) => {
      setStatus('Recognition error: ' + event.error, false);
    };

    recognition.onend = () => {
      // Continuous mode still ends periodically on some platforms — restart automatically.
      if (shouldRun) {
        setTimeout(() => { try { recognition.start(); } catch (e) {} }, 250);
      }
    };

    try {
      recognition.start();
      setStatus('Listening…', true);
    } catch (e) {
      setStatus('Could not start recognition', false);
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
  private readonly port: number;

  constructor(port: number) {
    super();
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

  /** URL to open in a real system browser (Chrome/Edge) to connect it as JARVIC's speech input. */
  get clientUrl(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  async start(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let WebSocketServer: any;
    try {
      ({ WebSocketServer } = require("ws"));
    } catch (err: any) {
      throw new Error(`"ws" package is not installed (${err.message}). Run: npm install ws`);
    }

    this.server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CLIENT_PAGE(this.port));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on("connection", (ws: any) => {
      console.log("[BrowserSpeechEngine] Browser Speech Connected");
      this.socket = ws;
      this.connected = true;
      this.lastPongAt = Date.now();
      this.emit("connected");

      ws.on("pong", () => {
        this.lastPongAt = Date.now();
      });

      ws.on("message", (raw: Buffer) => {
        this.lastPongAt = Date.now(); // any traffic counts as proof of life too
        try {
          const msg = JSON.parse(raw.toString());
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
            console.log("[BrowserSpeechEngine] Browser Speech Lost");
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

    console.log(
      `[BrowserSpeechEngine] Bridge listening at ${this.clientUrl} — open this URL in Chrome/Edge once to enable browser speech.`
    );

    // Actively ping the socket periodically (independent of whether the
    // user is currently speaking) to distinguish "silent but connected"
    // from "actually disconnected/crashed". Only emit "disconnected" once
    // per real transition, not on every check.
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
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
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
