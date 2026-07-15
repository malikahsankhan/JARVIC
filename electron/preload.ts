import { contextBridge, ipcRenderer } from "electron";
import { TOOL_CHANNEL, ToolResult } from "./ipc/types";

/**
 * JARVIC secure bridge.
 *
 * This is the ONLY surface the renderer has into Node/Electron. It exposes
 * exactly one capability — invoking a named, whitelisted tool through the
 * validated main-process handler — and nothing else. There is no raw
 * ipcRenderer, no fs, no child_process, no shell access here.
 */
contextBridge.exposeInMainWorld("jarvic", {
  isElectron: true,
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  /**
   * Invoke a registered desktop tool by name. Always resolves (never throws)
   * with a structured ToolResult — success/error/executionTimeMs/message.
   */
  invokeTool: (name: string, args?: unknown): Promise<ToolResult> =>
    ipcRenderer.invoke(TOOL_CHANNEL, name, args),
});
