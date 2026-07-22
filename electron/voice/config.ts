/**
 * electron/voice/config.ts
 *
 * Speech Recognition configuration. Reads overrides from environment
 * variables, defaulting to BROWSER mode (no local Whisper execution).
 */

import type { VoiceConfig, SpeechMode } from "./types";

function envSpeechMode(): SpeechMode {
  const raw = (process.env.JARVIC_SPEECH_MODE || "BROWSER").toUpperCase();
  return raw === "OFFLINE" ? "OFFLINE" : "BROWSER";
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadVoiceConfig(): VoiceConfig {
  return {
    speechMode: envSpeechMode(),
    browserPort: envInt("JARVIC_VOICE_BROWSER_PORT", 8765),
    wakeWord: (process.env.JARVIC_WAKE_WORD || "hey jarvic").toLowerCase(),
    followUpTimeoutMs: envInt("JARVIC_FOLLOWUP_TIMEOUT_MS", 8000),
    silenceTimeoutMs: envInt("JARVIC_SILENCE_TIMEOUT_MS", 1500),
    microphone: process.env.JARVIC_MICROPHONE || null,
    voice: process.env.JARVIC_TTS_VOICE || null,
  };
}
