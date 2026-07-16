import { registerTool } from "../ipc/toolRegistry";
import { assertWindows, runPowerShell } from "./lib";

// --- Escaping -----------------------------------------------------------
// IMPORTANT: unlike every other tool in this project, the text here flows
// into a PowerShell *script string* that gets parsed/interpreted, not just
// passed as an inert argv entry. That means normal execFile-argument-array
// safety isn't enough by itself — we must also prevent the text from
// breaking out of the single-quoted PowerShell string literal, or it could
// inject arbitrary PowerShell commands. Both escaping steps below are
// required, in this order.

/** Wraps SendKeys' special characters in braces per its documented syntax. */
function escapeForSendKeys(text: string): string {
  return text.replace(/([+^%~(){}[\]])/g, "{$1}");
}

/** Escapes single quotes for safe embedding inside a PowerShell '...' string literal. */
function escapeForPowerShellSingleQuoted(text: string): string {
  return text.replace(/'/g, "''");
}

function str(raw: unknown, field: string): string {
  if (typeof raw !== "object" || raw === null || typeof (raw as any)[field] !== "string" || !(raw as any)[field].trim()) {
    throw new Error(`Expected "${field}" to be a non-empty string`);
  }
  return (raw as any)[field];
}

function int(raw: unknown, field: string): number {
  const value = typeof raw === "object" && raw !== null ? (raw as any)[field] : undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Expected "${field}" to be an integer`);
  }
  return value;
}

registerTool({
  name: "input.typeText",
  description:
    "Types literal text into whatever window/field currently has focus (like a user typing on the keyboard). Does not press Enter — use input.pressKey for that.",
  validateArgs: (raw) => ({ text: str(raw, "text") }),
  handler: async ({ text }: { text: string }) => {
    assertWindows("input.typeText");
    const safe = escapeForPowerShellSingleQuoted(escapeForSendKeys(text));
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${safe}')`
    );
    return { typed: text };
  },
});

const NAMED_KEYS: Record<string, string> = {
  enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}",
  space: " ", backspace: "{BACKSPACE}", delete: "{DELETE}", del: "{DELETE}",
  home: "{HOME}", end: "{END}", insert: "{INSERT}",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  pageup: "{PGUP}", pagedown: "{PGDN}",
  f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}", f6: "{F6}",
  f7: "{F7}", f8: "{F8}", f9: "{F9}", f10: "{F10}", f11: "{F11}", f12: "{F12}",
};
const MODIFIER_PREFIX: Record<string, string> = { ctrl: "^", control: "^", alt: "%", shift: "+" };

/** Converts a combo like "ctrl+shift+s" into SendKeys syntax like "^+s". Note: the Windows key isn't supported by SendKeys. */
function comboToSendKeys(combo: string): string {
  const parts = combo.toLowerCase().split(/[\s+]+/).filter(Boolean);
  if (parts.length === 0) throw new Error("Empty key combo");
  const last = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  let prefix = "";
  for (const mod of modifiers) {
    if (!(mod in MODIFIER_PREFIX)) throw new Error(`Unknown modifier "${mod}". Supported: ctrl, alt, shift.`);
    prefix += MODIFIER_PREFIX[mod];
  }

  let keyPart: string;
  if (last in NAMED_KEYS) keyPart = NAMED_KEYS[last];
  else if (/^[a-z0-9]$/.test(last)) keyPart = last;
  else throw new Error(`Unknown key "${last}".`);

  return prefix + keyPart;
}

registerTool({
  name: "input.pressKey",
  description:
    'Presses a single key or key combo on the currently focused window, e.g. "enter", "tab", "ctrl+c", "ctrl+shift+s", "f5", "alt+f4". Modifiers: ctrl, alt, shift (Windows key not supported).',
  validateArgs: (raw) => ({ combo: str(raw, "combo") }),
  handler: async ({ combo }: { combo: string }) => {
    assertWindows("input.pressKey");
    const sendKeysCombo = comboToSendKeys(combo);
    const safe = escapeForPowerShellSingleQuoted(sendKeysCombo);
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${safe}')`
    );
    return { pressed: combo };
  },
});

const MOUSE_HELPER_TYPE = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class JarvicMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
`;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;

registerTool({
  name: "input.mouseMove",
  description: "Moves the mouse cursor to absolute screen coordinates (x, y), without clicking.",
  validateArgs: (raw) => ({ x: int(raw, "x"), y: int(raw, "y") }),
  handler: async ({ x, y }: { x: number; y: number }) => {
    assertWindows("input.mouseMove");
    await runPowerShell(`${MOUSE_HELPER_TYPE}\n[JarvicMouse]::SetCursorPos(${x}, ${y})`);
    return { movedTo: { x, y } };
  },
});

registerTool({
  name: "input.mouseClick",
  description:
    "Moves the mouse to (x, y) and clicks. button: 'left' (default) or 'right'. Set doubleClick: true for a double-click.",
  validateArgs: (raw) => {
    const x = int(raw, "x");
    const y = int(raw, "y");
    const buttonRaw = typeof raw === "object" && raw !== null ? (raw as any).button : undefined;
    const button = buttonRaw === "right" ? "right" : "left";
    const doubleClick = typeof raw === "object" && raw !== null && (raw as any).doubleClick === true;
    return { x, y, button, doubleClick };
  },
  handler: async ({ x, y, button, doubleClick }: { x: number; y: number; button: "left" | "right"; doubleClick: boolean }) => {
    assertWindows("input.mouseClick");
    const [down, up] = button === "right" ? [MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP] : [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP];
    const clickOnce = `[JarvicMouse]::mouse_event(${down},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 30; [JarvicMouse]::mouse_event(${up},0,0,0,[UIntPtr]::Zero)`;
    const script = doubleClick
      ? `${MOUSE_HELPER_TYPE}\n[JarvicMouse]::SetCursorPos(${x}, ${y})\n${clickOnce}\nStart-Sleep -Milliseconds 50\n${clickOnce}`
      : `${MOUSE_HELPER_TYPE}\n[JarvicMouse]::SetCursorPos(${x}, ${y})\n${clickOnce}`;
    await runPowerShell(script);
    return { clickedAt: { x, y }, button, doubleClick };
  },
});
