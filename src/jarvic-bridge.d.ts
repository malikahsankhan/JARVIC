export interface JarvicToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  logs?: string[];
  executionTimeMs: number;
}

export interface JarvicBridge {
  isElectron: true;
  platform: string;
  versions: { node: string; chrome: string; electron: string };
  invokeTool: (name: string, args?: unknown) => Promise<JarvicToolResult>;
  onAudioEvent?: (callback: (data: { event: string; data?: any }) => void) => () => void;
  /** Receive events forwarded from the floating mini-widget. */
  onMiniEvent?: (callback: (data: { action: string; payload?: unknown }) => void) => () => void;
  /** Push current JARVIC state to the floating mini-widget. */
  notifyMiniWidget?: (state: string, transcript?: string) => void;
}

declare global {
  interface Window {
    /** Present only when running inside the Electron shell. Undefined in a plain browser tab. */
    jarvic?: JarvicBridge;
  }
}
