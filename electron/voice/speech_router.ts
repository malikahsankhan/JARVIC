import { EventEmitter } from "events";
import { BrowserSpeechService } from "./browser_speech";
import type { BrowserTranscript } from "./types";

export class SpeechRouter extends EventEmitter {
  constructor(private readonly browserSpeech: BrowserSpeechService) {
    super();
    this.browserSpeech.on("speech-start", () => this.emit("speech-start"));
    this.browserSpeech.on("partial", (text: string) => this.emit("partial", text));
    this.browserSpeech.on("transcript", (result: BrowserTranscript) => this.emit("transcript", result));
    this.browserSpeech.on("stopped", (reason: string) => this.emit("stopped", reason));
    this.browserSpeech.on("error", (error: string) => this.emit("error", error));
  }

  startListening(reason: "manual" | "barge-in" = "manual"): void {
    this.browserSpeech.startRecognition(reason);
  }

  stopListening(): void {
    this.browserSpeech.stopRecognition();
  }
}
