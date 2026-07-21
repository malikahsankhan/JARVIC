/**
 * electron/voice/offlineSpeechEngine.ts
 *
 * Offline Speech Engine (layer 2 of the Hybrid Speech Recognition system,
 * and JARVIC's always-on, fully-local wake-word listener).
 *
 * Fully local: continuous mic capture via PvRecorder + simple amplitude-based
 * VAD to segment utterances, each transcribed with the bundled whisper.cpp
 * (ggml-tiny.en) exactly like the existing `system.audio.listen` tool in
 * electron/tools/audio.ts — this engine is a clean, reusable, event-driven
 * rewrite of that same pipeline, dedicated to the hybrid voice system.
 *
 * This is deliberately built behind the `SpeechEngine` interface (see
 * types.ts) so the actual recognizer is swappable later — e.g. for
 * Vosk or faster-whisper — without touching VoiceManager/SpeechRouter.
 *
 * Because wake-word detection must ALWAYS run locally and must never
 * depend on the browser, this engine runs continuously for the entire
 * JARVIC session regardless of which SpeechMode is configured — it is
 * both "the offline fallback" AND "the wake-word detector": every
 * transcribed utterance is emitted, and VoiceManager decides whether to
 * treat it as a wake-word check (while IDLE) or a command (while
 * LISTENING/FOLLOW_UP).
 */

import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import { runCaptured } from "../tools/lib";
import { isTtsSpeaking } from "../tools/tts";

const WHISPER_DIR = path.join(process.cwd(), "whisper");
const WHISPER_RELEASE_DIR = path.join(WHISPER_DIR, "Release");
const MODEL_PATH = path.join(WHISPER_DIR, "ggml-tiny.en.bin");
const EXE_PATH = path.join(WHISPER_RELEASE_DIR, "whisper-cli.exe");
const TEMP_WAV_PATH = path.join(WHISPER_DIR, "voice_manager_input.wav");

const resolvePvRecorder = () => {
  const candidates = [
    "@picovoice/pvrecorder-node",
    path.join(process.cwd(), "node_modules", "@picovoice", "pvrecorder-node"),
    path.join(__dirname, "..", "..", "node_modules", "@picovoice", "pvrecorder-node"),
  ];
  let lastError: any = null;
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Failed to resolve @picovoice/pvrecorder-node");
};

function saveWavFile(filePath: string, framesList: Int16Array[], sampleRate: number): void {
  let totalSamples = 0;
  for (const frames of framesList) totalSamples += frames.length;

  const pcmBuffer = Buffer.alloc(totalSamples * 2);
  let offset = 0;
  for (const frames of framesList) {
    for (let i = 0; i < frames.length; i++) {
      pcmBuffer.writeInt16LE(frames[i], offset);
      offset += 2;
    }
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  const fd = fs.openSync(filePath, "w");
  fs.writeSync(fd, header, 0, header.length);
  fs.writeSync(fd, pcmBuffer, 0, pcmBuffer.length);
  fs.closeSync(fd);
}

function parseWhisperOutput(stdout: string): string {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("whisper_") &&
        !line.startsWith("llama_") &&
        !line.startsWith("system_info") &&
        !line.startsWith("ggml_") &&
        !line.startsWith("main:") &&
        !/^\[\d{2}:\d{2}:\d{2}/.test(line)
    )
    .join(" ")
    .trim();
}

export class OfflineSpeechEngine extends EventEmitter {
  private recorder: any = null;
  private running = false;
  private stopping = false;
  private healthy = false;

  isHealthy(): boolean {
    return this.healthy;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopping = false;

    console.log("[OfflineSpeechEngine] Offline recognition started");

    const sampleRate = 16000;
    const frameLength = 512;
    const thresholdNormal = 500;
    const thresholdSpeaking = 1800;
    const silenceSecondsLimit = 1.8;
    const maxSilenceFrames = Math.ceil((silenceSecondsLimit * sampleRate) / frameLength);
    const preRollSeconds = 0.5;
    const maxPreRollFrames = Math.ceil((preRollSeconds * sampleRate) / frameLength);

    let audioBuffer: Int16Array[] = [];
    let silenceFrames = 0;
    let speaking = false;

    try {
      const { PvRecorder } = resolvePvRecorder();
      this.recorder = new PvRecorder(frameLength, -1);
      this.recorder.start();
      this.healthy = true;
    } catch (err) {
      console.error("[OfflineSpeechEngine] Failed to initialize microphone:", err);
      this.running = false;
      this.healthy = false;
      throw err;
    }

    const loudness = (frames: Int16Array): number => {
      let sum = 0;
      for (let i = 0; i < frames.length; i++) sum += Math.abs(frames[i]);
      return sum / frames.length;
    };

    const recordFrame = async () => {
      if (this.stopping || !this.recorder) {
        this.cleanup();
        return;
      }
      try {
        const frames: Int16Array = await this.recorder.read();
        const avgVol = loudness(frames);
        const currentThreshold = isTtsSpeaking() ? thresholdSpeaking : thresholdNormal;

        if (!speaking) {
          audioBuffer.push(frames);
          if (audioBuffer.length > maxPreRollFrames) audioBuffer.shift();
          if (avgVol > currentThreshold) {
            speaking = true;
            silenceFrames = 0;
            this.emit("speech-start");
          }
        } else {
          audioBuffer.push(frames);
          if (avgVol < currentThreshold) {
            silenceFrames++;
            if (silenceFrames >= maxSilenceFrames) {
              const toTranscribe = [...audioBuffer];
              audioBuffer = [];
              speaking = false;
              silenceFrames = 0;
              this.transcribe(toTranscribe, sampleRate).catch((err) =>
                console.error("[OfflineSpeechEngine] Transcription error:", err)
              );
            }
          } else {
            silenceFrames = 0;
          }
        }
        setImmediate(recordFrame);
      } catch (err) {
        console.error("[OfflineSpeechEngine] Recording error:", err);
        this.healthy = false;
        this.cleanup();
      }
    };

    recordFrame();
  }

  private async transcribe(frames: Int16Array[], sampleRate: number): Promise<void> {
    try {
      saveWavFile(TEMP_WAV_PATH, frames, sampleRate);

      if (!fs.existsSync(EXE_PATH) || !fs.existsSync(MODEL_PATH)) {
        console.error(`[OfflineSpeechEngine] whisper.cpp not found (exe: ${fs.existsSync(EXE_PATH)}, model: ${fs.existsSync(MODEL_PATH)})`);
        return;
      }

      const stdout = await runCaptured(EXE_PATH, ["-m", MODEL_PATH, "-f", TEMP_WAV_PATH, "-nt"], 15_000, WHISPER_RELEASE_DIR);
      const text = parseWhisperOutput(stdout);
      if (text) {
        console.log(`[OfflineSpeechEngine] Transcript: "${text}"`);
        this.emit("transcript", { text, confidence: 0.8, final: true, source: "offline" });
      }
    } finally {
      try {
        if (fs.existsSync(TEMP_WAV_PATH)) fs.unlinkSync(TEMP_WAV_PATH);
      } catch {}
    }
  }

  private cleanup(): void {
    if (this.recorder) {
      try {
        this.recorder.stop();
        this.recorder.release();
      } catch {}
      this.recorder = null;
    }
    this.running = false;
    this.healthy = false;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.cleanup();
    console.log("[OfflineSpeechEngine] Stopped.");
  }
}
