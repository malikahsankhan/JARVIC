import { registerTool } from "../ipc/toolRegistry";
import {
  clickByTextInMediaWindow,
  clickInMediaWindow,
  evaluateInMediaWindow,
  openUrlInMediaWindow,
  playYoutubeSong,
  scrollMediaWindow,
  typeIntoMediaWindow,
} from "../mediaWindow";

registerTool({
  name: "web.youtubePlaySong",
  description:
    "One-call action for 'play X on YouTube' requests: searches YouTube for the query, clicks the first result to start playback, and tries to skip any pre-roll ad automatically. Use this single tool instead of chaining web.open/web.click yourself for song/video play requests.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).query !== "string" || !(raw as any).query.trim()) {
      throw new Error("Expected { query: string }");
    }
    return { query: (raw as any).query as string };
  },
  handler: async ({ query }: { query: string }) => playYoutubeSong(query),
});

registerTool({
  name: "web.googleSearch",
  description: "Opens Google search results for the given query in JARVIC's controlled media window.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).query !== "string" || !(raw as any).query.trim()) {
      throw new Error("Expected { query: string }");
    }
    return { query: (raw as any).query as string };
  },
  handler: async ({ query }: { query: string }) => {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await openUrlInMediaWindow(url);
    return { opened: url };
  },
});

registerTool({
  name: "web.googleImageSearch",
  description:
    "Opens Google's Images tab (not the regular results page) for the given query in JARVIC's controlled media window. Use this whenever the user asks to search something 'and show images' / 'in the images section'.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).query !== "string" || !(raw as any).query.trim()) {
      throw new Error("Expected { query: string }");
    }
    return { query: (raw as any).query as string };
  },
  handler: async ({ query }: { query: string }) => {
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
    await openUrlInMediaWindow(url);
    return { opened: url };
  },
});

registerTool({
  name: "web.open",
  description: "Opens any URL in JARVIC's own controlled browser window (not the user's default browser).",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).url !== "string") {
      throw new Error("Expected { url: string }");
    }
    return { url: (raw as any).url as string };
  },
  handler: async ({ url }: { url: string }) => {
    await openUrlInMediaWindow(url);
    return { opened: url };
  },
});

registerTool({
  name: "web.evaluate",
  description: "Runs JavaScript in JARVIC's controlled media window and returns the result.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).script !== "string") {
      throw new Error("Expected { script: string }");
    }
    return { script: (raw as any).script as string };
  },
  handler: async ({ script }: { script: string }) => evaluateInMediaWindow(script),
});

registerTool({
  name: "web.scroll",
  description: "Scrolls the page in JARVIC's controlled media window up or down by a pixel amount (default 600).",
  validateArgs: (raw) => {
    const direction = typeof raw === "object" && raw !== null && (raw as any).direction === "up" ? "up" : "down";
    const amountRaw = typeof raw === "object" && raw !== null ? (raw as any).amount : undefined;
    const amount = typeof amountRaw === "number" && Number.isFinite(amountRaw) ? amountRaw : 600;
    return { direction: direction as "up" | "down", amount };
  },
  handler: async ({ direction, amount }: { direction: "up" | "down"; amount: number }) => scrollMediaWindow(direction, amount),
});

registerTool({
  name: "web.clickByText",
  description:
    "Clicks the first visible button/link on the page whose text matches (case-insensitive, partial match ok), e.g. 'Sign In', 'Accept all cookies', 'Skip'. Use this instead of web.click when you don't know the CSS selector — which is almost always, since you can't see the page's HTML.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).text !== "string" || !(raw as any).text.trim()) {
      throw new Error("Expected { text: string }");
    }
    return { text: (raw as any).text as string };
  },
  handler: async ({ text }: { text: string }) => clickByTextInMediaWindow(text),
});

registerTool({
  name: "web.click",
  description: "Clicks the first element matching the given CSS selector in JARVIC's controlled media window.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).selector !== "string") {
      throw new Error("Expected { selector: string }");
    }
    return { selector: (raw as any).selector as string };
  },
  handler: async ({ selector }: { selector: string }) => clickInMediaWindow(selector),
});

registerTool({
  name: "web.type",
  description: "Types text into the first matching input or textarea element in JARVIC's controlled media window.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).selector !== "string" || typeof (raw as any).text !== "string") {
      throw new Error("Expected { selector: string, text: string }");
    }
    return { selector: (raw as any).selector as string, text: (raw as any).text as string };
  },
  handler: async ({ selector, text }: { selector: string; text: string }) => typeIntoMediaWindow(selector, text),
});
