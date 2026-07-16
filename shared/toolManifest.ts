export type JsonSchemaType = "object" | "string" | "number" | "boolean" | "array";

export interface JsonSchemaProperty {
  type: JsonSchemaType;
  description?: string;
  enum?: string[];
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  /** True if this tool is irreversible/high-impact and must never be called without the user explicitly agreeing first. */
  destructive?: boolean;
  parameters: {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
}

const KNOWN_APP_KEYS = [
  "notepad", "calculator", "paint", "explorer", "task-manager", "control-panel",
  "settings", "cmd", "powershell", "windows-terminal", "device-manager",
  "registry-editor", "snipping-tool", "chrome", "edge", "vscode", "word", "excel", "powerpoint",
];

const KNOWN_FOLDER_KEYS = ["home", "desktop", "documents", "downloads", "pictures", "videos"];

export const TOOL_MANIFEST: ToolManifestEntry[] = [
  {
    name: "apps.open",
    description: "Opens a known Windows application by key.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "One of: " + KNOWN_APP_KEYS.join(", "), enum: KNOWN_APP_KEYS } },
      required: ["key"],
    },
  },
  {
    name: "apps.close",
    description: "Closes/terminates a running application by its process (image) name, e.g. 'notepad.exe'.",
    destructive: true,
    parameters: {
      type: "object",
      properties: { processName: { type: "string", description: "Process image name, e.g. 'notepad.exe'." } },
      required: ["processName"],
    },
  },
  {
    name: "folders.openKnown",
    description: "Opens a well-known folder in File Explorer.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", enum: KNOWN_FOLDER_KEYS } },
      required: ["key"],
    },
  },
  {
    name: "folders.open",
    description: "Opens an arbitrary existing folder path in File Explorer.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute folder path." } },
      required: ["path"],
    },
  },
  {
    name: "folders.create",
    description: "Creates a new folder (and missing parents) at the given path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "folders.rename",
    description: "Renames or moves a folder.",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "folders.copy",
    description: "Recursively copies a folder to a new location.",
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
  },
  {
    name: "folders.delete",
    description: "PERMANENTLY deletes a folder and its contents. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        confirm: { type: "boolean", description: "Must be true, and only true once the user has explicitly agreed." },
      },
      required: ["path", "confirm"],
    },
  },
  {
    name: "files.read",
    description: "Reads a text file's contents (UTF-8, up to 5MB).",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "files.write",
    description: "Writes (overwrites) a text file with the given content.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "files.writeAndOpenInNotepad",
    description:
      "Writes text to a file AND opens it in Notepad, already saved, in one call. ALWAYS prefer this over apps.open + input.typeText + Ctrl+S for 'write X and save it' / 'open notepad and type X' requests — it's far more reliable.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        path: { type: "string", description: "Optional; defaults to a timestamped file in Documents." },
      },
      required: ["content"],
    },
  },
  {
    name: "files.append",
    description: "Appends text to the end of a file, creating it if needed.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "files.delete",
    description: "PERMANENTLY deletes a single file. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        confirm: { type: "boolean", description: "Must be true, and only true once the user has explicitly agreed." },
      },
      required: ["path", "confirm"],
    },
  },
  {
    name: "files.search",
    description: "Searches for files by partial filename and/or extension under a root folder.",
    parameters: {
      type: "object",
      properties: {
        root: { type: "string", description: "Folder to search under. Defaults to the user's home folder." },
        nameContains: { type: "string" },
        extension: { type: "string", description: "e.g. 'pdf' (no leading dot)." },
      },
    },
  },
  {
    name: "processes.list",
    description: "Lists running processes with PID, name, CPU time, and memory.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "processes.kill",
    description: "Forcefully terminates a process by PID.",
    destructive: true,
    parameters: { type: "object", properties: { pid: { type: "number" } }, required: ["pid"] },
  },
  {
    name: "system.wait",
    description:
      "Pauses briefly (max 5000ms) before your next tool call. Use after apps.open, right before typing/clicking into the newly opened window.",
    parameters: {
      type: "object",
      properties: { ms: { type: "number", description: "Milliseconds to wait, capped at 5000." } },
    },
  },
  {
    name: "system.usage",
    description: "Reports CPU load, RAM usage, and uptime.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system.diskUsage",
    description: "Reports free/used space for each local disk drive.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system.batteryStatus",
    description: "Reports battery presence, charge percentage, and charging status.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system.internetStatus",
    description: "Checks whether the machine currently has internet connectivity.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system.lock",
    description: "Locks the workstation (same as Win+L).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "system.sleep",
    description: "Puts the machine to sleep. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: {
      type: "object",
      properties: { confirm: { type: "boolean", description: "Must be true, and only true once the user has explicitly agreed." } },
      required: ["confirm"],
    },
  },
  {
    name: "system.restart",
    description: "Restarts the machine. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: {
      type: "object",
      properties: { confirm: { type: "boolean", description: "Must be true, and only true once the user has explicitly agreed." } },
      required: ["confirm"],
    },
  },
  {
    name: "system.shutdown",
    description: "Shuts the machine down. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: {
      type: "object",
      properties: { confirm: { type: "boolean", description: "Must be true, and only true once the user has explicitly agreed." } },
      required: ["confirm"],
    },
  },
  {
    name: "web.googleSearch",
    description: "Opens Google search results for a query in JARVIC's controlled window.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "web.googleImageSearch",
    description:
      "Opens Google's Images tab for a query in JARVIC's controlled window. Use this for 'search X and show images' / 'in the images section' requests.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "web.open",
    description: "Opens any URL in JARVIC's own controlled browser window (not the user's default browser).",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "web.evaluate",
    description: "Runs JavaScript in JARVIC's controlled media window and returns the result.",
    parameters: {
      type: "object",
      properties: { script: { type: "string" } },
      required: ["script"],
    },
  },
  {
    name: "web.scroll",
    description: "Scrolls the page in JARVIC's controlled media window up or down.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "number", description: "Pixels to scroll, default 600." },
      },
    },
  },
  {
    name: "web.clickByText",
    description:
      "Clicks the first visible button/link whose text matches (partial, case-insensitive), e.g. 'Sign In', 'Accept all', 'Skip'. Prefer this over web.click for real websites, since you can't see their CSS selectors.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "web.click",
    description: "Clicks the first element matching the given CSS selector in JARVIC's controlled media window.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
  },
  {
    name: "web.type",
    description: "Types text into the first matching input or textarea element in JARVIC's controlled media window.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "web.youtubePlaySong",
    description:
      "One-call action for 'play X on YouTube' requests: searches, clicks the first result, and tries to auto-skip a pre-roll ad. ALWAYS use this single tool for play/song requests instead of chaining web.open + web.click yourself.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Song or video to search for and play." } },
      required: ["query"],
    },
  },
  {
    name: "system.takeScreenshot",
    description:
      "Captures a full screenshot/screen-capture image of the display and saves it as a PNG file. ONLY use this when the user explicitly asks to take/save a screenshot or capture the screen. Never use this in response to a request to type, write, or enter text.",
    parameters: {
      type: "object",
      properties: { fileName: { type: "string", description: "Optional filename, defaults to a timestamped name." } },
    },
  },
  {
    name: "input.typeText",
    description:
      "Types/writes literal text into whatever window or input field currently has keyboard focus. Use this whenever the user asks you to type, write, or enter text somewhere — e.g. 'type X in notepad', 'write hello world'. This is the ONLY tool for fulfilling typing requests; it is unrelated to screenshots.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "input.pressKey",
    description: 'Presses a key or combo on the focused window, e.g. "enter", "ctrl+c", "alt+f4".',
    parameters: {
      type: "object",
      properties: { combo: { type: "string" } },
      required: ["combo"],
    },
  },
  {
    name: "input.mouseMove",
    description: "Moves the mouse cursor to absolute screen coordinates.",
    parameters: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
  },
  {
    name: "input.mouseClick",
    description: "Moves the mouse to (x, y) and clicks (left or right, optionally double-click).",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right"] },
        doubleClick: { type: "boolean" },
      },
      required: ["x", "y"],
    },
  },
];

export function isDestructiveTool(name: string): boolean {
  return TOOL_MANIFEST.find((t) => t.name === name)?.destructive ?? false;
}
