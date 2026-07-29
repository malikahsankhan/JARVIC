/**
 * electron/voice/notify.ts
 *
 * Broadcasts voice events to the renderer over the SAME "jarvic-audio-event"
 * IPC channel. The renderer's listener for this channel
 * (src/App.tsx) understands these event names:
 *
 *   - "speech-start"     → interrupts any ongoing TTS, sets UI state to listening
 *   - "final-transcript" → forwards the text straight into handleSendMessage()
 *
 * Reusing this channel lets the browser-only voice system hand final transcripts
 * to the AI planner without changing the planner.
 */

import { BrowserWindow } from "electron";

export function notifyRenderer(event: string, data?: unknown): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send("jarvic-audio-event", { event, data });
    }
  }
}

/** Tell the renderer to stop any TTS/UI speaking indicator immediately. */
export function notifyInterruptSpeaking(): void {
  notifyRenderer("speech-start");
}

/** Send live interim transcript to the renderer UI. */
export function notifyPartialTranscript(text: string): void {
  notifyRenderer("partial-transcript", text);
}

/** Hand a finished, final transcript to the AI planner via the existing renderer bridge. */
export function notifyFinalTranscript(text: string): void {
  notifyRenderer("final-transcript", text);
}

/** Surface a voice-pipeline warning/error (e.g. Chrome speech client failed to launch or errored) to the renderer, so it's visible in the UI instead of only the main-process console. */
export function notifyVoiceWarning(message: string): void {
  notifyRenderer("voice-warning", message);
}

/** Tell the renderer whether the microphone is fully powered on or off (hardware/browser-process level, not just paused). */
export function notifyMicPowerState(powered: boolean): void {
  notifyRenderer("mic-power", powered);
}

/** Tell the renderer whether wake-word gating is enabled. */
export function notifyWakeWordState(enabled: boolean): void {
  notifyRenderer("wake-word-state", enabled);
}

/** Tell the renderer a wake word was just detected (for a UI chime/flash). */
export function notifyWakeWordDetected(): void {
  notifyRenderer("wake-word-detected");
}

