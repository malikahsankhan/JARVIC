import { execFile } from "child_process";
import path from "path";
import { app } from "electron";
import { registerTool } from "../ipc/toolRegistry";

// IMPORTANT: do NOT derive this path from __dirname. electron/main.ts (and
// everything it imports, including this file) gets bundled by esbuild into a
// single dist-electron/main.cjs, so __dirname at runtime resolves to
// dist-electron — not electron/tools where desktop_automation.py actually
// lives. Nothing copies the .py files there. Instead, resolve relative to
// the app root (dev: project root; packaged: extraResources), same pattern
// already used for whisper (see WHISPER_DIR in electron/main.ts).
const PYTHON_SCRIPT_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "automation", "desktop_automation.py")
  : path.join(app.getAppPath(), "electron", "tools", "desktop_automation.py");
const PYTHON_BIN = process.env.JARVIC_PYTHON_BIN || "python";
const EXEC_TIMEOUT_MS = 25_000; // stay under the 30s IPC timeout in handlers.ts

interface EngineResult {
  status: "success" | "error";
  message: string;
  method?: string | null;
  verified?: boolean | null;
  data?: unknown;
  logs?: string[];
}

function runPythonCommand(args: Record<string, unknown>): Promise<EngineResult> {
  return new Promise((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      [PYTHON_SCRIPT_PATH, JSON.stringify(args)],
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(`Python execution error: ${error.message || stderr}`));
        }
        try {
          const parsed: EngineResult = JSON.parse(stdout.trim());
          if (parsed.status === "error") {
            const err = new Error(parsed.message) as Error & { logs?: string[] };
            err.logs = parsed.logs;
            return reject(err);
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse automation engine output: ${stdout}. Stderr: ${stderr}`));
        }
      }
    );
  });
}

// Shared arg shape for anything that targets a control inside a window.
interface ControlArgs {
  windowTitle: string;
  controlText?: string;
  autoId?: string;
  controlType?: string;
  className?: string;
}

function validateControlArgs(raw: unknown, extra: string[] = []): ControlArgs {
  if (typeof raw !== "object" || raw === null || typeof (raw as any).windowTitle !== "string") {
    throw new Error(`Expected { windowTitle: string${extra.length ? ", " + extra.join(", ") : ""} }`);
  }
  const r = raw as any;
  return {
    windowTitle: r.windowTitle as string,
    controlText: r.controlText as string | undefined,
    autoId: r.autoId as string | undefined,
    controlType: r.controlType as string | undefined,
    className: r.className as string | undefined,
  };
}

registerTool({
  name: "desktop.listWindows",
  description: "Lists all active desktop windows with their titles, class names, and handles. Uses UIA (pywinauto), with uiautomation and raw Win32 enumeration as automatic fallbacks.",
  validateArgs: () => ({}),
  handler: async () => runPythonCommand({ command: "list_windows" }),
});

registerTool({
  name: "desktop.getActiveWindow",
  description: "Returns the title, class name, and handle of the currently focused/foreground window.",
  validateArgs: () => ({}),
  handler: async () => runPythonCommand({ command: "get_active_window" }),
});

registerTool({
  name: "desktop.dumpControls",
  description: "Dumps all UI controls/elements within a targeted window (matched by regex title), including name, control type, automation id, and class name. Works across Slack, Teams, VS Code, browsers, Office apps, and standard Win32 apps via UIA.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).windowTitle !== "string") {
      throw new Error("Expected { windowTitle: string }");
    }
    return { windowTitle: (raw as any).windowTitle as string };
  },
  handler: async ({ windowTitle }: { windowTitle: string }) =>
    runPythonCommand({ command: "dump_controls", window_title: windowTitle }),
});

registerTool({
  name: "desktop.clickControl",
  description:
    "Clicks a control (button, menu item, list item, tab, checkbox, etc.) inside a window. Matches the control by automationId, name, control type, or class name (in that order, with partial-text fallback). Attempts InvokePattern, SelectionItemPattern, LegacyIAccessible, synthetic ClickInput, then Win32/mouse fallback — never fails after a single method. Verifies focus/selection change after clicking when possible.",
  validateArgs: (raw) => validateControlArgs(raw),
  handler: async (args: ControlArgs) =>
    runPythonCommand({
      command: "click_control",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
    }),
});

registerTool({
  name: "desktop.doubleClickControl",
  description: "Double-clicks a control inside a window, using the same multi-strategy fallback chain as desktop.clickControl.",
  validateArgs: (raw) => validateControlArgs(raw),
  handler: async (args: ControlArgs) =>
    runPythonCommand({
      command: "double_click_control",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
    }),
});

registerTool({
  name: "desktop.rightClickControl",
  description: "Right-clicks a control inside a window (e.g. to open a context menu), using the same multi-strategy fallback chain as desktop.clickControl.",
  validateArgs: (raw) => validateControlArgs(raw),
  handler: async (args: ControlArgs) =>
    runPythonCommand({
      command: "right_click_control",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
    }),
});

registerTool({
  name: "desktop.typeControl",
  description:
    "Focuses and types text into a control (edit box, text area, search field, chat compose box, etc.) within a window. If no control is specified, types into whatever currently has focus in that window. Attempts ValuePattern (direct set), set_edit_text, type_keys, uiautomation SendKeys, then raw Win32 keyboard simulation — never fails after a single method. Verifies the resulting control value contains the typed text when possible.",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw, ["text: string"]);
    if (typeof (raw as any).text !== "string") {
      throw new Error("Expected { windowTitle: string, text: string }");
    }
    return { ...base, text: (raw as any).text as string };
  },
  handler: async (args: ControlArgs & { text: string }) =>
    runPythonCommand({
      command: "type_control",
      window_title: args.windowTitle,
      text: args.text,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
    }),
});

registerTool({
  name: "desktop.selectItem",
  description: "Selects an item in a list, combo box, tree, or tab control (e.g. a Slack channel, a dropdown option, a browser tab) using SelectionItemPattern, falling back to a click if the pattern is unsupported.",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw);
    return { ...base, itemName: (raw as any).itemName as string | undefined };
  },
  handler: async (args: ControlArgs & { itemName?: string }) =>
    runPythonCommand({
      command: "select_item",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
      item_name: args.itemName,
    }),
});

registerTool({
  name: "desktop.expandControl",
  description: "Expands a collapsible control (tree node, dropdown, sidebar section) using ExpandCollapsePattern, falling back to a click.",
  validateArgs: (raw) => validateControlArgs(raw),
  handler: async (args: ControlArgs) =>
    runPythonCommand({
      command: "expand_control",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
    }),
});

registerTool({
  name: "desktop.collapseControl",
  description: "Collapses an expanded control (tree node, dropdown, sidebar section) using ExpandCollapsePattern, falling back to a click.",
  validateArgs: (raw) => validateControlArgs(raw),
  handler: async (args: ControlArgs) =>
    runPythonCommand({
      command: "collapse_control",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
    }),
});

registerTool({
  name: "desktop.scrollControl",
  description: "Scrolls a control (list, panel, chat log) up or down using ScrollPattern, falling back to a synthetic mouse wheel event at the control's location.",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw);
    const direction = (raw as any).direction as string | undefined;
    if (direction && direction !== "up" && direction !== "down") {
      throw new Error('direction must be "up" or "down"');
    }
    return { ...base, direction: direction as "up" | "down" | undefined, amount: (raw as any).amount as number | undefined };
  },
  handler: async (args: ControlArgs & { direction?: "up" | "down"; amount?: number }) =>
    runPythonCommand({
      command: "scroll_control",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
      class_name: args.className,
      direction: args.direction ?? "down",
      amount: args.amount ?? 3,
    }),
});

registerTool({
  name: "desktop.setFocusControl",
  description: "Sets keyboard focus to a specific window or control within it, without clicking or typing.",
  validateArgs: (raw) => validateControlArgs(raw),
  handler: async (args: ControlArgs) =>
    runPythonCommand({
      command: "set_focus",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
    }),
});

registerTool({
  name: "desktop.sendKeysToControl",
  description: 'Sends a key or key combo (pywinauto send-keys syntax, e.g. "{ENTER}", "^c", "%{F4}") to a specific window, optionally focusing a control first. For simple "type this text wherever focus currently is" use input.typeText/input.pressKey instead.',
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).windowTitle !== "string" || typeof (raw as any).key !== "string") {
      throw new Error("Expected { windowTitle: string, key: string }");
    }
    const r = raw as any;
    return {
      windowTitle: r.windowTitle as string,
      key: r.key as string,
      controlText: r.controlText as string | undefined,
      autoId: r.autoId as string | undefined,
    };
  },
  handler: async (args: { windowTitle: string; key: string; controlText?: string; autoId?: string }) =>
    runPythonCommand({
      command: "press_key",
      window_title: args.windowTitle,
      key: args.key,
      control_text: args.controlText,
      auto_id: args.autoId,
    }),
});
