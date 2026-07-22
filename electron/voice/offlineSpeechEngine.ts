/**
 * electron/voice/offlineSpeechEngine.ts
 *
 * Offline Speech Engine Stub (Layer 2 modular placeholder).
 * Offline recognition (Whisper / Vosk) is currently disabled per user prompt.
 * This class implements SpeechEngine so an offline engine can be plugged back
 * in later without changing VoiceManager or SpeechRouter.
 */

import { EventEmitter } from "events";
import type { SpeechEngine, TranscriptResult } from "./types";

export class OfflineSpeechEngine extends EventEmitter implements SpeechEngine {
  private running = false;

  isHealthy(): boolean {
    return false; // Disabled for now; VoiceManager uses BrowserSpeechEngine
  }

  async start(): Promise<void> {
    this.running = true;
    console.log("[OfflineSpeechEngine] Offline speech engine is currently disabled.");
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log("[OfflineSpeechEngine] Stopped.");
  }
}

