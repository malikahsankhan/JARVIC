import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import readline from "readline";
import path from "path";
import { app } from "electron";
import { registerTool } from "../ipc/toolRegistry";

// IMPORTANT: do NOT derive this path from __dirname. electron/main.ts (and
// everything it imports, including this file) gets bundled by esbuild into a
// single dist-electron/main.cjs, so __dirname at runtime resolves to
// dist-electron — not electron/tools where desktop_automation.py actually
// lives. Nothing copies the .py files there. Instead, resolve relative to
// the app root (dev: project root; packaged: extraResources), same pattern
// shipped alongside the packaged app so Python can execute it outside asar.
const PYTHON_SCRIPT_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "automation", "desktop_automation.py")
  : path.join(app.getAppPath(), "electron", "tools", "desktop_automation.py");
const PYTHON_BIN = process.env.JARVIC_PYTHON_BIN || "python";
const EXEC_TIMEOUT_MS = 25_000; // stay under the 30s IPC timeout in handlers.ts
const WORKER_READY_TIMEOUT_MS = 15_000; // pywinauto/uiautomation/pywin32 cold-import budget, first launch only

interface EngineResult {
  status: "success" | "error";
  message: string;
  method?: string | null;
  verified?: boolean | null;
  data?: unknown;
  logs?: string[];
}

// ---------------------------------------------------------------------------
// Persistent Python worker.
//
// Previously every single desktop.* tool call did:
//   execFile(PYTHON_BIN, [SCRIPT, JSON.stringify(args)])
// which spawns a brand-new interpreter and re-imports pywinauto/uiautomation/
// pywin32 (COM init included) on EVERY call — roughly 1-2.5s of pure overhead
// per action, even when the action itself is instant.
//
// Instead we keep one long-lived `python desktop_automation.py --serve`
// process alive for the app's whole session. Requests are newline-delimited
// JSON written to its stdin; responses are newline-delimited JSON read from
// its stdout, correlated by an incrementing `id`. If the worker dies (crash,
// killed, etc.) it is transparently respawned on the next call.
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (result: EngineResult) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let workerProcess: ChildProcessWithoutNullStreams | null = null;
let workerReady: Promise<void> | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingRequest>();

function failAllPending(reason: Error) {
  for (const { reject, timer } of pendingRequests.values()) {
    clearTimeout(timer);
    reject(reason);
  }
  pendingRequests.clear();
}

function spawnWorker(): Promise<void> {
  const proc = spawn(PYTHON_BIN, [PYTHON_SCRIPT_PATH, "--serve"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  workerProcess = proc;

  const rl = readline.createInterface({ input: proc.stdout });

  const readyPromise = new Promise<void>((resolveReady, rejectReady) => {
    const readyTimer = setTimeout(() => {
      rejectReady(new Error("Automation worker did not become ready in time."));
    }, WORKER_READY_TIMEOUT_MS);

    let sawReady = false;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      let parsed: EngineResult & { id: number | null };
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // ignore stray non-JSON stdout noise
      }

      if (!sawReady && parsed.id === null) {
        sawReady = true;
        clearTimeout(readyTimer);
        resolveReady();
        return;
      }

      const pending = parsed.id != null ? pendingRequests.get(parsed.id) : undefined;
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(parsed.id!);
        if (parsed.status === "error") {
          const err = new Error(parsed.message) as Error & { logs?: string[] };
          err.logs = parsed.logs;
          pending.reject(err);
        } else {
          pending.resolve(parsed);
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      // Python-side stack traces land here; surface them for debugging
      // without ever letting them get parsed as a tool result.
      console.error(`[desktop_automation worker] ${chunk.toString().trim()}`);
    });

    proc.on("exit", (code, signal) => {
      console.error(`[desktop_automation worker] exited (code=${code}, signal=${signal})`);
      failAllPending(new Error("Automation worker exited unexpectedly."));
      if (workerProcess === proc) {
        workerProcess = null;
        workerReady = null;
      }
      clearTimeout(readyTimer);
      rejectReady(new Error("Automation worker exited before becoming ready."));
    });

    proc.on("error", (err) => {
      clearTimeout(readyTimer);
      rejectReady(err);
    });
  });

  return readyPromise;
}

async function getReadyWorker(): Promise<ChildProcessWithoutNullStreams> {
  if (workerProcess && workerReady) {
    try {
      await workerReady;
      return workerProcess;
    } catch {
      // fall through and respawn
    }
  }
  workerReady = spawnWorker();
  await workerReady;
  return workerProcess!;
}

async function runPythonCommand(args: Record<string, unknown>): Promise<EngineResult> {
  const proc = await getReadyWorker();
  const id = nextRequestId++;

  return new Promise<EngineResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Automation command "${args.command}" timed out after ${EXEC_TIMEOUT_MS}ms.`));
    }, EXEC_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });

    proc.stdin.write(JSON.stringify({ id, ...args }) + "\n", (err) => {
      if (err) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(err);
      }
    });
  });
}

/** Called from main.ts during app shutdown so no orphaned python.exe is left running. */
export function shutdownAutomationWorker(): void {
  failAllPending(new Error("Automation worker shut down."));
  if (workerProcess) {
    workerProcess.kill();
    workerProcess = null;
    workerReady = null;
  }
}

// ---------------------------------------------------------------------------
// Tool registrations — UNCHANGED from before. They all still just call
// runPythonCommand(); only its internal implementation got faster.
// ---------------------------------------------------------------------------

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

// ─────────────────────────────────────────────────────────────────────────────
// WINDOW MANAGEMENT (move / resize / snap / minimize-maximize-restore / close /
// multi-monitor placement) — all routed through the same persistent Python
// worker above, so they're just as fast as the control-automation tools.
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "desktop.moveWindow",
  description: "Moves a window to absolute screen coordinates (x, y), keeping its current size.",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw, ["x: number", "y: number"]);
    const x = (raw as any).x, y = (raw as any).y;
    if (typeof x !== "number" || typeof y !== "number") throw new Error("Expected { windowTitle: string, x: number, y: number }");
    return { ...base, x, y };
  },
  handler: async (args: ControlArgs & { x: number; y: number }) =>
    runPythonCommand({ command: "move_window", window_title: args.windowTitle, x: args.x, y: args.y }),
});

registerTool({
  name: "desktop.resizeWindow",
  description: "Resizes a window to the given width and height in pixels, keeping its current top-left position.",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw, ["width: number", "height: number"]);
    const width = (raw as any).width, height = (raw as any).height;
    if (typeof width !== "number" || typeof height !== "number") throw new Error("Expected { windowTitle: string, width: number, height: number }");
    return { ...base, width, height };
  },
  handler: async (args: ControlArgs & { width: number; height: number }) =>
    runPythonCommand({ command: "resize_window", window_title: args.windowTitle, width: args.width, height: args.height }),
});

registerTool({
  name: "desktop.setWindowState",
  description: "Minimizes, maximizes, or restores a specific window by title (unlike system.minimizeAllWindows/restoreAllWindows, which act on every window).",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw, ["state: 'minimize'|'maximize'|'restore'"]);
    const state = (raw as any).state;
    if (state !== "minimize" && state !== "maximize" && state !== "restore") {
      throw new Error("Expected state to be one of: minimize, maximize, restore");
    }
    return { ...base, state };
  },
  handler: async (args: ControlArgs & { state: "minimize" | "maximize" | "restore" }) =>
    runPythonCommand({ command: "set_window_state", window_title: args.windowTitle, state: args.state }),
});

registerTool({
  name: "desktop.closeWindow",
  description: "Gracefully closes a specific window (sends WM_CLOSE, same as clicking its X button) — the app gets a chance to prompt for unsaved changes. For force-terminating an unresponsive app, use apps.close or processes.kill instead.",
  validateArgs: (raw) => validateControlArgs(raw),
  handler: async (args: ControlArgs) => runPythonCommand({ command: "close_window", window_title: args.windowTitle }),
});

registerTool({
  name: "desktop.snapWindow",
  description: "Snaps a window into a screen region on its current monitor: left, right, maximize, top-left, top-right, bottom-left, or bottom-right (same idea as Windows' Snap Layouts / Win+arrow).",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw, ["position: string"]);
    const position = (raw as any).position;
    const valid = ["left", "right", "maximize", "top-left", "top-right", "bottom-left", "bottom-right"];
    if (!valid.includes(position)) throw new Error(`position must be one of: ${valid.join(", ")}`);
    return { ...base, position };
  },
  handler: async (args: ControlArgs & { position: string }) =>
    runPythonCommand({ command: "snap_window", window_title: args.windowTitle, position: args.position }),
});

registerTool({
  name: "desktop.moveWindowToMonitor",
  description: "Moves a window onto a specific monitor (by index — see desktop.listMonitors), fitting it inside that monitor's usable work area.",
  validateArgs: (raw) => {
    const base = validateControlArgs(raw, ["monitorIndex: number"]);
    const monitorIndex = (raw as any).monitorIndex;
    if (typeof monitorIndex !== "number") throw new Error("Expected { windowTitle: string, monitorIndex: number }");
    return { ...base, monitorIndex };
  },
  handler: async (args: ControlArgs & { monitorIndex: number }) =>
    runPythonCommand({ command: "move_window_to_monitor", window_title: args.windowTitle, monitor_index: args.monitorIndex }),
});

registerTool({
  name: "desktop.listMonitors",
  description: "Lists all connected monitors with their index, work area, and which one is primary — use the index with desktop.moveWindowToMonitor.",
  validateArgs: () => ({}),
  handler: async () => runPythonCommand({ command: "list_monitors" }),
});
