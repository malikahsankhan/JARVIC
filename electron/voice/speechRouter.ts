/**
 * electron/voice/speechRouter.ts
 *
 * SpeechRouter — decides, at any given moment, which recognized command
 * stream (Browser or Offline) is authoritative, per the configured mode:
 *
 *   AUTO     Prefer Browser Speech. If it's unavailable/unhealthy
 *            (crashed, disconnected, timed out, browser closed, no
 *            internet), automatically fail over to Offline Speech
 *            without asking the user. Automatically switches back the
 *            moment Browser Speech is healthy again.
 *   BROWSER  Browser Speech only.
 *   OFFLINE  Offline Speech only.
 *
 * Note: wake-word detection does NOT go through this router — it always
 * reads from OfflineSpeechEngine directly (see VoiceManager), because
 * wake-word detection must never depend on the browser regardless of
 * SpeechMode. This router only arbitrates which stream counts as "the"
 * command input once JARVIC is already actively listening.
 */

import { EventEmitter } from "events";
import type { SpeechMode, TranscriptResult } from "./types";
import type { BrowserSpeechEngine } from "./browserSpeechEngine";
import type { OfflineSpeechEngine } from "./offlineSpeechEngine";

export class SpeechRouter extends EventEmitter {
  private mode: SpeechMode;
  private usingBrowser = false;

  constructor(
    private readonly browserEngine: BrowserSpeechEngine,
    private readonly offlineEngine: OfflineSpeechEngine,
    mode: SpeechMode
  ) {
    super();
    this.mode = mode;
    this.wire();
  }

  setMode(mode: SpeechMode): void {
    console.log(`[SpeechRouter] Mode changed: ${this.mode} → ${mode}`);
    this.mode = mode;
    this.reevaluate();
  }

  private wire(): void {
    this.browserEngine.on("connected", () => this.reevaluate());
    this.browserEngine.on("disconnected", () => this.reevaluate());

    this.browserEngine.on("transcript", (result: TranscriptResult) => {
      if (this.activeSource() === "browser") this.emit("transcript", result);
    });
    this.browserEngine.on("partial", (text: string) => {
      if (this.activeSource() === "browser") this.emit("partial", text);
    });
    this.browserEngine.on("speech-start", () => {
      if (this.activeSource() === "browser") this.emit("speech-start");
    });

    // The offline engine's stream always flows through separately for
    // wake-word purposes (see VoiceManager), but it's also the router's
    // output whenever OFFLINE is the active source.
    this.offlineEngine.on("transcript", (result: TranscriptResult) => {
      if (this.activeSource() === "offline") this.emit("transcript", result);
    });

    this.reevaluate();
  }

  /** Which engine is currently authoritative for commands, given mode + health. */
  activeSource(): "browser" | "offline" {
    if (this.mode === "OFFLINE") return "offline";
    if (this.mode === "BROWSER") return "browser";
    // AUTO
    return this.browserEngine.isHealthy() ? "browser" : "offline";
  }

  private reevaluate(): void {
    const nowUsingBrowser = this.activeSource() === "browser";
    if (nowUsingBrowser !== this.usingBrowser) {
      this.usingBrowser = nowUsingBrowser;
      if (nowUsingBrowser) {
        console.log("[SpeechRouter] Browser Restored — switching back to Browser Speech.");
      } else {
        console.log("[SpeechRouter] Browser Speech Lost — switching to Offline Speech.");
      }
      this.emit("source-changed", this.activeSource());
    }
  }
}
