import fs from "fs";
import path from "path";
import { registerTool } from "../ipc/toolRegistry";

type Args = { text: string; voice?: string | null; rate?: number | null };

let activeTtsCount = 0;

export function isTtsSpeaking(): boolean {
  return activeTtsCount > 0;
}

const resolveSay = () => {
  const candidates = [
    "say",
    path.join(process.cwd(), "node_modules", "say"),
    path.join(__dirname, "..", "node_modules", "say"),
    path.join(__dirname, "..", "..", "node_modules", "say"),
  ];

  let lastError: any = null;
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Failed to resolve say module");
};

export function stopTtsSpeaking(): void {
  activeTtsCount = 0;
  try {
    const say = resolveSay();
    say.stop();
  } catch (err) {
    console.warn("Failed to stop native TTS:", err);
  }
}

registerTool({
  name: "system.tts.speak",
  description: "Speak text using the host OS TTS engine (desktop-only).",
  validateArgs: (raw: unknown): Args => {
    if (!raw || typeof raw !== "object") throw new Error("Args must be an object");
    const { text, voice, rate } = raw as any;
    if (typeof text !== "string" || text.length === 0) throw new Error("`text` must be a non-empty string");
    if (voice != null && typeof voice !== "string") throw new Error("`voice` must be a string if provided");
    if (rate != null && typeof rate !== "number") throw new Error("`rate` must be a number if provided");
    return { text, voice: voice ?? null, rate: rate ?? null };
  },
  handler: (args: Args) => {
    const say = resolveSay();
    const speed = args.rate ?? 1.0;
    activeTtsCount++;
    return new Promise((resolve, reject) => {
      say.speak(args.text, args.voice ?? undefined, speed, (err: Error | null) => {
        activeTtsCount = Math.max(0, activeTtsCount - 1);
        if (err) return reject(err);
        resolve({ spoken: true });
      });
    });
  },
});

registerTool({
  name: "system.tts.stop",
  description: "Stop any ongoing OS text-to-speech synthesis (desktop-only).",
  validateArgs: (raw: unknown) => ({}),
  handler: async () => {
    stopTtsSpeaking();
    return { stopped: true };
  },
});
