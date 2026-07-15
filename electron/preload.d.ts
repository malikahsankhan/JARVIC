import type { ToolResult } from "./ipc/types";

export interface JarvicBridge {
  isElectron: true;
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  invokeTool: (name: string, args?: unknown) => Promise<ToolResult>;
}

declare global {
  interface Window {
    /** Present only when running inside the Electron shell. Undefined in a plain browser tab. */
    jarvic?: JarvicBridge;
  }
}
