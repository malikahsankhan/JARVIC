import fs from "fs";
import path from "path";
import { registerTool } from "../ipc/toolRegistry";

type Args = { text: string; voice?: string | null; rate?: number | null };

const resolveSay = () => {
  try {
    return require("say");
  } catch (initialError) {
    // If Electron is running from dist-electron, resolve from the parent project root.
    const candidate = path.join(__dirname, "..", "..", "node_modules", "say");
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
    throw initialError;
  }
};

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
    return new Promise((resolve, reject) => {
      say.speak(args.text, args.voice ?? undefined, speed, (err: Error | null) => {
        if (err) return reject(err);
        resolve({ spoken: true });
      });
    });
  },
});
