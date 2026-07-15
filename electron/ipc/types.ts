/** IPC channel name shared by the main-process handler and the preload bridge. */
export const TOOL_CHANNEL = "jarvic:invoke-tool";

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  logs?: string[];
  executionTimeMs: number;
}

export interface ToolDefinition<TArgs = any, TResult = any> {
  /** Unique, stable identifier the AI will use to call this tool, e.g. "apps.open" */
  name: string;
  /** Human/AI-facing description of what this tool does. */
  description: string;
  /** Whether this action is destructive/irreversible (delete, shutdown, kill, etc). Tools flagged here must implement their own explicit confirmation step before acting. */
  destructive?: boolean;
  /** Validates and normalizes raw, untrusted args from the renderer. MUST throw on anything unexpected — never coerce silently. */
  validateArgs: (raw: unknown) => TArgs;
  /** Executes the tool. Runs entirely in the main process. */
  handler: (args: TArgs) => Promise<TResult> | TResult;
}
