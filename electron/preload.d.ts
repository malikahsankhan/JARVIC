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
  /** Open a URL in the system's default browser (bypasses popup blocking). */
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  onAudioEvent: (callback: (data: { event: string; data?: any }) => void) => () => void;
  /** Receive events forwarded from the floating mini-widget. */
  onMiniEvent: (callback: (data: { action: string; payload?: unknown }) => void) => () => void;
  /** Push current JARVIC state to the floating mini-widget. */
  notifyMiniWidget: (state: string, transcript?: string) => void;
}

declare global {
  interface Window {
    /** Present only when running inside the Electron shell. Undefined in a plain browser tab. */
    jarvic?: JarvicBridge;
  }
}
