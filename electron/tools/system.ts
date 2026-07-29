import { registerTool } from "../ipc/toolRegistry";

registerTool({
  name: "system.ping",
  description:
    "Health-check tool that verifies the secure IPC bridge is working end-to-end. Touches no files, processes, or OS state.",
  validateArgs: () => undefined,
  handler: () => ({ pong: true, timestamp: new Date().toISOString() }),
});

const MAX_WAIT_MS = 5000;

registerTool({
  name: "system.wait",
  description:
    "Pauses briefly (max 5000ms) before your next tool call — a blind fixed sleep. Prefer desktop.waitForWindow instead whenever you know the target window's title (it polls and returns as soon as the window appears, rather than always sleeping the full duration). Use this one only when there's no window title to poll for.",
  validateArgs: (raw) => {
    const ms = typeof raw === "object" && raw !== null ? (raw as any).ms : 800;
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new Error("Expected { ms: number }");
    }
    return { ms: Math.min(ms, MAX_WAIT_MS) };
  },
  handler: async ({ ms }: { ms: number }) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { waitedMs: ms };
  },
});
