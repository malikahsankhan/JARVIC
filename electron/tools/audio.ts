import { registerTool } from "../ipc/toolRegistry";
import { isTtsSpeaking, stopTtsSpeaking } from "./tts";
import { runCaptured } from "./lib";
import { BrowserWindow } from "electron";
import path from "path";
import fs from "fs";

const resolvePvRecorder = () => {
  const candidates = [
    "@picovoice/pvrecorder-node",
    path.join(process.cwd(), "node_modules", "@picovoice", "pvrecorder-node"),
    path.join(__dirname, "..", "node_modules", "@picovoice", "pvrecorder-node"),
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

const WHISPER_DIR = path.join(process.cwd(), "whisper");
const WHISPER_RELEASE_DIR = path.join(WHISPER_DIR, "Release");
const MODEL_PATH = path.join(WHISPER_DIR, "ggml-tiny.en.bin");
const EXE_PATH = path.join(WHISPER_RELEASE_DIR, "whisper-cli.exe");
const TEMP_WAV_PATH = path.join(WHISPER_DIR, "temp_input.wav");

let recorder: any = null;
let stopRecording = false;
let isRunning = false;

function notifyRenderer(event: string, data?: any) {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    wins[0].webContents.send("jarvic-audio-event", { event, data });
  }
}

function saveWavFile(filePath: string, framesList: Int16Array[], sampleRate: number): void {
  let totalSamples = 0;
  for (const frames of framesList) {
    totalSamples += frames.length;
  }

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
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // 16-bit
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  const fd = fs.openSync(filePath, "w");
  fs.writeSync(fd, header, 0, header.length);
  fs.writeSync(fd, pcmBuffer, 0, pcmBuffer.length);
  fs.closeSync(fd);
}

function parseWhisperOutput(stdout: string): string {
  // Strip whisper diagnostic lines, timestamps like [00:00:00.000 --> 00:00:05.000]
  // and any blank lines. Keep only actual transcript text.
  return stdout
    .split("\n")
    .map(line => line.trim())
    .filter(line =>
      line.length > 0 &&
      !line.startsWith("whisper_") &&
      !line.startsWith("llama_") &&
      !line.startsWith("system_info") &&
      !line.startsWith("ggml_") &&
      !line.startsWith("main:") &&
      !/^\[\d{2}:\d{2}:\d{2}/.test(line) // strip timestamp lines
    )
    .join(" ")
    .trim();
}

async function transcribeAndSend(frames: Int16Array[]) {
  try {
    saveWavFile(TEMP_WAV_PATH, frames, 16000);

    if (!fs.existsSync(EXE_PATH)) {
      throw new Error(`Whisper.cpp executable not found at: ${EXE_PATH}`);
    }
    if (!fs.existsSync(MODEL_PATH)) {
      throw new Error(`Whisper model not found at: ${MODEL_PATH}`);
    }

    // Run whisper-cli.exe from its own directory so sibling DLLs (whisper.dll,
    // ggml.dll, libopenblas.dll, etc.) are found via the OS DLL search path.
    const stdout = await runCaptured(
      EXE_PATH,
      ["-m", MODEL_PATH, "-f", TEMP_WAV_PATH, "-nt"],
      30_000,          // 30 s timeout — tiny model is fast but give headroom
      WHISPER_RELEASE_DIR  // cwd = Release/ so DLLs resolve
    );
    const text = parseWhisperOutput(stdout);
    
    if (text) {
      console.log(`[Whisper] Transcribed: "${text}"`);
      notifyRenderer("final-transcript", text);
    }
  } catch (err: any) {
    console.error("[Whisper] Transcription error:", err);
  } finally {
    try {
      if (fs.existsSync(TEMP_WAV_PATH)) {
        fs.unlinkSync(TEMP_WAV_PATH);
      }
    } catch {}
  }
}

function startRecordingLoop() {
  if (isRunning) return;
  isRunning = true;
  stopRecording = false;

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
    recorder = new PvRecorder(frameLength, -1);
    recorder.start();
  } catch (err) {
    console.error("[Audio] Failed to initialize PvRecorder:", err);
    isRunning = false;
    return;
  }

  const recordFrame = async () => {
    if (stopRecording) {
      cleanup();
      return;
    }

    try {
      if (!recorder) return;
      const frames = await recorder.read();
      
      let sum = 0;
      for (let i = 0; i < frames.length; i++) {
        sum += Math.abs(frames[i]);
      }
      const avgVol = sum / frames.length;

      const currentThreshold = isTtsSpeaking() ? thresholdSpeaking : thresholdNormal;

      if (!speaking) {
        audioBuffer.push(frames);
        if (audioBuffer.length > maxPreRollFrames) {
          audioBuffer.shift();
        }

        if (avgVol > currentThreshold) {
          speaking = true;
          silenceFrames = 0;
          console.log(`[Audio] Speaking detected! Vol: ${avgVol.toFixed(1)} vs Thresh: ${currentThreshold}`);
          notifyRenderer("speech-start");
          
          stopTtsSpeaking();
        }
      } else {
        audioBuffer.push(frames);
        if (avgVol < currentThreshold) {
          silenceFrames++;
          if (silenceFrames >= maxSilenceFrames) {
            console.log("[Audio] Silence limit reached, transcribing...");
            const framesToTranscribe = [...audioBuffer];
            audioBuffer = [];
            speaking = false;
            silenceFrames = 0;

            transcribeAndSend(framesToTranscribe);
          }
        } else {
          silenceFrames = 0;
        }
      }

      setImmediate(recordFrame);
    } catch (err) {
      console.error("[Audio] Error in recording frame:", err);
      cleanup();
    }
  };

  recordFrame();
}

function cleanup() {
  if (recorder) {
    try {
      recorder.stop();
      recorder.release();
    } catch {}
    recorder = null;
  }
  isRunning = false;
  console.log("[Audio] Recorder stopped and cleaned up.");
}

registerTool({
  name: "system.audio.listen",
  description: "Capture microphone audio locally and transcribe it using local Whisper.cpp.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).mode !== "string") {
      throw new Error("Expected { mode: string }");
    }
    return { mode: (raw as any).mode as string };
  },
  handler: async ({ mode }: { mode: string }) => {
    if (mode === "start") {
      if (!isRunning) {
        startRecordingLoop();
      }
      return { success: true, message: "Local voice capture running." };
    } else if (mode === "stop") {
      stopRecording = true;
      return { success: true, message: "Local voice capture stopping." };
    }
    throw new Error(`Unsupported mode: ${mode}`);
  },
});
