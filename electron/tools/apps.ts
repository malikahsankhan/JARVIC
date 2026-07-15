import fs from "fs";
import path from "path";
import os from "os";
import { registerTool } from "../ipc/toolRegistry";
import { assertWindows, launchDetached, runCaptured } from "./lib";

const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
const localAppData = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData", "Local");
const windir = process.env["WINDIR"] || "C:\\Windows";

type AppSpec =
  | { kind: "system-exe"; exe: string; args?: string[] }
  | { kind: "resolve-path"; candidates: string[]; args?: string[] }
  | { kind: "protocol"; uri: string };

/**
 * Fixed catalogue of openable apps. The AI can only pick a `key` from this
 * map — it never supplies a raw path or command line, which is what keeps
 * this immune to injection regardless of what the model is told to say.
 */
const KNOWN_APPS: Record<string, AppSpec> = {
  notepad: { kind: "system-exe", exe: path.join(windir, "System32", "notepad.exe") },
  calculator: { kind: "system-exe", exe: path.join(windir, "System32", "calc.exe") },
  paint: { kind: "system-exe", exe: path.join(windir, "System32", "mspaint.exe") },
  explorer: { kind: "system-exe", exe: path.join(windir, "explorer.exe") },
  "task-manager": { kind: "system-exe", exe: path.join(windir, "System32", "Taskmgr.exe") },
  "control-panel": { kind: "system-exe", exe: path.join(windir, "System32", "control.exe") },
  settings: { kind: "protocol", uri: "ms-settings:" },
  cmd: { kind: "system-exe", exe: path.join(windir, "System32", "cmd.exe") },
  powershell: { kind: "system-exe", exe: path.join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") },
  "windows-terminal": { kind: "system-exe", exe: "wt.exe" },
  "device-manager": { kind: "system-exe", exe: path.join(windir, "System32", "mmc.exe"), args: [path.join(windir, "System32", "devmgmt.msc")] },
  // Sensitive — only reachable via this explicit, named key, never a generic "run anything" path.
  "registry-editor": { kind: "system-exe", exe: path.join(windir, "regedit.exe") },
  chrome: {
    kind: "resolve-path",
    candidates: [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ],
  },
  edge: {
    kind: "resolve-path",
    candidates: [
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    ],
  },
  vscode: {
    kind: "resolve-path",
    candidates: [
      path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
      path.join(programFiles, "Microsoft VS Code", "Code.exe"),
    ],
  },
  word: { kind: "resolve-path", candidates: [
    path.join(programFiles, "Microsoft Office", "root", "Office16", "WINWORD.EXE"),
    path.join(programFilesX86, "Microsoft Office", "root", "Office16", "WINWORD.EXE"),
  ]},
  excel: { kind: "resolve-path", candidates: [
    path.join(programFiles, "Microsoft Office", "root", "Office16", "EXCEL.EXE"),
    path.join(programFilesX86, "Microsoft Office", "root", "Office16", "EXCEL.EXE"),
  ]},
  powerpoint: { kind: "resolve-path", candidates: [
    path.join(programFiles, "Microsoft Office", "root", "Office16", "POWERPNT.EXE"),
    path.join(programFilesX86, "Microsoft Office", "root", "Office16", "POWERPNT.EXE"),
  ]},
};

function resolveCandidate(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

registerTool({
  name: "apps.listKnown",
  description: "Lists the app keys apps.open understands (e.g. 'notepad', 'chrome', 'vscode').",
  validateArgs: () => undefined,
  handler: () => Object.keys(KNOWN_APPS).sort(),
});

registerTool({
  name: "apps.open",
  description: "Opens a known application by key. Use apps.listKnown to see valid keys.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).key !== "string") {
      throw new Error('Expected { key: string }');
    }
    const key = (raw as any).key as string;
    if (!(key in KNOWN_APPS)) {
      throw new Error(`Unknown app key "${key}". Call apps.listKnown for valid options.`);
    }
    return { key };
  },
  handler: ({ key }: { key: string }) => {
    assertWindows("apps.open");
    const spec = KNOWN_APPS[key];

    if (spec.kind === "protocol") {
      launchDetached(path.join(windir, "System32", "cmd.exe"), ["/c", "start", "", spec.uri]);
      return { opened: key, message: `Opened ${key}.` };
    }

    const exePath = spec.kind === "system-exe" ? spec.exe : resolveCandidate(spec.candidates);
    if (!exePath) {
      throw new Error(`Could not locate an installation of "${key}" on this machine.`);
    }
    launchDetached(exePath, spec.args ?? []);
    return { opened: key, path: exePath, message: `Opened ${key}.` };
  },
});

registerTool({
  name: "apps.close",
  description: "Closes/terminates a running application by its process (image) name, e.g. 'notepad.exe'.",
  destructive: true,
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).processName !== "string") {
      throw new Error("Expected { processName: string }");
    }
    const processName = (raw as any).processName as string;
    // Windows image names: letters, numbers, spaces, ., -, _ only. Blocks anything
    // that could look like a flag or path traversal even though execFile args
    // already prevent shell injection.
    if (!/^[\w .-]{1,100}\.exe$/i.test(processName)) {
      throw new Error('processName must look like "name.exe"');
    }
    return { processName };
  },
  handler: async ({ processName }: { processName: string }) => {
    assertWindows("apps.close");
    const output = await runCaptured(path.join(windir, "System32", "taskkill.exe"), ["/IM", processName, "/F"]);
    return { closed: processName, output: output.trim() };
  },
});
