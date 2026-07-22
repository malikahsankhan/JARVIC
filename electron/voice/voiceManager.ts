/**
 * electron/voice/voiceManager.ts
 *
 * VoiceManager — top-level orchestrator for JARVIC's Browser Speech
 * Recognition system and barge-in conversational flow.
 */

import { isTtsSpeaking, stopTtsSpeaking } from "../tools/tts";
import { notifyFinalTranscript, notifyInterruptSpeaking, notifyPartialTranscript } from "./notify";
import { BrowserSpeechEngine } from "./browserSpeechEngine";
import { OfflineSpeechEngine } from "./offlineSpeechEngine";
import { SpeechRouter } from "./speechRouter";
import { loadVoiceConfig } from "./config";
import { sanitizeVoiceTranscript } from "./noiseFilter";
import type { TranscriptResult, VoiceConfig, VoiceState } from "./types";

export class VoiceManager {
  private readonly config: VoiceConfig;
  private readonly browserEngine: BrowserSpeechEngine;
  private readonly offlineEngine: OfflineSpeechEngine;
  private readonly router: SpeechRouter;

  private state: VoiceState = "IDLE";
  private ttsWaitPoll: NodeJS.Timeout | null = null;
  private started = false;

  constructor(config: VoiceConfig = loadVoiceConfig()) {
    this.config = config;
    this.browserEngine = new BrowserSpeechEngine(config.browserPort);
    this.offlineEngine = new OfflineSpeechEngine();
    this.router = new SpeechRouter(this.browserEngine, this.offlineEngine, "BROWSER");
    this.wire();
  }

  getState(): VoiceState {
    return this.state;
  }

  getBrowserSpeechUrl(): string {
    return this.browserEngine.clientUrl;
  }

  getSpeechMode(): VoiceConfig["speechMode"] {
    return "BROWSER";
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    console.log(`[VoiceManager] State: ${this.state} → ${next}`);
    this.state = next;
  }

  private wire(): void {
    this.router.on("speech-start", () => {
      this.handleRoutedSpeechStart();
    });

    this.router.on("partial", (text: string) => {
      this.handleRoutedPartial(text);
    });

    this.router.on("transcript", (result: TranscriptResult) => {
      this.handleRoutedTranscript(result);
    });
  }

  public startListening(): void {
    console.log("[VoiceManager] Manual mic start — entering LISTENING mode.");
    if (isTtsSpeaking() || this.state === "SPEAKING") {
      console.log("[VoiceManager] Interrupting ongoing TTS playback for user speech.");
      stopTtsSpeaking();
      notifyInterruptSpeaking();
    }
    this.setState("LISTENING");
    notifyInterruptSpeaking(); // Ensures renderer UI state switches to listening
  }

  public stopListening(): void {
    console.log("[VoiceManager] Manual mic stop — returning to IDLE mode.");
    this.setState("IDLE");
    notifyPartialTranscript("");
  }

  public toggleListening(): void {
    if (this.state === "LISTENING") {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  private handleRoutedSpeechStart(): void {
    if (isTtsSpeaking() || this.state === "SPEAKING" || this.state === "PROCESSING") {
      console.log("[VoiceManager] BARGE-IN: User started speaking while JARVIC was speaking/processing. Stopping TTS immediately!");
      stopTtsSpeaking();
      notifyInterruptSpeaking();
      this.setState("LISTENING");
    }
  }

  private handleRoutedPartial(text: string): void {
    if (isTtsSpeaking() || this.state === "SPEAKING" || this.state === "PROCESSING") {
      console.log("[VoiceManager] BARGE-IN: Partial speech detected during TTS/Processing. Stopping TTS!");
      stopTtsSpeaking();
      notifyInterruptSpeaking();
      this.setState("LISTENING");
    }

    const cleanText = sanitizeVoiceTranscript(text);
    if (cleanText) {
      if (this.state !== "LISTENING") {
        this.setState("LISTENING");
      }
      notifyPartialTranscript(cleanText);
    }
  }

  private handleRoutedTranscript(result: TranscriptResult): void {
    const rawText = String(result?.text ?? "").trim();
    const cleanText = sanitizeVoiceTranscript(rawText);
    if (!cleanText) {
      if (rawText) console.log(`[VoiceManager] Ignored environmental noise / artifact: "${rawText}"`);
      return;
    }

    if (isTtsSpeaking() || this.state === "SPEAKING") {
      console.log("[VoiceManager] BARGE-IN: Final transcript received while speaking. Stopping TTS.");
      stopTtsSpeaking();
      notifyInterruptSpeaking();
    }

    this.handleCommand(cleanText);
  }

  private handleCommand(text: string): void {
    console.log(`[VoiceManager] Processing Final Command -> AI Planner: "${text}"`);
    this.setState("PROCESSING");
    notifyPartialTranscript(""); // Clear live transcript
    notifyFinalTranscript(text);
    this.monitorTtsResponse();
  }

  /**
   * Monitor TTS execution so VoiceManager tracks when JARVIC is speaking vs done speaking.
   */
  private monitorTtsResponse(): void {
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
        if (this.state === "SPEAKING" || this.state === "PROCESSING") {
          this.setState("IDLE");
        }
      }
    }, 200);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      await this.browserEngine.start();
    } catch (err) {
      console.error("[VoiceManager] Browser Speech bridge failed to start:", err);
    }

    console.log("[VoiceManager] Browser Speech Recognition active & ready.");
    this.setState("IDLE");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.ttsWaitPoll) clearInterval(this.ttsWaitPoll);
    this.ttsWaitPoll = null;

    await this.browserEngine.stop();
    this.setState("IDLE");
  }
}

