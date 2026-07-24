export type VoiceState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING" | "INTERRUPTED";

export interface BrowserTranscript {
  text: string;
  confidence: number;
  final: boolean;
}

export type BrowserSpeechCommand =
  | { type: "start"; reason: "manual" | "barge-in" }
  | { type: "stop" }
  | { type: "ping" };

export type BrowserSpeechEvent =
  | { type: "ready" }
  | { type: "speech-start" }
  | { type: "partial"; text: string; confidence: number }
  | { type: "final"; text: string; confidence: number }
  | { type: "stopped"; reason?: string }
  | { type: "error"; error: string }
  | { type: "pong" };
