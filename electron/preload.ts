import { contextBridge, ipcRenderer } from "electron";
import { TOOL_CHANNEL, ToolResult } from "./ipc/types";
import { OPEN_EXTERNAL_CHANNEL } from "./ipc/handlers";

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
  /**
   * Open a URL in the system's default browser via shell.openExternal.
   * This bypasses the popup-blocking issue of window.open() in Electron.
   */
  openExternal: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onAudioEvent: (callback: (data: { event: string; data?: any }) => void): (() => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on("jarvic-audio-event", subscription);
    return () => {
      ipcRenderer.off("jarvic-audio-event", subscription);
    };
  },

  /**
   * Receive events forwarded from the floating mini-widget
   * (mic-toggle, send-text).
   */
  onMiniEvent: (callback: (data: { action: string; payload?: unknown }) => void): (() => void) => {
    const subscription = (_event: any, data: any) => callback(data);
    ipcRenderer.on("jarvic:from-mini", subscription);
    return () => {
      ipcRenderer.off("jarvic:from-mini", subscription);
    };
  },

  /**
   * Push the current JARVIC state (idle/listening/thinking/speaking)
   * and optional live transcript to the floating mini-widget.
   */
  notifyMiniWidget: (state: string, transcript?: string): void => {
    ipcRenderer.send("jarvic:mini-state", state, transcript);
  },
});
