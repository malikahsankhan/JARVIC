/**
 * electron/voice/index.ts
 *
 * Entry point for JARVIC's Hybrid Speech Recognition system — mirrors the
 * singleton pattern already used by electron/browser/BrowserManager.ts.
 *
 * main.ts only needs `voiceManager.start()` at startup and
 * `voiceManager.stop()` at shutdown; everything else (wake word, mode
 * failover/recovery, follow-up mode, state machine) is internal.
 */

import { VoiceManager } from "./voiceManager";

export const voiceManager = new VoiceManager();
export { VoiceManager } from "./voiceManager";
export type { VoiceState, SpeechMode, VoiceConfig } from "./types";
