import { registerTool } from "../ipc/toolRegistry";
import { clickInMediaWindow, evaluateInMediaWindow, openUrlInMediaWindow, typeIntoMediaWindow } from "../mediaWindow";

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
