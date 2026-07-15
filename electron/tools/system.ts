import { registerTool } from "../ipc/toolRegistry";

registerTool({
  name: "system.ping",
  description:
    "Health-check tool that verifies the secure IPC bridge is working end-to-end. Touches no files, processes, or OS state.",
  validateArgs: () => undefined,
  handler: () => ({ pong: true, timestamp: new Date().toISOString() }),
});
