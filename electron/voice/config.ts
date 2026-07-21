/**
 * electron/voice/config.ts
 *
 * Hybrid Speech Recognition configuration. Reads overrides from environment
 * variables (so it's configurable the same way the rest of JARVIC is, via
 * .env / electron-builder env), falling back to sensible defaults.
 */

import type { VoiceConfig, SpeechMode } from "./types";

function envSpeechMode(): SpeechMode {
  const raw = (process.env.JARVIC_SPEECH_MODE || "AUTO").toUpperCase();
  return raw === "BROWSER" || raw === "OFFLINE" ? raw : "AUTO";
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
