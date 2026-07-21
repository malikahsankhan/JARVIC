/**
 * electron/browser/BrowserManager.ts
 *
 * Owns the single, persistent Chrome browser used by every JARVIC
 * browser-automation tool (see electron/tools/web.ts).
 *
 * ARCHITECTURE
 * ------------
 *  - JARVIC launches and manages ONE dedicated Chrome browser for the
 *    entire session — it never spins up a fresh browser per command,
 *    and it never just "connects" to whatever Chrome the user happens
 *    to have open.
 *  - That browser runs against a dedicated, persistent on-disk Chrome
 *    profile (cookies, login sessions, history, Local Storage,
 *    IndexedDB, cache). The user logs into Gmail / Slack / LinkedIn /
 *    ChatGPT / etc. once, and every future JARVIC launch is already
 *    signed in.
 *  - This class is the ONLY place that creates a Playwright browser
 *    context. Every tool goes through `getActivePage()` and reuses the
 *    existing context + tab instead of creating its own.
 *  - Open tabs are tracked so a follow-up command ("scroll down",
 *    "click login") keeps operating on the same tab the previous
 *    command left active.
 *  - If Chrome crashes or is closed unexpectedly, this manager detects
 *    it and relaunches automatically against the same profile so
 *    JARVIC keeps working without a restart.
 *
 * This file has ZERO knowledge of *what* the AI does with a page
 * (click / type / scroll / upload / download / screenshot / etc.) —
 * that automation logic stays exactly where it already lives, in
 * electron/tools/web.ts. This file only owns browser lifecycle.
 */

import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

// Playwright types are resolved dynamically at runtime — the package.json
// build scripts pass --external:playwright to esbuild specifically so this
// module (like the old electron/tools/web.ts) is never bundled with it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwBrowserContext = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwPage = any;

const log = console.log.bind(console, "[JARVIC BrowserManager]");

/** Where the dedicated JARVIC Chrome profile lives on disk. */
function resolveProfileDir(): string {
  // Allow an explicit override (useful for the C:\Jarvic\BrowserProfile
  // layout called out in the product spec), but default to a location
  // that's guaranteed writable and unique per-installation.
  if (process.env.JARVIC_BROWSER_PROFILE_DIR) {
    return process.env.JARVIC_BROWSER_PROFILE_DIR;
  }
  if (process.platform === "win32") {
    return "C:\\Jarvic\\BrowserProfile";
  }
  return path.join(app.getPath("userData"), "BrowserProfile");
}

class BrowserManager {
  private static _instance: BrowserManager | null = null;

  /** The one and only Playwright browser context for this whole app run. */
  private context: PwBrowserContext | null = null;

  /** Every open tab we know about, oldest first. */
  private pages: PwPage[] = [];

  /** The tab that the most recent command touched — reused by default. */
  private activePage: PwPage | null = null;

  /** In-flight launch, so concurrent callers await the same promise. */
  private launching: Promise<void> | null = null;

  /** Set while we're the ones intentionally closing the browser, so the
   *  "unexpected close" auto-restart doesn't fire during a normal shutdown. */
  private shuttingDown = false;

  private readonly profileDir: string;

  private constructor() {
    this.profileDir = resolveProfileDir();
  }

  static getInstance(): BrowserManager {
    if (!BrowserManager._instance) {
      BrowserManager._instance = new BrowserManager();
    }
    return BrowserManager._instance;
  }

  /**
   * Launch Chrome with the persistent JARVIC profile. Safe to call many
   * times — it's a no-op if Chrome is already running, and concurrent
   * callers share the same in-flight launch.
   */
  async launch(): Promise<void> {
    if (this.context) return;
    if (this.launching) return this.launching;

    this.launching = this.doLaunch();
    try {
      await this.launching;
    } finally {
      this.launching = null;
    }
  }

  private async doLaunch(): Promise<void> {
    fs.mkdirSync(this.profileDir, { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let chromium: any;
    try {
      ({ chromium } = require("playwright") as any);
    } catch (err: any) {
      throw new Error(
        `Playwright is not installed (${err.message}). Run: npm install, then npx playwright install chromium`
      );
    }

    this.shuttingDown = false;
    log(`Launching Jarvic's Chrome — profile: ${this.profileDir}`);

    const launchArgs = {
      headless: false,
      viewport: null, // let the real window size drive the viewport
      args: ["--start-maximized"],
    };

    let context: PwBrowserContext;
    try {
      // Prefer the user's actual installed Chrome — that's what makes
      // "already logged into Gmail/Slack/LinkedIn" believable/consistent
      // with a browser called "Chrome".
      context = await chromium.launchPersistentContext(this.profileDir, {
        ...launchArgs,
        channel: "chrome",
      });
    } catch (err) {
      log("System Chrome unavailable, falling back to bundled Chromium:", (err as Error).message);
      context = await chromium.launchPersistentContext(this.profileDir, launchArgs);
    }

    this.context = context;
    this.pages = context.pages();
    this.activePage = this.pages[0] ?? null;

    this.wireLifecycleEvents(context);

    log(`Chrome ready — ${this.pages.length} tab(s) restored from the persistent profile.`);
  }

  /** Track new/closed tabs, and auto-recover from an unexpected crash/close. */
  private wireLifecycleEvents(context: PwBrowserContext): void {
    context.on("page", (p: PwPage) => {
      this.pages.push(p);
      this.activePage = p; // newest tab becomes the active one

      p.on("close", () => {
        this.pages = this.pages.filter((x) => x !== p);
        if (this.activePage === p) {
          this.activePage = this.pages[this.pages.length - 1] ?? null;
        }
      });
    });

    context.on("close", () => {
      const wasIntentional = this.shuttingDown;
      this.context = null;
      this.activePage = null;
      this.pages = [];

      if (wasIntentional) {
        log("Browser closed.");
        return;
      }

      log("Chrome closed/crashed unexpectedly — restarting with the same profile...");
      this.launch().catch((err) => log("Auto-restart failed:", err));
    });
  }

  /**
   * The single entry point every browser tool uses to get a page to act
   * on. Launches Chrome on first use, reuses the active tab whenever
   * possible, and transparently relaunches after a crash — callers never
   * need to know any of that happened.
   */
  async getActivePage(): Promise<PwPage> {
    await this.launch();

    if (!this.context) {
      throw new Error("Jarvic's browser is not available. Check the console for launch errors.");
    }

    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }

    const stillOpen = this.pages.find((p) => !p.isClosed());
    if (stillOpen) {
      this.activePage = stillOpen;
      return stillOpen;
    }

    const page = await this.context.newPage();
    this.activePage = page;
    return page;
  }

  /** True once Chrome has actually been launched. */
  isRunning(): boolean {
    return this.context !== null;
  }

  /** Gracefully close Chrome — called when JARVIC itself is quitting. */
  async shutdown(): Promise<void> {
    if (!this.context) return;
    this.shuttingDown = true;
    try {
      await this.context.close();
    } catch (err) {
      log("Error while closing browser:", err);
    } finally {
      this.context = null;
      this.activePage = null;
      this.pages = [];
    }
  }
}

export const browserManager = BrowserManager.getInstance();
