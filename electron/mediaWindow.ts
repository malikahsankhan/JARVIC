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

export async function scrollMediaWindow(direction: "up" | "down", amount: number): Promise<MediaWindowInteractionResult> {
  const window = getOrCreateMediaWindow();
  const delta = direction === "down" ? amount : -amount;
  await window.webContents.executeJavaScript(`window.scrollBy({ top: ${delta}, behavior: "smooth" });`, true);
  return {
    matched: true,
    url: window.webContents.getURL(),
    title: window.webContents.getTitle(),
  };
}

/**
 * Clicks the first visible, clickable element (button, link, or role=button)
 * whose text content includes the given string (case-insensitive). This lets
 * the model click things by what they SAY on screen ("Sign In", "Accept all",
 * "Skip") rather than having to guess a CSS selector for a page it has never
 * inspected.
 */
export async function clickByTextInMediaWindow(text: string): Promise<MediaWindowInteractionResult> {
  const window = getOrCreateMediaWindow();
  const matched = await window.webContents.executeJavaScript(
    `(function () {
      const needle = ${JSON.stringify(text)}.toLowerCase().trim();
      const candidates = Array.from(document.querySelectorAll(
        'button, a, [role="button"], input[type="submit"], input[type="button"], summary'
      ));
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const getLabel = (el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase().trim();
      const match = candidates.find((el) => isVisible(el) && getLabel(el).includes(needle));
      if (!match) return false;
      match.scrollIntoView({ block: "center" });
      match.click();
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

export interface PlayYoutubeSongResult {
  searchUrl: string;
  clicked: boolean;
  adSkipped: boolean;
}

/**
 * One-shot "play a song on YouTube": searches, waits for and clicks the
 * first result, then polls for a skippable pre-roll ad and clicks Skip if
 * one appears. Not every ad is skippable (some are forced) — adSkipped:false
 * in that case is expected, not a failure.
 */
export async function playYoutubeSong(query: string): Promise<PlayYoutubeSongResult> {
  const window = getOrCreateMediaWindow();
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  await window.loadURL(searchUrl);
  window.show();
  window.focus();

  const clicked: boolean = await window.webContents.executeJavaScript(
    `(async function () {
      function findResult() {
        return document.querySelector('ytd-video-renderer a#video-title, a#video-title, ytd-video-renderer a#thumbnail');
      }
      const start = Date.now();
      let el = null;
      while (Date.now() - start < 8000) {
        el = findResult();
        if (el) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      if (!el) return false;
      el.click();
      return true;
    })();`,
    true
  );

  if (!clicked) {
    return { searchUrl, clicked: false, adSkipped: false };
  }

  const adSkipped: boolean = await window.webContents.executeJavaScript(
    `(async function () {
      function findSkipButton() {
        return document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-container');
      }
      const start = Date.now();
      while (Date.now() - start < 12000) {
        const btn = findSkipButton();
        if (btn) { btn.click(); return true; }
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    })();`,
    true
  );

  return { searchUrl, clicked: true, adSkipped };
}
