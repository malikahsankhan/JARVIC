import 'dotenv/config';
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { AssemblyAI } from "assemblyai";

const apiKey = process.env.ASSEMBLYAI_API_KEY;
if (!apiKey) {
  console.error("ASSEMBLYAI_API_KEY is not set. Set it in your environment or in a .env file.");
  process.exit(1);
}

const client = new AssemblyAI({ apiKey });
const transcriber = client.streaming.transcriber({
  speechModel: "universal-3-5-pro",
  sampleRate: 16_000,
});

transcriber.on("open", ({ id }) => console.log(`Session opened: ${id}`));
transcriber.on("error", (error) => console.error("Error:", error));
transcriber.on("close", (code, reason) => console.log("Session closed:", code, reason));
transcriber.on("turn", (turn) => {
  if (turn.transcript) console.log("Turn:", turn.transcript);
});

const recorder = new PvRecorder(800, -1);
let running = true;
process.on("SIGINT", () => {
  running = false;
});

const run = async () => {
  await transcriber.connect();
  recorder.start();
  console.log("Recording — press Ctrl+C to stop.");

  while (running) {
    const frames = await recorder.read();
    const buffer = Buffer.from(new Int16Array(frames).buffer);
    transcriber.sendAudio(buffer);
  }

  recorder.stop();
  await transcriber.close();
};

run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
