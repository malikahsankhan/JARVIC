import { EventEmitter } from "events";
import fs from "fs";
import http from "http";
import path from "path";
import type { BrowserSpeechCommand, BrowserSpeechEvent } from "./types";

const HOST = "127.0.0.1";
const HEARTBEAT_TIMEOUT_MS = 15_000;

export class VoiceWebSocketServer extends EventEmitter {
  private httpServer: http.Server | null = null;
  private wss: any = null;
  private socket: any = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastSeenAt = 0;
  private selectedPort = 0;
  private pendingCommand: BrowserSpeechCommand | null = null;

  constructor(private readonly requestedPort = 0, private readonly staticDir = __dirname) {
    super();
  }

  get port(): number {
    return this.selectedPort;
  }

  get url(): string {
    return `http://${HOST}:${this.selectedPort}/speech.html`;
  }

  get isConnected(): boolean {
    return !!this.socket && this.socket.readyState === 1 && Date.now() - this.lastSeenAt < HEARTBEAT_TIMEOUT_MS;
  }

  async start(): Promise<void> {
    if (this.httpServer) return;

    const { WebSocketServer } = require("ws");
    this.httpServer = http.createServer((req, res) => this.serve(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws: any) => this.handleConnection(ws));

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once("error", reject);
      this.httpServer!.listen(this.requestedPort, HOST, () => {
        const address = this.httpServer!.address();
        this.selectedPort = typeof address === "object" && address ? address.port : this.requestedPort;
        resolve();
      });
    });

    this.heartbeatTimer = setInterval(() => this.heartbeat(), 5_000);
  }

  send(command: BrowserSpeechCommand): void {
    if (this.socket?.readyState === 1) {
      this.socket.send(JSON.stringify(command));
      return;
    }
    if (command.type === "start" || command.type === "stop") {
      this.pendingCommand = command;
    }
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    try {
      this.socket?.close?.();
    } catch {}
    this.socket = null;
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
    this.wss = null;
    await new Promise<void>((resolve) => (this.httpServer ? this.httpServer.close(() => resolve()) : resolve()));
    this.httpServer = null;
  }

  private serve(req: http.IncomingMessage, res: http.ServerResponse): void {
    const pathname = new URL(req.url || "/", `http://${HOST}`).pathname;
    const fileName = pathname === "/" ? "speech.html" : path.basename(pathname);
    if (fileName !== "speech.html" && fileName !== "speech.js") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    try {
      const content = fs.readFileSync(path.join(this.staticDir, fileName));
      res.writeHead(200, {
        "Content-Type": fileName.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end(`Missing speech client asset: ${fileName}`);
    }
  }

  private handleConnection(ws: any): void {
    if (this.socket && this.socket !== ws) {
      try {
        this.socket.close();
      } catch {}
    }

    this.socket = ws;
    this.lastSeenAt = Date.now();
    this.emit("connected");
    if (this.pendingCommand) {
      ws.send(JSON.stringify(this.pendingCommand));
      this.pendingCommand = null;
    }

    ws.on("message", (raw: Buffer) => {
      this.lastSeenAt = Date.now();
      try {
        this.emit("event", JSON.parse(raw.toString()) as BrowserSpeechEvent);
      } catch (err) {
        this.emit("event", { type: "error", error: `Malformed browser message: ${err}` });
      }
    });
    ws.on("pong", () => {
      this.lastSeenAt = Date.now();
    });
    ws.on("close", () => {
      if (this.socket === ws) {
        this.socket = null;
        this.emit("disconnected");
      }
    });
    ws.on("error", () => {
      try {
        ws.close();
      } catch {}
    });
  }

  private heartbeat(): void {
    if (!this.socket) return;
    if (Date.now() - this.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
      try {
        this.socket.terminate();
      } catch {}
      this.socket = null;
      this.emit("disconnected");
      return;
    }
    try {
      this.socket.ping();
      this.send({ type: "ping" });
    } catch {}
  }
}
