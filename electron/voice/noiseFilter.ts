/**
 * Filter out environmental non-speech noise artifacts (coughing, birds chirping,
 * door shutting, background music, etc.) produced by speech recognition engines.
 */

const NOISE_PHRASES = [
  "cough", "coughing", "clear throat", "clears throat", "throat clearing", "sneeze", "sneezing",
  "birds chirping", "bird chirping", "birds singing", "chirp", "chirping",
  "door opening", "door opens", "door shut", "door shutting", "door closing", "door closes", "door slamming",
  "laughter", "laughing", "chuckle", "giggle", "snicker",
  "applause", "clapping", "cheering",
  "sigh", "sighing", "gasp", "groan", "grunt", "snort", "yawn",
  "heavy breathing", "panting", "whispering",
  "dog barking", "barking", "meow", "meowing",
  "music", "dramatic music", "background noise", "ambient noise", "static", "buzzing", "footsteps", "typing", "keyboard",
  "uh", "um", "hmm", "hm", "mhm", "ah", "huh", "shh", "shhh", "tck", "tch", "er", "ur", "ew", "ooh", "aah",
  "thank you for watching", "thanks for watching", "subtitles by", "amara.org"
];

export function isEnvironmentalNoise(rawText: string): boolean {
  if (!rawText) return true;
  const trimmed = rawText.trim();
  const text = trimmed.toLowerCase().replace(/[\.\!\?\,]/g, "");
  if (!text) return true;

  // Entirely wrapped in brackets, parentheses, or asterisks e.g. (coughing), [door shut], *birds chirping*
  if (/^[\(\[\*].*[\)\]\*]$/.test(trimmed)) return true;

  // Exact match with any environmental noise phrase
  for (const phrase of NOISE_PHRASES) {
    if (text === phrase) return true;
  }

  if (text.length <= 1) return true;

  return false;
}

export function sanitizeVoiceTranscript(rawText: string): string {
  if (!rawText) return "";

  // Remove inline bracketed noise annotations e.g. "(cough) open video" -> "open video"
  let cleaned = rawText
    .replace(/[\(\[\*][^\)\}\*]*[\)\]\*]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (isEnvironmentalNoise(cleaned)) {
    return "";
  }

  return cleaned;
}
