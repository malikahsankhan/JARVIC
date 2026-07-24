/**
 * electron/voice/index.ts
 *
 * Entry point for JARVIC's Hybrid Speech Recognition system — mirrors the
 * singleton pattern already used by electron/browser/BrowserManager.ts.
 *
 * main.ts only needs `voiceManager.start()` at startup and
 * `voiceManager.stop()` at shutdown; everything else (wake word, mode
 * hidden Chrome bridge, WebSocket route, and state machine) is internal.
 */

import { VoiceManager } from "./voice_manager";

export const voiceManager = new VoiceManager();
export { VoiceManager } from "./voice_manager";
export type { VoiceState } from "./types";
