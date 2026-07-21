/**
 * electron/tools/web.ts
 *
 * Browser automation via Playwright + Chrome DevTools Protocol (CDP).
 * Connects ONCE at module load time to the user's existing Chrome
 * instance running with --remote-debugging-port=9222.  All web.* tools
 * share the same persistent connection and reuse existing tabs.
 *
 * Diagnostics are logged to the terminal on startup so the user can
 * confirm which tabs the AI can see and control.
 */

import { registerTool } from "../ipc/toolRegistry";
import * as http from "http";

// Playwright types — resolved dynamically at runtime, never bundled by esbuild.
// Use `any` aliases so this file compiles without playwright installed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwPage = any;

const CDP_URL = "http://127.0.0.1:9222";

const log = console.log.bind(console, "[JARVIC Web]");

let browser: PwBrowser | null = null;
let page: PwPage | null = null;
let initError: Error | null = null;

// ── Diagnostics ─────────────────────────────────────────────────────────────

/** Fetch JSON from the CDP endpoint via plain http (no Playwright needed). */
function cdpFetch<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http.get(`${CDP_URL}${path}`, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

/** Pre-flight check: is Chrome actually listening with CDP? */
async function checkCDPAvailable(): Promise<void> {
  log("Checking Chrome DevTools Protocol...");
  const version = await cdpFetch<{ Browser: string; webSocketDebuggerUrl: string }>("/json/version");
  log(`CDP available — ${version.Browser}`);
  const tabs = await cdpFetch<{ id: string; title: string; url: string }[]>("/json");
  if (tabs.length === 0) {
    log("No open tabs found. JARVIC will open a new tab when needed.");
  } else {
    log(`Open tabs: ${tabs.length}`);
    for (const t of tabs) {
      log(`  "${t.title || "(untitled)"}" → ${t.url}`);
    }
  }
}

// ── Initialization ──────────────────────────────────────────────────────────

/**
 * Eagerly connect to Chrome via CDP when this module is first loaded
 * (i.e. at JARVIC startup, before any tool is called).  Every tool
 * handler awaits this promise through getPage().
 */
const initPromise = (async () => {
  log("Starting Playwright...");

  // 1. Verify CDP endpoint is reachable BEFORE loading Playwright
  try {
    await checkCDPAvailable();
  } catch (err: any) {
    throw new Error(
      `Cannot reach Chrome DevTools Protocol at ${CDP_URL}.\n` +
      `  Cause: ${err.code === "ECONNREFUSED" ? "Connection refused — Chrome is not running with --remote-debugging-port=9222." : err.message}\n\n` +
      `To fix, close all Chrome windows, then restart Chrome with:\n` +
      `  chrome.exe --remote-debugging-port=9222\n\n` +
      `Then restart JARVIC.`
    );
  }

  // 2. Dynamic require keeps esbuild from bundling Playwright.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let chromium: any;
  try {
    ({ chromium } = require("playwright") as any);
  } catch (err: any) {
    throw new Error(
      `Playwright is not installed (${err.message}). Run: npm install, then npx playwright install chromium`
    );
  }

  // 3. Connect via CDP
  log("Connecting to Chrome via CDP...");
  browser = await chromium.connectOverCDP(CDP_URL);
  log("Connected successfully.");

  // 4. Log available contexts and tabs
  const ctxCount = browser.contexts().length;
  log(`Browser contexts: ${ctxCount}`);
  if (ctxCount > 0) {
    const pages = browser.contexts()[0].pages();
    log(`Tabs in default context: ${pages.length}`);
    for (const p of pages) {
      log(`  "${await p.title()}" → ${p.url()}`);
    }
  }
})();

// ── Page resolution ─────────────────────────────────────────────────────────

/**
 * Return a usable Page connected to the user's Chrome.
 *
 * - The browser connection was started when JARVIC launched.
 * - Reuses the first available tab from the default context.
 * - Opens a new tab only if the user's Chrome has zero pages open.
 * - Never creates a new browser context (preserves all sessions).
 */
async function getPage(): Promise<PwPage> {
  // Fast-fail if we already know the connection failed.
  if (initError) throw initError;

  // Await (or re-await) the init promise.
  try {
    await initPromise;
  } catch (err) {
    initError = err as Error;
    throw initError;
  }

  // Guard against a disconnected / null browser.
  if (!browser) {
    throw new Error("No browser connection. Restart JARVIC after starting Chrome with --remote-debugging-port=9222.");
  }

  // Reuse the default context — never create a new one.
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error("CDP-connected browser has no contexts. Restart Chrome and try again.");
  }
  const ctx = contexts[0];

  // Reuse an existing page when possible.
  const pages = ctx.pages();
  if (pages.length > 0) {
    page = pages[0];
    return page;
  }

  // No pages at all — open a new tab.
  if (!page || page.isClosed()) {
    page = await ctx.newPage();
  }
  return page;
}

// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "web.youtubePlaySong",
  description:
    "One-call action for 'play X on YouTube': searches, clicks the first result, and tries to auto-skip any pre-roll ad.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.query !== "string" || !(raw as any).query.trim())
      throw new Error("Expected { query: string }");
    return { query: (raw as any).query as string };
  },
  handler: async ({ query }: { query: string }) => {
    const p = await getPage();
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    await p.goto(searchUrl);
    await p.waitForSelector("ytd-video-renderer a#video-title, a#video-title", { timeout: 8000 });
    await p.click("ytd-video-renderer a#video-title, a#video-title");
    let adSkipped = false;
    const skipSel = ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button";
    for (let i = 0; i < 24; i++) {
      const btn = await p.$(skipSel);
      if (btn && await btn.isVisible()) { await btn.click(); adSkipped = true; break; }
      await new Promise(r => setTimeout(r, 500));
    }
    return { searchUrl, clicked: true, adSkipped };
  },
});

registerTool({
  name: "web.googleSearch",
  description: "Opens Google search results for the given query using Playwright.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.query !== "string" || !(raw as any).query.trim())
      throw new Error("Expected { query: string }");
    return { query: (raw as any).query as string };
  },
  handler: async ({ query }: { query: string }) => {
    const p = await getPage();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await p.goto(url);
    return { opened: url };
  },
});

registerTool({
  name: "web.googleImageSearch",
  description: "Opens Google's Images tab for the given query using Playwright.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.query !== "string" || !(raw as any).query.trim())
      throw new Error("Expected { query: string }");
    return { query: (raw as any).query as string };
  },
  handler: async ({ query }: { query: string }) => {
    const p = await getPage();
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
    await p.goto(url);
    return { opened: url };
  },
});

registerTool({
  name: "web.open",
  description: "Opens any URL in the connected Chrome browser window.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.url !== "string") throw new Error("Expected { url: string }");
    return { url: (raw as any).url as string };
  },
  handler: async ({ url }: { url: string }) => {
    const p = await getPage();
    await p.goto(url);
    return { opened: url };
  },
});

registerTool({
  name: "web.evaluate",
  description: "Runs JavaScript in the Playwright browser and returns the result.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.script !== "string") throw new Error("Expected { script: string }");
    return { script: (raw as any).script as string };
  },
  handler: async ({ script }: { script: string }) => {
    const p = await getPage();
    const result = await p.evaluate(script);
    return { result, url: p.url(), title: await p.title() };
  },
});

registerTool({
  name: "web.scroll",
  description: "Scrolls the Playwright page up or down by a pixel amount (default 600).",
  validateArgs: (raw) => {
    const direction = (raw as any)?.direction === "up" ? "up" : "down";
    const amount = typeof (raw as any)?.amount === "number" ? (raw as any).amount : 600;
    return { direction: direction as "up" | "down", amount };
  },
  handler: async ({ direction, amount }: { direction: "up" | "down"; amount: number }) => {
    const p = await getPage();
    await p.evaluate((d: number) => { (globalThis as any).scrollBy({ top: d, behavior: "smooth" }); }, direction === "down" ? amount : -amount);
    return { matched: true, url: p.url(), title: await p.title() };
  },
});

registerTool({
  name: "web.clickByText",
  description: "Clicks the first visible button/link whose text matches (partial, case-insensitive).",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.text !== "string" || !(raw as any).text.trim())
      throw new Error("Expected { text: string }");
    return { text: (raw as any).text as string };
  },
  handler: async ({ text }: { text: string }) => {
    const p = await getPage();
    await p.locator(`text="${text}"`).first().click();
    return { matched: true, url: p.url(), title: await p.title() };
  },
});

registerTool({
  name: "web.click",
  description: "Clicks the first element matching the given CSS selector in the Playwright browser.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.selector !== "string") throw new Error("Expected { selector: string }");
    return { selector: (raw as any).selector as string };
  },
  handler: async ({ selector }: { selector: string }) => {
    const p = await getPage();
    await p.click(selector);
    return { matched: true, url: p.url(), title: await p.title() };
  },
});

registerTool({
  name: "web.type",
  description: "Types text into the first matching input or textarea in the Playwright browser.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.selector !== "string" || typeof (raw as any)?.text !== "string")
      throw new Error("Expected { selector: string, text: string }");
    return { selector: (raw as any).selector as string, text: (raw as any).text as string };
  },
  handler: async ({ selector, text }: { selector: string; text: string }) => {
    const p = await getPage();
    await p.fill(selector, text);
    return { matched: true, url: p.url(), title: await p.title() };
  },
});
