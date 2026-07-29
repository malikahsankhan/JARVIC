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
  "registry-editor", "snipping-tool", "chrome", "edge", "vscode", "slack", "word", "excel", "powerpoint",
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
    name: "apps.searchAndOpen",
    description: "Searches for and opens ANY installed application by name (not just the known list). Scans Start Menu shortcuts, App Execution Aliases, and system PATH. Use this for apps not in apps.open.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Application name to search for (e.g. 'slack', 'spotify', 'obsidian')." } },
      required: ["name"],
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
      "Pauses briefly (max 5000ms) before your next tool call — a blind fixed sleep that always waits its full duration even if the target was ready sooner, and can still be too short. Use ONLY when you don't know the target window's title (so desktop.waitForWindow isn't possible), e.g. after apps.open for something with no distinct window (protocol/URI launches) or a quick fixed pause between unrelated steps. Whenever you know or can guess the window's title (including messaging apps like WhatsApp), call desktop.waitForWindow instead — it polls and returns as soon as the window actually appears.",
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
    description: "Opens Google search results for a query in the connected Chrome browser.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "web.googleImageSearch",
    description:
      "Opens Google's Images tab for a query in the connected Chrome browser. Use this for 'search X and show images' / 'in the images section' requests.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "web.open",
    description: "Opens any URL in the connected Chrome browser window.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "web.evaluate",
    description: "Runs JavaScript in the connected Chrome browser and returns the result.",
    parameters: {
      type: "object",
      properties: { script: { type: "string" } },
      required: ["script"],
    },
  },
  {
    name: "web.scroll",
    description: "Scrolls the page in the connected Chrome browser up or down.",
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
    description: "Clicks the first element matching the given CSS selector in the connected Chrome browser.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
  },
  {
    name: "web.type",
    description: "Types text into the first matching input or textarea element in the connected Chrome browser.",
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
    name: "screen.readText",
    description:
      "Reads all text currently visible anywhere on screen using OCR — works on games, images, PDFs, and any custom-drawn UI with no accessibility tree, unlike desktop.dumpControls (which only sees UIA-exposed controls). Returns full text plus per-line/per-word coordinates. Use this when desktop.dumpControls fails to find something, or the target isn't a standard control.",
    parameters: { type: "object", properties: {} },
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
  {
    name: "desktop.listWindows",
    description: "Lists all active desktop windows with their titles, class names, and handles. Uses UIA (pywinauto) with automatic uiautomation/Win32 fallback.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "desktop.waitForWindow",
    description:
      "Polls for a window whose title matches (partial/regex) windowTitle to actually appear, returning as soon as it does — instead of a blind fixed sleep. Use this after apps.open/apps.searchAndOpen/web.open before clicking or typing into the new window, especially for apps with variable load time (e.g. WhatsApp Desktop, WhatsApp Web, Slack, Teams, any browser-based app). Prefer this over system.wait whenever you know the window's title: system.wait always sleeps its full duration even if the window was ready sooner, and can still time out too early if the window takes longer than the ms you guessed.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string", description: "Partial name or regex matching the window title to wait for, e.g. \"WhatsApp\"." },
        timeoutMs: { type: "number", description: "Max time to wait in milliseconds, capped at 20000. Defaults to 12000." },
      },
      required: ["windowTitle"],
    },
  },
  {
    name: "desktop.getActiveWindow",
    description: "Returns the title, class name, and handle of the currently focused/foreground window.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "desktop.dumpControls",
    description: "Dumps all UI controls and elements within a targeted window by title (regex). Works reliably across Slack, Teams, VS Code, Settings, browsers, and Office apps via UIA.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string", description: "Regular expression matching window title." }
      },
      required: ["windowTitle"],
    },
  },
  {
    name: "desktop.clickControl",
    description: "Clicks a specific control (button, menu item, checkbox, tab, list item) inside a window. Matches by automationId, name, control type, or class name, and tries multiple click strategies (Invoke, Selection, LegacyIAccessible, synthetic click, Win32/mouse fallback) so it never silently fails after one attempt.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.doubleClickControl",
    description: "Double-clicks a specific control inside a window, using the same multi-strategy fallback chain as desktop.clickControl.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.rightClickControl",
    description: "Right-clicks a specific control inside a window (e.g. to open a context menu), using the same multi-strategy fallback chain as desktop.clickControl.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.typeControl",
    description: "Focuses and types text into a control (edit box, search field, chat compose box) within a window. If no control is specified, types into whatever has focus. Tries ValuePattern, set_edit_text, type_keys, uiautomation SendKeys, then raw keyboard simulation, and verifies the resulting value.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        text: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" }
      },
      required: ["windowTitle", "text"]
    }
  },
  {
    name: "desktop.selectItem",
    description: "Selects an item in a list, combo box, tree, or tab control (e.g. a Slack channel, a dropdown option) using SelectionItemPattern, falling back to a click.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" },
        itemName: { type: "string", description: "Name of the item to select, if the control itself lists multiple items." }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.expandControl",
    description: "Expands a collapsible control (tree node, dropdown, sidebar section) using ExpandCollapsePattern, falling back to a click.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.collapseControl",
    description: "Collapses an expanded control (tree node, dropdown, sidebar section) using ExpandCollapsePattern, falling back to a click.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.scrollControl",
    description: "Scrolls a control (list, panel, chat log) up or down using ScrollPattern, falling back to a synthetic mouse wheel event.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" },
        controlType: { type: "string" },
        className: { type: "string" },
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "number", description: "Number of scroll lines/notches. Default 3." }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.setFocusControl",
    description: "Sets keyboard focus to a specific window or control within it, without clicking or typing.",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" }
      },
      required: ["windowTitle"]
    }
  },
  {
    name: "desktop.sendKeysToControl",
    description: 'Sends a key or key combo (e.g. "{ENTER}", "^c", "%{F4}") to a specific window, optionally focusing a control first. For typing into whatever currently has focus anywhere on the desktop, prefer input.typeText / input.pressKey instead.',
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        key: { type: "string" },
        controlText: { type: "string" },
        autoId: { type: "string" }
      },
      required: ["windowTitle", "key"]
    }
  },

  // ── WINDOW MANAGEMENT (per-window) ──────────────────────────────────────
  {
    name: "desktop.moveWindow",
    description: "Moves a window to absolute screen coordinates (x, y), keeping its current size.",
    parameters: {
      type: "object",
      properties: { windowTitle: { type: "string" }, x: { type: "number" }, y: { type: "number" } },
      required: ["windowTitle", "x", "y"],
    },
  },
  {
    name: "desktop.resizeWindow",
    description: "Resizes a window to the given width/height in pixels, keeping its current top-left position.",
    parameters: {
      type: "object",
      properties: { windowTitle: { type: "string" }, width: { type: "number" }, height: { type: "number" } },
      required: ["windowTitle", "width", "height"],
    },
  },
  {
    name: "desktop.setWindowState",
    description: "Minimizes, maximizes, or restores ONE specific window by title (system.minimizeAllWindows/restoreAllWindows act on every window instead).",
    parameters: {
      type: "object",
      properties: { windowTitle: { type: "string" }, state: { type: "string", enum: ["minimize", "maximize", "restore"] } },
      required: ["windowTitle", "state"],
    },
  },
  {
    name: "desktop.closeWindow",
    description: "Gracefully closes one specific window (like clicking its X button — the app may prompt to save). For force-killing an unresponsive app use apps.close or processes.kill.",
    parameters: { type: "object", properties: { windowTitle: { type: "string" } }, required: ["windowTitle"] },
  },
  {
    name: "desktop.snapWindow",
    description: "Snaps a window into a screen region on its current monitor (like Win+Arrow / Snap Layouts).",
    parameters: {
      type: "object",
      properties: {
        windowTitle: { type: "string" },
        position: { type: "string", enum: ["left", "right", "maximize", "top-left", "top-right", "bottom-left", "bottom-right"] },
      },
      required: ["windowTitle", "position"],
    },
  },
  {
    name: "desktop.moveWindowToMonitor",
    description: "Moves a window onto a specific monitor by index (see desktop.listMonitors), fitting it inside that monitor's usable work area.",
    parameters: {
      type: "object",
      properties: { windowTitle: { type: "string" }, monitorIndex: { type: "number" } },
      required: ["windowTitle", "monitorIndex"],
    },
  },
  {
    name: "desktop.listMonitors",
    description: "Lists all connected monitors with index, work area, and which one is primary.",
    parameters: { type: "object", properties: {} },
  },

  // ── VOLUME ──────────────────────────────────────────────────────────────
  { name: "system.setVolume", description: "Sets the master system volume to an exact percentage (0-100).", parameters: { type: "object", properties: { level: { type: "number", description: "Volume level 0-100" } }, required: ["level"] } },
  { name: "system.adjustVolume", description: "Adjusts volume up/down or toggles mute. Steps (default 5) sets how many key-taps.", parameters: { type: "object", properties: { action: { type: "string", enum: ["up", "down", "mute"] }, steps: { type: "number" } }, required: ["action"] } },
  { name: "system.getVolume", description: "Gets the current master volume level and mute state.", parameters: { type: "object", properties: {} } },

  // ── BRIGHTNESS ───────────────────────────────────────────────────────────
  { name: "system.getBrightness", description: "Gets current screen brightness percentage.", parameters: { type: "object", properties: {} } },
  { name: "system.setBrightness", description: "Sets screen brightness to a percentage (0-100). Works on laptops with WMI support.", parameters: { type: "object", properties: { level: { type: "number", description: "Brightness 0-100" } }, required: ["level"] } },

  // ── CLIPBOARD ────────────────────────────────────────────────────────────
  { name: "clipboard.read", description: "Reads the current text content of the system clipboard.", parameters: { type: "object", properties: {} } },
  { name: "clipboard.write", description: "Overwrites the system clipboard with text.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "clipboard.clear", description: "Clears the system clipboard.", parameters: { type: "object", properties: {} } },

  // ── AUDIO DEVICES ────────────────────────────────────────────────────────
  { name: "audio.listDevices", description: "Lists available audio playback/recording devices.", parameters: { type: "object", properties: {} } },
  {
    name: "audio.setDefaultDevice",
    description: "Sets the default audio playback device by (partial, case-insensitive) name. Requires the third-party AudioDeviceCmdlets PowerShell module.",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },

  // ── WI-FI ───────────────────────────────────────────────────────────────
  { name: "wifi.status", description: "Gets current Wi-Fi connection status and SSID.", parameters: { type: "object", properties: {} } },
  { name: "wifi.listNetworks", description: "Lists nearby Wi-Fi networks with signal strength.", parameters: { type: "object", properties: {} } },
  { name: "wifi.enable", description: "Enables Wi-Fi adapter.", parameters: { type: "object", properties: {} } },
  { name: "wifi.disable", description: "Disables Wi-Fi adapter.", destructive: true, parameters: { type: "object", properties: {} } },
  {
    name: "wifi.connect",
    description: "Connects to a Wi-Fi network by SSID. Pass a password to create the profile if it doesn't already exist.",
    parameters: {
      type: "object",
      properties: { ssid: { type: "string" }, password: { type: "string" } },
      required: ["ssid"],
    },
  },

  // ── NETWORK ──────────────────────────────────────────────────────────────
  { name: "network.info", description: "Returns detailed network adapter info: IP, MAC, DNS, gateway.", parameters: { type: "object", properties: {} } },
  { name: "network.publicIp", description: "Fetches the machine's current public IP address.", parameters: { type: "object", properties: {} } },

  // ── BLUETOOTH ────────────────────────────────────────────────────────────
  { name: "bluetooth.status", description: "Checks whether Bluetooth is enabled and lists paired devices.", parameters: { type: "object", properties: {} } },

  // ── RECYCLE BIN ──────────────────────────────────────────────────────────
  { name: "recycleBin.size", description: "Reports items count and total size (MB) in the Recycle Bin.", parameters: { type: "object", properties: {} } },
  { name: "recycleBin.empty", description: "Permanently empties the Recycle Bin. Requires explicit user confirmation.", destructive: true, parameters: { type: "object", properties: { confirm: { type: "boolean" } }, required: ["confirm"] } },

  // ── SERVICES ─────────────────────────────────────────────────────────────
  { name: "services.status", description: "Gets the status of a single Windows service by its short Name.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "services.start", description: "Starts a stopped Windows service by its short Name.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  {
    name: "services.stop",
    description: "Stops a running Windows service by its short Name. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: { type: "object", properties: { name: { type: "string" }, confirm: { type: "boolean" } }, required: ["name", "confirm"] },
  },
  {
    name: "services.restart",
    description: "Restarts a Windows service by its short Name. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: { type: "object", properties: { name: { type: "string" }, confirm: { type: "boolean" } }, required: ["name", "confirm"] },
  },

  // ── POWER PLANS ──────────────────────────────────────────────────────────
  { name: "system.listPowerPlans", description: "Lists available Windows power plans and which is active.", parameters: { type: "object", properties: {} } },
  { name: "system.setPowerPlan", description: "Switches the active Windows power plan by GUID (from system.listPowerPlans).", parameters: { type: "object", properties: { guid: { type: "string" } }, required: ["guid"] } },

  // ── STARTUP APPS ─────────────────────────────────────────────────────────
  { name: "system.listStartupApps", description: "Lists programs configured to launch at sign-in (Registry Run keys).", parameters: { type: "object", properties: {} } },
  { name: "system.addStartupApp", description: "Adds a program to the current user's startup.", parameters: { type: "object", properties: { name: { type: "string" }, command: { type: "string" } }, required: ["name", "command"] } },
  {
    name: "system.removeStartupApp",
    description: "Removes a program from the current user's startup. Requires the user to have explicitly agreed first.",
    destructive: true,
    parameters: { type: "object", properties: { name: { type: "string" }, confirm: { type: "boolean" } }, required: ["name", "confirm"] },
  },

  // ── SYSTEM INFO ──────────────────────────────────────────────────────────
  { name: "system.hostname", description: "Returns the PC's hostname, Windows edition, build, and current logged-in user.", parameters: { type: "object", properties: {} } },
  { name: "system.installedApps", description: "Lists all installed applications (name, publisher, version) from Windows registry.", parameters: { type: "object", properties: {} } },
  { name: "system.runningServices", description: "Lists all currently running Windows services.", parameters: { type: "object", properties: {} } },
  { name: "system.envVars", description: "Lists all current system and user environment variables.", parameters: { type: "object", properties: {} } },
  { name: "system.setEnvVar", description: "Sets a persistent user-level environment variable.", parameters: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } },

  // ── DISPLAY & SETTINGS ───────────────────────────────────────────────────
  { name: "system.getScreenResolution", description: "Returns current screen resolution and number of monitors.", parameters: { type: "object", properties: {} } },
  { name: "system.openSettings", description: "Opens a Windows Settings page. Pages: home, display, sound, notifications, wifi, bluetooth, power, storage, apps, accounts, update, privacy.", parameters: { type: "object", properties: { page: { type: "string" } } } },
  { name: "system.openActionCenter", description: "Opens the Windows Action Center / notifications panel.", parameters: { type: "object", properties: {} } },
  { name: "system.openTaskbar", description: "Opens/shows the Windows Start Menu and Taskbar.", parameters: { type: "object", properties: {} } },

  // ── POWER TIMER ──────────────────────────────────────────────────────────
  { name: "system.setShutdownTimer", description: "Schedules automatic shutdown after N minutes. Set minutes=0 to cancel.", parameters: { type: "object", properties: { minutes: { type: "number" } }, required: ["minutes"] } },

  // ── WINDOW MANAGEMENT ────────────────────────────────────────────────────
  { name: "system.minimizeAllWindows", description: "Minimizes all windows to show the desktop (like Win+D).", parameters: { type: "object", properties: {} } },
  { name: "system.restoreAllWindows", description: "Restores all previously minimized windows.", parameters: { type: "object", properties: {} } },
  { name: "system.switchWindow", description: "Switches to the next open application window (like Alt+Tab).", parameters: { type: "object", properties: {} } },

  // ── RAW COMMAND EXECUTION ────────────────────────────────────────────────
  {
    name: "system.runCommand",
    description:
      "Runs a single arbitrary PowerShell command line and returns stdout/stderr. Last-resort escape hatch — ALWAYS prefer a specific existing tool first. Every call is permanently audit-logged. Requires the user to have explicitly agreed to the exact command first.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The exact PowerShell command line to run." },
        confirm: { type: "boolean", description: "Must be true, and only true once the user has explicitly agreed to this exact command." },
        timeoutMs: { type: "number", description: "Optional timeout in milliseconds, default 20000, max 60000." },
      },
      required: ["command", "confirm"],
    },
  },
  {
    name: "system.readRunCommandAuditLog",
    description: "Reads the last N entries of the system.runCommand audit log — what commands were run, when, and their result.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Max entries to return, default 50, max 500." } },
    },
  },
];



export function isDestructiveTool(name: string): boolean {
  return TOOL_MANIFEST.find((t) => t.name === name)?.destructive ?? false;
}
