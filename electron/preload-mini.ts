import { contextBridge, ipcRenderer } from "electron";

/**
 * Minimal preload for JARVIC's floating mini-widget.
 * Exposes only three narrow, purpose-built IPC channels — no raw
 * ipcRenderer, no filesystem, no shell access.
 */
contextBridge.exposeInMainWorld("miniBridge", {
  /** Send an action from the mini widget to the main renderer. */
  sendAction: (action: string, payload?: unknown): void => {
    ipcRenderer.send("jarvic:mini-action", action, payload);
  },

  /** Receive state updates (idle/listening/thinking/speaking + live transcript). */
  onStateUpdate: (callback: (state: string, transcript?: string) => void): (() => void) => {
    const handler = (_event: unknown, state: string, transcript?: string) =>
      callback(state, transcript);
    ipcRenderer.on("jarvic:mini-state", handler);
    return () => {
      ipcRenderer.removeListener("jarvic:mini-state", handler as any);
    };
  },

  /** Restore (un-minimize) the main JARVIC window and hide the mini widget. */
  restoreMain: (): void => {
    ipcRenderer.send("jarvic:mini-restore");
  },
});
