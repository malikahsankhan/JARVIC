export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  id: string;
  name: string;
  result: unknown; // the ToolResult returned by window.jarvic.invokeTool
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  /** Present on an assistant message that is asking to invoke one or more tools. */
  toolCalls?: ToolCall[];
  /** Present on a "tool" message reporting the outcome of previously requested tool calls. */
  toolResults?: ToolCallResult[];
}

export type ThemeName = "cyan" | "amber" | "emerald" | "crimson" | "purple";

export interface ThemeColors {
  primary: string; // Tailwind color name like cyan-400
  primaryHex: string;
  bgDark: string;
  borderGlow: string;
  accentGlow: string;
  textGlow: string;
}

export interface Directive {
  id: string;
  content: string;
  timestamp: string;
}

export interface SystemStatus {
  status: string;
  systemName: string;
  platform: string;
  arch: string;
  uptime: number;
  memory: {
    total: number;
    free: number;
    processUsed: number;
  };
  cpu: {
    cores: number;
    model: string;
    loadAverage: number[];
  };
  files: any[];
  nodeVersion: string;
  timestamp: string;
}

export type JarvicState = "idle" | "listening" | "thinking" | "speaking";
