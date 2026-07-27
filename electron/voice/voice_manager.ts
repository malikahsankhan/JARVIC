import { isTtsSpeaking, stopTtsSpeaking } from "../tools/tts";
import { notifyFinalTranscript, notifyInterruptSpeaking, notifyPartialTranscript, notifyVoiceWarning } from "./notify";
import { BrowserSpeechService } from "./browser_speech";
import { SpeechRouter } from "./speech_router";
import type { BrowserTranscript, VoiceState } from "./types";

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
    this.setState("IDLE");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.manualListening = false;
    this.clearTtsPoll();
    this.router.stopListening();
    await this.browserSpeech.stop();
    notifyPartialTranscript("");
    this.setState("IDLE");
  }

  startListening(): void {
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
