import express from "express";
import path from "path";
import os from "os";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { TOOL_MANIFEST, JsonSchemaProperty } from "./shared/toolManifest";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini client safely if API key is present
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
    // Format conversation history for Gemini, including prior tool-call
    // requests (model turns) and tool-result turns (user turns), so a
    // multi-step "call a tool, see the result, respond" exchange works.
    const formattedContents = messages.map((m: any) => {
      if (m.role === "assistant") {
        const parts: any[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const call of m.toolCalls ?? []) {
          parts.push({ functionCall: { name: call.name, args: call.args ?? {} } });
        }
        return { role: "model", parts: parts.length ? parts : [{ text: "" }] };
      }
      if (m.role === "tool") {
        const parts = (m.toolResults ?? []).map((tr: any) => ({
          functionResponse: { name: tr.name, response: tr.result ?? {} },
        }));
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
5. You can still open web-based destinations (YouTube, Google, GitHub, etc.) — that continues to work the same way it always has, outside of the tool system.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction,
        temperature: 0.7,
        tools: [{ functionDeclarations: toGeminiFunctionDeclarations() }],
      },
    });

    const rawCalls = response.functionCalls ?? [];
    const toolCalls = rawCalls.map((call: any, idx: number) => ({
      id: call.id ?? `${Date.now()}-${idx}`,
      name: call.name,
      args: call.args ?? {},
    }));

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
