import { execFile } from "child_process";
import path from "path";
import { registerTool } from "../ipc/toolRegistry";

const PYTHON_SCRIPT_PATH = path.join(__dirname, "desktop_automation.py");

function runPythonCommand(args: any): Promise<any> {
  return new Promise((resolve, reject) => {
    // Run python with the script path and serialized JSON arguments
    execFile("python", [PYTHON_SCRIPT_PATH, JSON.stringify(args)], (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Python execution error: ${error.message || stderr}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.status === "error") {
          return reject(new Error(parsed.message));
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout}. Stderr: ${stderr}`));
      }
    });
  });
}

registerTool({
  name: "desktop.listWindows",
  description: "Lists all active desktop windows with their titles and handles using pywinauto.",
  validateArgs: () => ({}),
  handler: async () => {
    return runPythonCommand({ command: "list_windows" });
  },
});

registerTool({
  name: "desktop.dumpControls",
  description: "Dumps all UI controls and elements within a targeted window by title using pywinauto.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).windowTitle !== "string") {
      throw new Error("Expected { windowTitle: string }");
    }
    return { windowTitle: (raw as any).windowTitle as string };
  },
  handler: async ({ windowTitle }: { windowTitle: string }) => {
    return runPythonCommand({ command: "dump_controls", window_title: windowTitle });
  },
});

registerTool({
  name: "desktop.clickControl",
  description: "Clicks a specific control element (button, menu, edit box) inside a window using pywinauto.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).windowTitle !== "string") {
      throw new Error("Expected { windowTitle: string }");
    }
    return {
      windowTitle: (raw as any).windowTitle as string,
      controlText: (raw as any).controlText as string | undefined,
      autoId: (raw as any).autoId as string | undefined,
      controlType: (raw as any).controlType as string | undefined,
    };
  },
  handler: async (args: { windowTitle: string; controlText?: string; autoId?: string; controlType?: string }) => {
    return runPythonCommand({
      command: "click_control",
      window_title: args.windowTitle,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
    });
  },
});

registerTool({
  name: "desktop.typeControl",
  description: "Focuses and types text into a control element within a window using pywinauto.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).windowTitle !== "string" || typeof (raw as any).text !== "string") {
      throw new Error("Expected { windowTitle: string, text: string }");
    }
    return {
      windowTitle: (raw as any).windowTitle as string,
      text: (raw as any).text as string,
      controlText: (raw as any).controlText as string | undefined,
      autoId: (raw as any).autoId as string | undefined,
      controlType: (raw as any).controlType as string | undefined,
    };
  },
  handler: async (args: { windowTitle: string; text: string; controlText?: string; autoId?: string; controlType?: string }) => {
    return runPythonCommand({
      command: "type_control",
      window_title: args.windowTitle,
      text: args.text,
      control_text: args.controlText,
      auto_id: args.autoId,
      control_type: args.controlType,
    });
  },
});
