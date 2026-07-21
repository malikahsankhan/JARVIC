/**
 * electron/voice/wakeWord.ts
 *
 * Local wake-word matching.
 *
 * Wake-word detection must always run locally and never depend on the
 * browser. Rather than running a second, separate always-on microphone
 * pipeline just to spot the wake phrase, JARVIC reuses its single
 * continuous OfflineSpeechEngine transcription stream (fully local
 * whisper.cpp) as the wake-word detector too: every short utterance it
 * transcribes is checked against the configured wake phrase here.
 *
 * This keeps exactly one microphone stream open at a time (avoiding
 * device-contention issues) while still guaranteeing wake-word detection
 * never touches the network or the browser.
 *
 * This module is intentionally just a pure matcher — swapping in a
 * dedicated wake-word engine later (e.g. Porcupine/openWakeWord, which
 * would run continuously in parallel rather than via transcription) only
 * means replacing `matchWakeWord`'s implementation and, in VoiceManager,
 * where it's called from — nothing else changes.
 */

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A few common mis-transcriptions of "jarvic" that tiny.en tends to produce. */
const WAKE_ALIASES = ["jarvic", "jarvis", "jarwick", "jar vic"];

export interface WakeWordMatch {
  matched: boolean;
  /** Whatever came after the wake phrase in the same utterance, if anything — e.g. "open chrome". */
  remainder: string;
}

/**
 * Checks whether `utterance` contains the configured wake word (fuzzy: the
 * configured lead-in word, e.g. "hey"/"ok", plus any known alias of
 * "jarvic"). Returns the text spoken *after* the wake phrase so a command
 * said in the same breath ("Hey Jarvic, open Chrome") can be acted on
 * immediately instead of requiring a second utterance.
 */
export function matchWakeWord(utterance: string, configuredWakeWord: string): WakeWordMatch {
  const text = normalize(utterance);
  if (!text) return { matched: false, remainder: "" };

  const configured = normalize(configuredWakeWord);
  const candidates = new Set<string>([configured]);
  for (const alias of WAKE_ALIASES) {
    const leadIn = configured.split(" ")[0] || "hey";
    candidates.add(`${leadIn} ${alias}`);
  }
  // Also just the alias by itself, in case someone drops the lead-in word.
  for (const alias of WAKE_ALIASES) candidates.add(alias);

  for (const phrase of candidates) {
    const idx = text.indexOf(phrase);
    if (idx !== -1) {
      const remainder = text.slice(idx + phrase.length).trim();
      return { matched: true, remainder };
    }
  }
  return { matched: false, remainder: "" };
}
