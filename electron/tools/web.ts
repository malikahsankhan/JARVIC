/**
 * electron/tools/web.ts
 *
 * Browser automation via Playwright (lazy-loaded via require so esbuild
 * treats it as an external native module and doesn't try to bundle it).
 */

import { registerTool } from "../ipc/toolRegistry";

// Playwright types — resolved dynamically at runtime, never bundled by esbuild.
// Use `any` aliases so this file compiles without playwright installed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwPage = any;

let browser: PwBrowser | null = null;
let page: PwPage | null = null;

async function getPage(): Promise<PwPage> {
  if (!browser) {
    // Dynamic require keeps esbuild from bundling Playwright
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let chromium: any;
    try {
      ({ chromium } = require("playwright") as any);
    } catch (err: any) {
      throw new Error(
        `Playwright is not installed (${err.message}). Run: npm install, then npx playwright install chromium`
      );
    }
    try {
      browser = await chromium.launch({ headless: false });
    } catch (err: any) {
      throw new Error(
        `Playwright's Chromium browser isn't installed yet (${err.message}). Run: npx playwright install chromium`
      );
    }
  }
  const contexts = browser!.contexts();
  const ctx = contexts.length ? contexts[0] : await browser!.newContext();
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
  description: "Opens any URL in a Playwright browser window.",
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
