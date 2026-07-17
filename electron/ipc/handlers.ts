import { ipcMain, shell } from "electron";
import { getTool } from "./toolRegistry";
import { ToolResult, TOOL_CHANNEL } from "./types";

/** Channel for opening URLs safely in the system's default browser. */
export const OPEN_EXTERNAL_CHANNEL = "jarvic:openExternal";

export { TOOL_CHANNEL };

const MAX_ARGS_JSON_LENGTH = 100_000; // guard against oversized/garbage payloads
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/** Confirms args are a plain JSON value — no functions, symbols, class instances, or circular refs can cross this boundary. */
function isPlainSerializable(value: unknown): boolean {
  try {
    const json = JSON.stringify(value ?? null);
    if (typeof json !== "string" || json.length > MAX_ARGS_JSON_LENGTH) return false;
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function registerIpcHandlers(): void {
  // ── shell.openExternal: open a URL in the system's default browser ──────────
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (_event, rawUrl: unknown): Promise<{ success: boolean; error?: string }> => {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
      return { success: false, error: "URL must be a non-empty string." };
    }
    // Only allow http/https to prevent file:// or shell injection
    if (!/^https?:\/\//i.test(rawUrl)) {
      return { success: false, error: "Only http/https URLs are permitted." };
    }
    try {
      await shell.openExternal(rawUrl);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }
  });
  ipcMain.handle(
    TOOL_CHANNEL,
    async (_event, rawName: unknown, rawArgs: unknown): Promise<ToolResult> => {
      const start = Date.now();
      const elapsed = () => Date.now() - start;

      if (typeof rawName !== "string" || rawName.length === 0 || rawName.length > 200) {
        return { success: false, error: "Tool name must be a non-empty string.", executionTimeMs: elapsed() };
      }

      if (!isPlainSerializable(rawArgs)) {
        return {
          success: false,
          error: "Tool arguments must be a plain, JSON-serializable value.",
          executionTimeMs: elapsed(),
        };
      }

      const tool = getTool(rawName);
      if (!tool) {
        return { success: false, error: `Unknown tool: "${rawName}"`, executionTimeMs: elapsed() };
      }

      let validatedArgs: unknown;
      try {
        validatedArgs = tool.validateArgs(rawArgs);
      } catch (err: any) {
        return {
          success: false,
          error: `Invalid arguments for "${rawName}": ${err?.message ?? String(err)}`,
          executionTimeMs: elapsed(),
        };
      }

      try {
        const data = await withTimeout(
          Promise.resolve(tool.handler(validatedArgs)),
          DEFAULT_TOOL_TIMEOUT_MS
        );
        return { success: true, data, executionTimeMs: elapsed() };
      } catch (err: any) {
        return { success: false, error: err?.message ?? String(err), executionTimeMs: elapsed() };
      }
    }
  );
}
