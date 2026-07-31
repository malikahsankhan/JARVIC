import express from "express";
import path from "path";
import os from "os";
import fs from "fs";
import { execFile } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { TOOL_MANIFEST, JsonSchemaProperty } from "./shared/toolManifest";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "25mb" }));

// ---------------------------------------------------------------------------
// Local, offline speech-to-text via whisper.cpp (no API key, no rate limits).
// Client sends a raw 16kHz mono 16-bit WAV file; we shell out to the bundled
// whisper-cli.exe and read back its .txt output.
// ---------------------------------------------------------------------------
const WHISPER_DIR = process.env.WHISPER_DIR || path.join(process.cwd(), "whisper");
const WHISPER_CLI = path.join(WHISPER_DIR, "Release", "whisper-cli.exe");
const WHISPER_MODEL = path.join(WHISPER_DIR, "ggml-tiny.en.bin");

app.post("/api/transcribe-whisper", express.raw({ type: "*/*", limit: "20mb" }), async (req, res) => {
  if (!fs.existsSync(WHISPER_CLI)) {
    return res.status(500).json({
      error: `whisper-cli.exe not found at ${WHISPER_CLI}. Unzip whisper-blas-bin-x64.zip inside the whisper/ folder first (so whisper/Release/whisper-cli.exe exists).`,
    });
  }
  if (!fs.existsSync(WHISPER_MODEL)) {
    return res.status(500).json({ error: `Whisper model not found at ${WHISPER_MODEL}.` });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "No audio data received." });
  }

  const tmpBase = path.join(os.tmpdir(), `jarvic-whisper-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const wavPath = `${tmpBase}.wav`;
  const outBase = `${tmpBase}-out`;
  const txtPath = `${outBase}.txt`;

  try {
    fs.writeFileSync(wavPath, req.body);

    await new Promise<void>((resolve, reject) => {
      execFile(
        WHISPER_CLI,
        ["-m", WHISPER_MODEL, "-f", wavPath, "-nt", "-otxt", "-of", outBase],
        { timeout: 30_000, windowsHide: true },
        (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(stderr?.toString().trim() || err.message));
            return;
          }
          resolve();
        }
      );
    });

    const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, "utf-8").trim() : "";
    res.json({ text });
  } catch (err: any) {
    console.error("Whisper transcription error:", err);
    res.status(500).json({ error: err?.message ?? "Whisper transcription failed." });
  } finally {
    try { fs.unlinkSync(wavPath); } catch {}
    try { fs.unlinkSync(txtPath); } catch {}
  }
});

const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const GEMINI_TYPE_MAP: Record<JsonSchemaProperty["type"], any> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
};

function toGeminiFunctionDeclarations() {
  return TOOL_MANIFEST.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: Type.OBJECT,
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([key, prop]) => [
          key,
          {
            type: GEMINI_TYPE_MAP[prop.type],
            description: prop.description,
            enum: prop.enum,
          },
        ])
      ),
      required: tool.parameters.required ?? [],
    },
  }));
}

// In-memory directives storage
let globalDirectives = [
  { id: "1", content: "Maintain structural integrity of all thermal buffers.", timestamp: new Date().toISOString() },
  { id: "2", content: "Monitor sub-grid neural net for feedback loops.", timestamp: new Date().toISOString() },
  { id: "3", content: "Calibrate vocal synthesis modules daily.", timestamp: new Date().toISOString() }
];

// Helper to get recursive file structure info for JARVIC visual scan
function getFileTree(dir: string, depth = 0): any[] {
  if (depth > 2) return []; // limit depth to avoid slow response
  try {
    const files = fs.readdirSync(dir);
    const result: any[] = [];
    for (const file of files) {
      if (file === 'node_modules' || file === '.git' || file === 'dist' || file === '.next' || file === 'assets') continue;
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        result.push({
          name: file,
          type: 'directory',
          children: getFileTree(fullPath, depth + 1)
        });
      } else {
        result.push({
          name: file,
          type: 'file',
          size: stat.size
        });
      }
    }
    return result;
  } catch (err) {
    return [];
  }
}

// API Routes
app.get("/api/system/status", (req, res) => {
  const uptime = process.uptime();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryUsage = process.memoryUsage();
  
  // Real filesystem structure for diagnostic mode
  const fileTree = getFileTree(process.cwd());

  res.json({
    status: "ONLINE",
    systemName: "JARVIC Mainframe",
    platform: os.platform(),
    arch: os.arch(),
    uptime: Math.floor(uptime),
    memory: {
      total: totalMem,
      free: freeMem,
      processUsed: memoryUsage.heapUsed,
    },
    cpu: {
      cores: os.cpus().length,
      model: os.cpus()[0]?.model || "Unknown Processor",
      loadAverage: os.loadavg(),
    },
    files: fileTree,
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/directives", (req, res) => {
  res.json(globalDirectives);
});

app.post("/api/directives", (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: "Invalid content" });
  }
  const newDirective = {
    id: String(Date.now()),
    content,
    timestamp: new Date().toISOString()
  };
  globalDirectives.push(newDirective);
  res.status(201).json(newDirective);
});

app.delete("/api/directives/:id", (req, res) => {
  const { id } = req.params;
  globalDirectives = globalDirectives.filter(d => d.id !== id);
  res.json({ success: true });
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing messages array" });
  }

  if (!ai) {
    return res.status(500).json({ 
      error: "JARVIC Neural Core Offline. The GEMINI_API_KEY environment variable is missing on the server. Please configure it in the Settings > Secrets tab in AI Studio." 
    });
  }

  try {
    const formattedContents = messages.map((m: any) => {
      if (m.role === "assistant") {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const call of m.toolCalls ?? []) {
          // Use the preserved raw Gemini part (including thoughtSignature) for
          // history replay so the API doesn't reject the turn with a 400.
          if (call._raw) {
            parts.push(call._raw);
          } else {
            parts.push({
              functionCall: {
                name: call.name,
                args: call.args,
                id: call.id,
              },
            });
          }
        }
        return { role: "model", parts: parts.length ? parts : [{ text: "" }] };
      }
      if (m.role === "tool") {
        const parts: any[] = [];
        for (const tr of m.toolResults ?? []) {
          // window.jarvic.invokeTool always returns the IPC wrapper
          // { success, data, executionTimeMs } — the tool handler's own
          // return value (where __visionImage would live, from vision.see)
          // is nested one level down under `.data`.
          const rawResult: any = tr.result ?? {};
          const data = rawResult && typeof rawResult === "object" ? rawResult.data : undefined;
          const visionImage = data && typeof data === "object" ? data.__visionImage : undefined;

          let responseForModel = rawResult;
          if (visionImage && visionImage.data) {
            // Strip the (large) base64 payload out of the JSON function
            // response — it gets attached below as a real inline image
            // part instead, so the model can actually see it as pixels
            // rather than choke on it as an enormous text blob.
            const { __visionImage, ...restData } = data;
            responseForModel = { ...rawResult, data: restData };
          }

          parts.push({ functionResponse: { name: tr.name, response: responseForModel ?? {} } });
          if (visionImage && visionImage.data) {
            parts.push({ inlineData: { mimeType: visionImage.mimeType || "image/png", data: visionImage.data } });
          }
        }
        return { role: "user", parts: parts.length ? parts : [{ text: "" }] };
      }
      // 'user' and 'system' both come through as a plain user turn
      return { role: "user", parts: [{ text: m.content ?? "" }] };
    });

    const systemInstruction = `You are J.A.R.V.I.C. (Just A Really Very Intelligent Computer), a highly advanced, polite, and helpful British AI computer assistant, heavily inspired by Jarvis from Iron Man.
Your tone is sophisticated, slightly dry-witted, impeccably polite ("Sir" or "Ma'am" based on context, default to "Sir" or "Ma'am" interchangeably, or just general respect), and highly intelligent.
You speak as if you are monitoring the system diagnostics, controlling core sectors, and managing background subroutines.

Keep your replies elegant, structured, clear, and relatively concise. Avoid overly flowery, repetitive greetings every single sentence, but sound like a sophisticated operating system assistant.
Use markdown to format responses nicely (bullets, bold text, lists). Feel free to reference system states, load levels, core sectors, or diagnostics if relevant to the conversation.

REAL DESKTOP CONTROL:
1. J.A.R.V.I.C. runs as a native Windows desktop application and has genuine, tool-gated control over this specific PC — opening/closing applications, managing files and folders, listing/killing processes, reading system diagnostics, and locking/sleeping/restarting/shutting the machine down.
2. To actually perform any of these, call the matching function/tool. Never claim in plain text that you have opened, deleted, moved, or changed something — if it needs to happen on the PC, it must go through a tool call, and you should describe the result only after the tool result comes back to you.
3. Some tools are irreversible or high-impact (deleting files/folders, killing a process, restarting or shutting down, putting the machine to sleep). For these, first tell the user in plain text exactly what you are about to do and ask them to confirm — only call the tool once the user has clearly agreed in this conversation. Never set a "confirm" argument to true on your own initiative.
4. If a tool call fails or is unavailable (for example, if the user is viewing JARVIC in a plain browser tab instead of the desktop app), explain that plainly rather than pretending it worked.
5. You can still open web-based destinations (YouTube, Google, GitHub, etc.) — that continues to work the same way it always has, outside of the tool system.
6. For "play [song/video] on YouTube" requests, call web.youtubePlaySong with the query in a SINGLE tool call — it handles searching, clicking the first result, and skipping the ad itself. Do not manually chain web.open + web.click + web.type for this; that tool already does all of it. If it reports adSkipped: false, that usually just means the ad wasn't skippable (not every ad has a skip button) — don't retry repeatedly for that reason alone.
7. input.typeText, input.pressKey, input.mouseMove, and input.mouseClick give you direct control of the mouse and keyboard system-wide — whatever is on screen and focused will receive them, not just JARVIC's own window. Before a sequence of these, briefly tell the user what you're about to do (e.g. "Clicking into the search box and typing your query now") so they can see it happening and intervene if something looks wrong. These are not individually confirm-gated like deletion/shutdown, so use them thoughtfully.
8. CRITICAL TOOL SELECTION RULE: if the user asks you to type, write, or enter text anywhere (e.g. "type X in notepad", "write hello"), you MUST call input.typeText with that text. Never call system.takeScreenshot for a typing request — that tool only captures an image of the screen and has nothing to do with typing. If unsure which tool a request needs, re-read the tool's description literally rather than guessing from a surface-level word match.
9. When a request opens an application and then immediately types into it (e.g. "open notepad and type X", or "open notepad" followed a moment later by "type X in it"), call apps.open first, then wait for the window to actually be ready before typing. Do NOT guess a fixed system.wait duration for apps whose load time varies (messaging/chat apps like WhatsApp — Desktop or Web — Slack, Teams, or anything browser-based): call desktop.waitForWindow with the app's window title (e.g. "WhatsApp") right after opening it, and only proceed to input.typeText/desktop.typeControl once it reports the window found. Only fall back to system.wait for apps that never open a distinct, findable window.
10. EXCEPTION to the above for Notepad specifically: if the user wants text written AND saved into Notepad (e.g. "open notepad, write X, and save it", "write X in notepad"), do NOT use apps.open + input.typeText + input.pressKey("ctrl+s") — that requires simulating a Save dialog and is unreliable. Instead call files.writeAndOpenInNotepad in a single call, which writes the file directly and opens it already saved. Only fall back to manual typing if the user is working with an application other than Notepad that has no direct file-writing equivalent.
11. For "search X on Google" use web.googleSearch, and for "search X on Google and show images" / "images section" use web.googleImageSearch — do not hand-build a Google URL yourself with web.open, these dedicated tools are more reliable.
12. For interacting with any website in JARVIC's media window — clicking buttons/links, scrolling — prefer web.clickByText (click by what the button visibly says, e.g. "Sign In", "Accept all") and web.scroll over web.click/web.evaluate. You cannot see a page's CSS selectors, so guessing them with web.click will usually fail; clicking by visible text is far more reliable for real-world websites.

VOLUME & AUDIO CONTROL:
13. For "increase/turn up volume", call system.adjustVolume with action="up". For "decrease/turn down volume", use action="down". For "mute/unmute", use action="mute". For "set volume to X%", call system.setVolume with the exact level.

BRIGHTNESS CONTROL:
14. For "increase/decrease brightness" or "set brightness to X%", use system.setBrightness or system.getBrightness. Note: this only works on laptops or monitors with WMI brightness support.

CLIPBOARD:
15. For "copy X to clipboard" or "put X in clipboard", call clipboard.write. For "what's in my clipboard" or "read clipboard", call clipboard.read. For "clear clipboard", call clipboard.clear.

WI-FI & NETWORK:
16. For "turn on/off Wi-Fi", call wifi.enable or wifi.disable. For "what Wi-Fi networks are nearby", call wifi.listNetworks. For "what's my IP address", call network.publicIp. For network adapter details, call network.info.

WINDOWS SETTINGS:
17. For "open sound settings", "open display settings", "open power settings" etc., call system.openSettings with the appropriate page key (sound, display, power, wifi, bluetooth, notifications, apps, update, privacy, storage, accounts).
18. For "open action center" or "open notifications panel", call system.openActionCenter.

WINDOW MANAGEMENT:
19. For "minimize all windows" or "show desktop", call system.minimizeAllWindows. For "restore windows", call system.restoreAllWindows. For "switch window" or "alt-tab", call system.switchWindow.

RECYCLE BIN:
20. For "how much is in recycle bin", call recycleBin.size. For "empty recycle bin", ask user to confirm first, then call recycleBin.empty with confirm: true.

SHUTDOWN TIMER:
21. For "shutdown in X minutes" or "turn off PC in X minutes", call system.setShutdownTimer with the number of minutes. For "cancel shutdown timer", call it with minutes: 0.

SYSTEM INFO:
22. For "what apps are installed", call system.installedApps. For "what services are running", call system.runningServices. For "what's my computer name/user/OS", call system.hostname. For "what's my screen resolution", call system.getScreenResolution.

WEB VS APP:
24. For opening a website (e.g. "open YouTube", "open Google", "open GitHub", "open reddit"), ALWAYS call web.open with the full URL. Do NOT call apps.searchAndOpen for website names — that tool is for actual desktop applications only.

DESKTOP APP UI AUTOMATION (pywinauto):
25. For interacting with any open desktop app (click buttons, type in fields), first call desktop.listWindows to find the window title, then desktop.dumpControls to inspect its UI elements, then desktop.clickControl or desktop.typeControl to interact. This works on any Win32 or UWP app.
26. CRITICAL: controlType alone is NEVER enough to click something. Windows like Slack, Teams, and VS Code have dozens of controls sharing the same controlType (e.g. many "TreeItem"/"ListItem" entries in a sidebar). ALWAYS pass controlText (or autoId) set to the exact visible name of the item you read from the most recent desktop.dumpControls output — never call clickControl/selectItem with only controlType/className and no controlText/autoId, it will fail as ambiguous.
27. For selecting an entry out of a list, tree, or combo box — e.g. a Slack channel/DM, a search/quick-switcher result, a dropdown option — prefer desktop.selectItem over desktop.clickControl. Pass windowTitle, the container's controlType/className if known, and itemName set to the exact text of the entry (read it from dumpControls first, e.g. after typing into a filter/search box, dump controls again and copy the matching item's exact name into itemName).
28. If a click/select call fails with an error, do NOT just repeat desktop.listWindows or start the whole flow over. Read the error: if it says a control is ambiguous or lists multiple candidates, immediately retry the SAME click/select call with a more specific controlText/itemName drawn from the last dumpControls output — don't burn rounds re-discovering windows you already found.
29. To SEND a message in a chat app (Slack, Teams, Discord, etc.) after typing it into the compose box with desktop.typeControl: press Enter, do NOT hunt for a "Send" button. Call desktop.sendKeysToControl with key="{ENTER}" and the SAME windowTitle/controlText/autoId you just typed into, so focus is still in the compose box. Icon-only send buttons frequently have no reliable accessible name to click, and Enter is the standard send shortcut in every major chat app by default. Only try clicking an actual send button as a fallback if the user tells you Enter didn't work (e.g. their app is configured to require Cmd/Ctrl+Enter to send and Enter alone just inserts a newline).

VISION (actually seeing the screen):
30. desktop.dumpControls only works on apps that expose a proper accessibility (UIA) tree. Some content has none: games, canvas/custom-rendered UI (many Electron apps with custom widgets), or icon-only controls with no accessible name. If desktop.dumpControls comes back empty, or every click/select attempt against it fails, call vision.see instead — it captures the actual screen and you genuinely see it as an image, not a text description. Also use vision.see whenever the user's request needs real visual judgment a text-only tool can't give you: confirming a checkbox/toggle's visual state, identifying a color, reading a QR code or diagram, or describing what's currently on screen.
31. vision.see's result gives you imageWidth/imageHeight (the image you're looking at) and screenWidth/screenHeight (the real screen, usually larger than the image). If you locate something at pixel (ix, iy) in the image, you MUST convert it before clicking: x = ix * (screenWidth / imageWidth), y = iy * (screenHeight / imageHeight), then call input.mouseClick with the converted x/y — passing the raw image-pixel coordinates straight to input.mouseClick will click the wrong spot.
32. Don't reach for vision.see as your first move on every UI task — it's slower and less precise than a name-based desktop.clickControl once you actually have a control name. Try the accessibility-tree path (25-27) first; fall back to vision.see only when that path is unavailable or has already failed.`;


    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: formattedContents,
      config: {
        systemInstruction,
        temperature: 0.7,
        tools: [{ functionDeclarations: toGeminiFunctionDeclarations() }],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const toolCalls: any[] = [];
    for (const part of parts) {
      if (part.functionCall) {
        toolCalls.push({
          id: part.functionCall.id ?? `${Date.now()}-${toolCalls.length}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
          // Preserve the entire part object (with thoughtSignature) so
          // formattedContents can replay it correctly on subsequent rounds.
          _raw: part,
        });
      }
    }

    res.json({
      role: "assistant",
      content: response.text || "",
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  } catch (error: any) {
    console.error("Gemini API error:", error);
    
    // Check if it looks like a transient 503, rate limit, or network overload
    const errorStr = typeof error === 'string' ? error : JSON.stringify(error);
    const isOverloaded = errorStr.includes("503") || errorStr.includes("high demand") || errorStr.includes("UNAVAILABLE") || errorStr.includes("429");
    
    let gracefulMessage = "I apologize, Sir. My neural pathways had a transient desynchronization. Could you repeat that directive?";
    
    if (isOverloaded) {
      gracefulMessage = "Sir, my neural computing mainframe is currently experiencing exceptionally high cognitive load demands. Temporary capacity overload detected. I am keeping our active buffers warm, but you may need to re-transmit your directive in a few moments once the sub-relays stabilize.";
    }

    res.json({
      role: "assistant",
      content: gracefulMessage
    });
  }
});

// AssemblyAI realtime token route kept for compatibility, but this build uses browser speech recognition instead.
app.get("/api/assemblyai/token", async (req, res) => {
  return res.status(503).json({
    error: "AssemblyAI realtime token service is unavailable in this build. Browser speech recognition is used instead.",
  });
});

// Catch-all JSON error handler. Must be registered after all routes (Express
// dispatches errors from any earlier middleware, including express.json(),
// to whichever error-handling middleware — 4 args — is registered later in
// the stack). Without this, a body-parser error like "payload too large"
// falls through to Express's default HTML error page, and the client's
// `await response.json()` on the /api/chat call throws a confusing
// "Unexpected token '<'" instead of a readable message.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled request error:", err);
  const status = err?.status || err?.statusCode || 500;
  const message =
    err?.type === "entity.too.large"
      ? "Request payload was too large (likely a huge tool result, e.g. a full UI control dump). Try a more targeted tool call."
      : err?.message || "Internal server error.";
  if (res.headersSent) return next(err);
  res.status(status).json({ error: message });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind server to localhost only to keep this a desktop-only app
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`JARVIC Server listening at http://localhost:${PORT} (localhost-only)`);
  });
}

startServer();
