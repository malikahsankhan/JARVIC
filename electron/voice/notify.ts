/**
 * electron/voice/notify.ts
 *
 * Broadcasts voice events to the renderer over the SAME "jarvic-audio-event"
 * IPC channel the pre-existing whisper.cpp capture already uses (see
 * electron/tools/audio.ts). The renderer's listener for this channel
 * (src/App.tsx) already understands two event names:
 *
 *   - "speech-start"     → interrupts any ongoing TTS, sets UI state to listening
 *   - "final-transcript" → forwards the text straight into handleSendMessage()
 *
 * Reusing this exact channel/event contract means the entire Hybrid Speech
 * Recognition system below can hand off transcripts to the AI planner and
 * drive the existing UI's "listening" indicator with ZERO changes to the
 * renderer/UI code.
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

/** Tell the renderer to stop any TTS/UI speaking indicator immediately (wake-word interrupt). */
export function notifyInterruptSpeaking(): void {
  notifyRenderer("speech-start");
}

/** Hand a finished, final transcript to the AI planner via the existing renderer bridge. */
export function notifyFinalTranscript(text: string): void {
  notifyRenderer("final-transcript", text);
}
