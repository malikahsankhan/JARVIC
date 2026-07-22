import { registerTool } from "../ipc/toolRegistry";
import { voiceManager } from "../voice";

registerTool({
  name: "system.audio.listen",
  description: "Control speech recognition listening state (start, stop, toggle).",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).mode !== "string") {
      throw new Error("Expected { mode: string }");
    }
    return { mode: (raw as any).mode as string };
  },
  handler: async ({ mode }: { mode: string }) => {
    if (mode === "start") {
      voiceManager.startListening();
      return { success: true, message: "Browser speech recognition started." };
    } else if (mode === "stop") {
      voiceManager.stopListening();
      return { success: true, message: "Browser speech recognition stopped." };
    } else if (mode === "toggle") {
      voiceManager.toggleListening();
      return { success: true, message: "Browser speech recognition toggled." };
    }
    throw new Error(`Unsupported mode: ${mode}`);
  },
});

