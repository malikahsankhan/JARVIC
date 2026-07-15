import { BrowserWindow } from "electron";

let mediaWindow: BrowserWindow | null = null;

export interface MediaWindowScriptResult<T = unknown> {
  result: T;
  url: string;
  title: string;
}

export interface MediaWindowInteractionResult {
  matched: boolean;
  url: string;
  title: string;
}

export function getOrCreateMediaWindow(): BrowserWindow {
  if (mediaWindow && !mediaWindow.isDestroyed()) {
    return mediaWindow;
  }

  mediaWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: "JARVIC Media Window",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  mediaWindow.on("closed", () => {
    mediaWindow = null;
  });

  return mediaWindow;
}

export function getMediaWindowIfOpen(): BrowserWindow | null {
  if (!mediaWindow || mediaWindow.isDestroyed()) {
    mediaWindow = null;
    return null;
  }
  return mediaWindow;
}

export async function openUrlInMediaWindow(url: string): Promise<void> {
  const window = getOrCreateMediaWindow();
  await window.loadURL(url);
  window.show();
  window.focus();
}

export async function evaluateInMediaWindow<T = unknown>(script: string): Promise<MediaWindowScriptResult<T>> {
  const window = getOrCreateMediaWindow();
  const result = await window.webContents.executeJavaScript(script, true);
  return {
    result: result as T,
    url: window.webContents.getURL(),
    title: window.webContents.getTitle(),
  };
}

export async function clickInMediaWindow(selector: string): Promise<MediaWindowInteractionResult> {
  const window = getOrCreateMediaWindow();
  const matched = await window.webContents.executeJavaScript(
    `(function () {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      el.click();
      return true;
    })();`,
    true
  );

  return {
    matched: Boolean(matched),
    url: window.webContents.getURL(),
    title: window.webContents.getTitle(),
  };
}

export async function typeIntoMediaWindow(selector: string, text: string): Promise<MediaWindowInteractionResult> {
  const window = getOrCreateMediaWindow();
  const matched = await window.webContents.executeJavaScript(
    `(function () {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })();`,
    true
  );

  return {
    matched: Boolean(matched),
    url: window.webContents.getURL(),
    title: window.webContents.getTitle(),
  };
}
