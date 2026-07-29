import { isTtsSpeaking, stopTtsSpeaking } from "../tools/tts";
import {
  notifyFinalTranscript,
  notifyInterruptSpeaking,
  notifyMicPowerState,
  notifyPartialTranscript,
  notifyVoiceWarning,
  notifyWakeWordDetected,
  notifyWakeWordState,
} from "./notify";
import { BrowserSpeechService } from "./browser_speech";
import { SpeechRouter } from "./speech_router";
import type { BrowserTranscript, VoiceState } from "./types";

// Default wake phrases JARVIC listens for once wake-word mode is enabled.
// Override with a comma-separated list via JARVIC_WAKE_WORD, e.g. "hey jarvic,ok jarvic".
const DEFAULT_WAKE_WORDS = ["hey jarvic", "hey jarvis", "ok jarvic", "okay jarvic"];

function loadWakeWords(): string[] {
  const raw = process.env.JARVIC_WAKE_WORD;
  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((phrase) => phrase.trim().toLowerCase())
      .filter(Boolean);
  }
  return DEFAULT_WAKE_WORDS;
}

function normalizeForWakeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple text-based wake-word match: looks for any configured wake phrase
 * inside the transcript and returns whatever comes after it as the command.
 * Not a true offline wake-word engine (no audio-level detection) — this
 * gates the already-transcribed text from the online Web Speech pipeline.
 */
function matchWakeWord(text: string, wakeWords: string[]): { remainder: string } | null {
  const normalizedText = normalizeForWakeWord(text);
  if (!normalizedText) return null;

  let best: { remainder: string; wakeWordLength: number } | null = null;
  for (const phrase of wakeWords) {
    const normalizedPhrase = normalizeForWakeWord(phrase);
    if (!normalizedPhrase) continue;
    const idx = normalizedText.indexOf(normalizedPhrase);
    if (idx === -1) continue;
    if (!best || normalizedPhrase.length > best.wakeWordLength) {
      best = {
        remainder: normalizedText.slice(idx + normalizedPhrase.length).trim(),
        wakeWordLength: normalizedPhrase.length,
      };
    }
  }
  return best ? { remainder: best.remainder } : null;
}

const NOISE_ONLY = new Set([
  "uh",
  "um",
  "hmm",
  "hm",
  "ah",
  "huh",
  "typing",
  "keyboard",
  "mouse click",
  "background noise",
  "noise",
  "music",
  "tv",
  "cough",
  "coughing",
  "breathing",
]);

function sanitizeTranscript(raw: string): string {
  const text = raw.replace(/[\(\[\*][^\)\]\*]*[\)\]\*]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 3) return "";
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, "").trim();
  if (NOISE_ONLY.has(normalized)) return "";
  if (!/[a-z0-9]/i.test(text)) return "";
  return text;
}

export class VoiceManager {
  private readonly browserSpeech = new BrowserSpeechService(Number(process.env.JARVIC_VOICE_BROWSER_PORT || 0));
  private readonly router = new SpeechRouter(this.browserSpeech);
  private state: VoiceState = "IDLE";
  private started = false;
  private ttsPoll: NodeJS.Timeout | null = null;
  private manualListening = false;
  private lastWarning = "";
  // Hard power state of the mic/browser-speech backend — distinct from
  // manualListening, which only pauses/resumes an active recognition session.
  private micPowered = false;
  private wakeWordEnabled = false;
  private readonly wakeWords = loadWakeWords();

  constructor() {
    this.wire();
  }

  getState(): VoiceState {
    return this.state;
  }

  getBrowserSpeechUrl(): string {
    return this.browserSpeech.clientUrl;
  }

  getSpeechMode(): "BROWSER" {
    return "BROWSER";
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.browserSpeech.start();
    this.micPowered = true;
    this.setState("IDLE");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.manualListening = false;
    this.clearTtsPoll();
    this.router.stopListening();
    await this.browserSpeech.stop();
    this.micPowered = false;
    notifyPartialTranscript("");
    this.setState("IDLE");
  }

  isMicPowered(): boolean {
    return this.micPowered;
  }

  isWakeWordEnabled(): boolean {
    return this.wakeWordEnabled;
  }

  /** Fully powers down the mic: stops recognition AND kills the hidden browser process holding the OS mic permission. */
  async powerOffMic(): Promise<void> {
    if (!this.micPowered) return;
    this.manualListening = false;
    this.clearTtsPoll();
    this.router.stopListening();
    await this.browserSpeech.stop();
    this.micPowered = false;
    notifyPartialTranscript("");
    this.setState("IDLE");
    notifyMicPowerState(false);
  }

  /** Relaunches the hidden browser/mic session after a full power-off. */
  async powerOnMic(): Promise<void> {
    if (this.micPowered) return;
    await this.browserSpeech.start();
    this.micPowered = true;
    this.setState("IDLE");
    notifyMicPowerState(true);
    // If wake-word mode was left enabled, resume continuous listening now that the mic is back.
    if (this.wakeWordEnabled) {
      this.manualListening = true;
      this.setState("LISTENING");
      this.router.startListening("manual");
    }
  }

  /**
   * Enables/disables wake-word gating. When enabled, the mic listens
   * continuously (the browser recognition loop already auto-restarts itself)
   * but transcripts are only forwarded to the AI planner if they contain a
   * configured wake phrase (default "hey jarvic"); everything else is
   * discarded before it reaches Gemini.
   */
  setWakeWordEnabled(enabled: boolean): void {
    if (this.wakeWordEnabled === enabled) return;
    this.wakeWordEnabled = enabled;
    notifyWakeWordState(enabled);

    if (!enabled) {
      if (!this.manualListening) return;
      this.manualListening = false;
      this.router.stopListening();
      notifyPartialTranscript("");
      if (this.state === "LISTENING" || this.state === "INTERRUPTED") this.setState("IDLE");
      return;
    }

    if (!this.micPowered) {
      this.warn("Turn the microphone on to enable wake-word listening.");
      return;
    }
    this.manualListening = true;
    this.interruptIfSpeaking();
    this.setState("LISTENING");
    notifyInterruptSpeaking();
    notifyPartialTranscript("");
    this.router.startListening("manual");
  }

  startListening(): void {
    if (!this.micPowered) {
      this.warn("Cannot start listening: the microphone is powered off.");
      return;
    }
    this.manualListening = true;
    this.interruptIfSpeaking();
    this.setState("LISTENING");
    notifyInterruptSpeaking();
    notifyPartialTranscript("");
    this.router.startListening("manual");
  }

  stopListening(): void {
    this.manualListening = false;
    this.router.stopListening();
    notifyPartialTranscript("");
    if (this.state === "LISTENING" || this.state === "INTERRUPTED") this.setState("IDLE");
  }

  toggleListening(): void {
    if (this.manualListening || this.state === "LISTENING") this.stopListening();
    else this.startListening();
  }

  private wire(): void {
    this.browserSpeech.on("ready", () => {
      this.lastWarning = "";
    });
    this.browserSpeech.on("launched", (url: string) => console.log(`[VoiceManager] Browser speech client launched at ${url}`));
    this.browserSpeech.on("relaunching", (reason: string) => console.warn(`[VoiceManager] Browser speech client restarting: ${reason}`));
    this.router.on("error", (error: string) => this.warn(`Browser speech recognition error: ${error}`));
    this.router.on("speech-start", () => this.handleSpeechStart());
    this.router.on("partial", (text: string) => this.handlePartial(text));
    this.router.on("transcript", (result: BrowserTranscript) => this.handleFinal(result));
    this.router.on("stopped", (reason: string) => {
      if (reason === "manual" || reason === "disconnect") {
        if (this.state === "LISTENING" || this.state === "INTERRUPTED") this.setState("IDLE");
        this.manualListening = false;
      }
    });
  }

  private handleSpeechStart(): void {
    if (isTtsSpeaking() || this.state === "SPEAKING" || this.state === "PROCESSING") {
      this.setState("INTERRUPTED");
      this.interruptIfSpeaking();
      this.router.startListening("barge-in");
      return;
    }
    this.setState("LISTENING");
  }

  private handlePartial(rawText: string): void {
    const text = sanitizeTranscript(rawText);
    if (!text) return;
    if (isTtsSpeaking() || this.state === "SPEAKING" || this.state === "PROCESSING") {
      this.setState("INTERRUPTED");
      this.interruptIfSpeaking();
    } else {
      this.setState("LISTENING");
    }
    notifyPartialTranscript(text);
  }

  private handleFinal(result: BrowserTranscript): void {
    const text = sanitizeTranscript(result.text);
    notifyPartialTranscript("");
    if (!text) {
      if (this.wakeWordEnabled && this.manualListening) this.setState("LISTENING");
      return;
    }

    if (this.wakeWordEnabled) {
      const match = matchWakeWord(text, this.wakeWords);
      if (!match) {
        // Not directed at JARVIC — stay listening, don't forward to the AI planner.
        if (this.manualListening) this.setState("LISTENING");
        return;
      }
      notifyWakeWordDetected();
      if (!match.remainder) {
        // Wake word heard with no command attached yet — keep listening for the follow-up.
        this.setState("LISTENING");
        return;
      }
      this.interruptIfSpeaking();
      this.setState("PROCESSING");
      notifyFinalTranscript(match.remainder);
      this.monitorTts();
      return;
    }

    this.interruptIfSpeaking();
    this.setState("PROCESSING");
    notifyFinalTranscript(text);
    this.monitorTts();
  }

  private interruptIfSpeaking(): void {
    if (!isTtsSpeaking() && this.state !== "SPEAKING" && this.state !== "PROCESSING") return;
    stopTtsSpeaking();
    notifyInterruptSpeaking();
    this.clearTtsPoll();
  }

  private monitorTts(): void {
    this.clearTtsPoll();
    const startedAt = Date.now();
    let sawTts = false;
    this.ttsPoll = setInterval(() => {
      const speaking = isTtsSpeaking();
      if (speaking) {
        sawTts = true;
        this.setState("SPEAKING");
      } else if (sawTts || Date.now() - startedAt > 20_000) {
        this.clearTtsPoll();
        if (this.state === "SPEAKING" || this.state === "PROCESSING") {
          this.setState("LISTENING");
          this.router.startListening("barge-in");
        }
      }
    }, 200);
  }

  private clearTtsPoll(): void {
    if (this.ttsPoll) clearInterval(this.ttsPoll);
    this.ttsPoll = null;
  }

  private setState(next: VoiceState): void {
    if (this.state === next) return;
    console.log(`[VoiceManager] State: ${this.state} -> ${next}`);
    this.state = next;
  }

  private warn(message: string): void {
    if (this.lastWarning === message) return;
    this.lastWarning = message;
    console.warn(`[VoiceManager] ${message}`);
    notifyVoiceWarning(message);
  }
}
