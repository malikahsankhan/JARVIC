import { registerTool } from "../ipc/toolRegistry";

registerTool({
  name: "system.audio.listen",
  description: "Placeholder: desktop microphone capture requires additional setup. Use browser speech recognition instead.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).mode !== "string") {
      throw new Error("Expected { mode: string }");
    }
    return { mode: (raw as any).mode as string };
  },
  handler: async ({ mode }: { mode: string }) => {
    if (mode === "stop") {
      return { stopped: true };
    }
    // Desktop audio capture is not yet available in this build.
    // The user should enable browser speech recognition instead.
    throw new Error(
      "Desktop microphone capture requires native dependencies that are not available. Please use browser speech recognition instead."
    );
  },
});
