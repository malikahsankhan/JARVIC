/**
 * electron/voice/voiceManager.ts
 *
 * VoiceManager — top-level orchestrator for JARVIC's Hybrid Speech
 * Recognition system.
 *
 *   VoiceManager
 *       │
 *       ▼
 *   SpeechRouter  (AUTO / BROWSER / OFFLINE)
 *       │
 *   BrowserSpeechEngine  ──┐
 *   OfflineSpeechEngine  ──┴──→ AI Planner (via existing "jarvic-audio-event"
 *                                IPC channel — unchanged renderer/UI code)
 *
 * State machine: IDLE → WAKE_WORD → LISTENING → PROCESSING → SPEAKING →
 * FOLLOW_UP → TIMEOUT → (back to WAKE_WORD).
 *
 * Wake-word detection always reads from OfflineSpeechEngine's continuous,
 * fully-local transcription stream — never from the browser, and never
 * gated behind SpeechRouter's mode. Once the wake word is heard, the
 * *command* that follows is captured through whichever engine SpeechRouter
 * currently considers authoritative (Browser preferred in AUTO, falling
 * back to Offline automatically on any Browser Speech failure).
 */

import { isTtsSpeaking } from "../tools/tts";
import { notifyFinalTranscript, notifyInterruptSpeaking } from "./notify";
import { matchWakeWord } from "./wakeWord";
import { BrowserSpeechEngine } from "./browserSpeechEngine";
import { OfflineSpeechEngine } from "./offlineSpeechEngine";
import { SpeechRouter } from "./speechRouter";
import { loadVoiceConfig } from "./config";
import type { TranscriptResult, VoiceConfig, VoiceState } from "./types";

export class VoiceManager {
  private readonly config: VoiceConfig;
  private readonly browserEngine: BrowserSpeechEngine;
  private readonly offlineEngine: OfflineSpeechEngine;
  private readonly router: SpeechRouter;

  private state: VoiceState = "IDLE";
  private followUpTimer: NodeJS.Timeout | null = null;
  private ttsWaitPoll: NodeJS.Timeout | null = null;
  private started = false;

  constructor(config: VoiceConfig = loadVoiceConfig()) {
    this.config = config;
    this.browserEngine = new BrowserSpeechEngine(config.browserPort);
    this.offlineEngine = new OfflineSpeechEngine();
    this.router = new SpeechRouter(this.browserEngine, this.offlineEngine, config.speechMode);
    this.wire();
  }

  getState(): VoiceState {
    return this.state;
  }

  setSpeechMode(mode: VoiceConfig["speechMode"]): void {
    this.router.setMode(mode);
  }

  /** URL to open once in a real system browser (Chrome/Edge) to enable Browser Speech. */
  getBrowserSpeechUrl(): string {
    return this.browserEngine.clientUrl;
  }

  getSpeechMode(): VoiceConfig["speechMode"] {
    return this.config.speechMode;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    console.log(`[VoiceManager] State: ${this.state} → ${next}`);
    this.state = next;
  }

  private wire(): void {
    // Wake-word duty — always sourced from the local offline stream, in
    // every SpeechMode, per the "never depend on the browser" requirement.
    this.offlineEngine.on("transcript", (result: TranscriptResult) => {
      this.handleOfflineUtterance(result);
    });

    // Command duty — whichever engine SpeechRouter currently trusts.
    this.router.on("transcript", (result: TranscriptResult) => {
      this.handleRoutedTranscript(result);
    });
  }

  private handleOfflineUtterance(result: TranscriptResult): void {
    const listeningForCommand = this.state === "LISTENING" || this.state === "FOLLOW_UP";
    const activeSourceIsOffline = this.router.activeSource() === "offline";

    if (listeningForCommand && activeSourceIsOffline) {
      // The router will also re-emit this same result — let it own dispatch
      // so a command is never handled twice.
      return;
    }

    // Otherwise, this utterance is only relevant as a wake-word check —
    // covers IDLE/WAKE_WORD/TIMEOUT (normal case) and also PROCESSING/
    // SPEAKING (barge-in: user says the wake word while JARVIC is
    // mid-response, per the Interruptible TTS requirement).
    const { matched, remainder } = matchWakeWord(result.text, this.config.wakeWord);
    if (!matched) return;

    console.log("[VoiceManager] Wake Word Detected");

    if (isTtsSpeaking()) {
      console.log("[VoiceManager] Stopping TTS");
      notifyInterruptSpeaking();
    }
    if (this.followUpTimer) {
      clearTimeout(this.followUpTimer);
      this.followUpTimer = null;
    }

    this.setState("LISTENING");

    if (remainder) {
      // "Hey Jarvic, open Chrome" — act on the command in the same breath.
      this.handleCommand(remainder);
    }
  }

  private handleRoutedTranscript(result: TranscriptResult): void {
    if (this.state !== "LISTENING" && this.state !== "FOLLOW_UP") return;
    this.handleCommand(result.text);
  }

  private handleCommand(text: string): void {
    if (!text.trim()) return;
    console.log(`[VoiceManager] Sending to AI: "${text}"`);
    this.setState("PROCESSING");
    notifyFinalTranscript(text);
    this.armFollowUpAfterResponse();
  }

  /**
   * Waits for the AI's response to actually start (and finish) speaking —
   * observed directly via tts.ts's isTtsSpeaking(), since TTS playback
   * runs in this same main process — then enters FOLLOW_UP mode so the
   * user can keep talking without repeating the wake word.
   */
  private armFollowUpAfterResponse(): void {
    if (this.ttsWaitPoll) clearInterval(this.ttsWaitPoll);

    const startedAt = Date.now();
    const maxWaitMs = 20_000;
    let sawSpeaking = false;

    this.ttsWaitPoll = setInterval(() => {
      const speaking = isTtsSpeaking();
      if (speaking) {
        sawSpeaking = true;
        if (this.state !== "SPEAKING") this.setState("SPEAKING");
      } else if (sawSpeaking || Date.now() - startedAt > maxWaitMs) {
        if (this.ttsWaitPoll) clearInterval(this.ttsWaitPoll);
        this.ttsWaitPoll = null;
        this.enterFollowUp();
      }
    }, 250);
  }

  private enterFollowUp(): void {
    this.setState("FOLLOW_UP");
    if (this.followUpTimer) clearTimeout(this.followUpTimer);
    this.followUpTimer = setTimeout(() => {
      this.setState("TIMEOUT");
      console.log("[VoiceManager] Follow-up window elapsed — returning to Wake Word mode.");
      this.setState("WAKE_WORD");
      console.log("[VoiceManager] Waiting for Wake Word");
    }, this.config.followUpTimeoutMs);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      await this.browserEngine.start();
    } catch (err) {
      console.error("[VoiceManager] Browser Speech bridge failed to start:", err);
    }

    console.log("[VoiceManager] Starting Browser Speech");

    try {
      await this.offlineEngine.start();
      console.log("[VoiceManager] Offline Recognition Started");
    } catch (err) {
      console.error("[VoiceManager] Offline Speech failed to start — wake word will be unavailable:", err);
    }

    this.setState("WAKE_WORD");
    console.log("[VoiceManager] Waiting for Wake Word");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.followUpTimer) clearTimeout(this.followUpTimer);
    if (this.ttsWaitPoll) clearInterval(this.ttsWaitPoll);
    this.followUpTimer = null;
    this.ttsWaitPoll = null;

    await Promise.all([this.browserEngine.stop(), this.offlineEngine.stop()]);
    this.setState("IDLE");
  }
}
