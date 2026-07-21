import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("miniBridge", {
  sendAction: (action: string, payload?: unknown): void => {
    ipcRenderer.send("jarvic:mini-action", action, payload);
  },

  onStateUpdate: (callback: (state: string, transcript?: string) => void): (() => void) => {
    const handler = (_event: unknown, state: string, transcript?: string) =>
      callback(state, transcript);
    ipcRenderer.on("jarvic:mini-state", handler);
    return () => {
      ipcRenderer.removeListener("jarvic:mini-state", handler as any);
    };
  },

  restoreMain: (): void => {
    ipcRenderer.send("jarvic:mini-restore");
  },

});
