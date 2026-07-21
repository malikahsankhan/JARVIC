/**
 * electron/voice/types.ts
 *
 * Shared types for JARVIC's Hybrid Speech Recognition system.
 *
 * Architecture:
 *
 *   VoiceManager
 *       │
 *       ▼
 *   SpeechRouter  ── AUTO / BROWSER / OFFLINE
 *       │       │
 *       ▼       ▼
 *  BrowserSpeechEngine   OfflineSpeechEngine
 *  (real Chrome tab,     (local mic capture +
 *   Web Speech API,       whisper.cpp — also the
 *   over local WebSocket) always-on local wake-word
 *                          detector)
 *       │       │
 *       └───┬───┘
 *           ▼
 *      AI Planner (unchanged — transcripts are handed to the
 *                   renderer's existing `handleSendMessage` via
 *                   the existing "jarvic-audio-event" IPC channel,
 *                   exactly like the pre-existing whisper.cpp path.
 *                   No UI or planner code was touched for this.)
 */

/** High-level voice interaction state, per the requested state machine. */
export type VoiceState =
  | "IDLE"
  | "WAKE_WORD"
  | "LISTENING"
  | "PROCESSING"
  | "SPEAKING"
  | "FOLLOW_UP"
  | "TIMEOUT";

/** Which speech recognition backend(s) the SpeechRouter is allowed to use. */
export type SpeechMode = "AUTO" | "BROWSER" | "OFFLINE";

/** A single recognized utterance, from either backend. */
export interface TranscriptResult {
  text: string;
  confidence: number;
  final: boolean;
  source: "browser" | "offline";
}

/** Full hybrid voice configuration (see voice/config.ts for defaults + loading). */
export interface VoiceConfig {
  /** AUTO | BROWSER | OFFLINE */
  speechMode: SpeechMode;
  /** Port the local WebSocket/HTTP bridge for the browser speech client listens on. */
  browserPort: number;
  /** The wake phrase, e.g. "hey jarvic". Matching is fuzzy/case-insensitive. */
  wakeWord: string;
  /** How long (ms) JARVIC stays in FOLLOW_UP mode (no wake word needed) after speaking. */
  followUpTimeoutMs: number;
  /** How long (ms) of silence ends an utterance while actively listening. */
  silenceTimeoutMs: number;
  /** Optional microphone device name/index hint (passed to PvRecorder if supported). */
  microphone?: string | null;
  /** Optional OS TTS voice name. */
  voice?: string | null;
}

/** Common interface both speech engines implement, so either is swappable. */
export interface SpeechEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
  isHealthy(): boolean;
  on(event: "transcript", cb: (result: TranscriptResult) => void): void;
  on(event: "partial", cb: (text: string) => void): void;
}
