# 🤖 JARVIC — Desktop AI Assistant

**JARVIC** is an advanced, voice-enabled Desktop AI Assistant built with **Electron**, **React**, **TypeScript**, **Playwright**, and **Gemini AI**. It features real-time browser speech recognition, natural conversational barge-in (speech interruption), desktop & web automation, and a sleek floating mini-widget layout.

---

## ✨ Features

- 🎙️ **Automated Browser Speech Recognition**: Powered by Web Speech API inside an automated, hidden Chromium browser managed via Playwright integration. No manual browser setup required.
- ⚡ **Natural Barge-In (Speech Interruption)**: Start speaking at any moment to instantly interrupt JARVIC's vocal response and issue new commands without waiting.
- 💬 **Live Transcript Streaming**: View real-time partial transcriptions directly in the UI with automatic silence detection for prompt finalization.
- 🤖 **AI Planner & System Tools**: Powered by Gemini API to execute desktop tools, file operations, web browsing automation, and system commands.
- 🧩 **Modular Voice Architecture**: Built on a decoupled `SpeechEngine` interface, making it seamless to re-integrate offline engines (Whisper / Vosk) without modifying core voice state logic.
- 🛡️ **Environmental Noise Filtering**: Intelligent noise filtering to ignore typing, clicks, filler words, and background artifacts.
- 🪟 **Floating Mini-Widget**: A persistent overlay widget that stays on top when the main application window is minimized.

---

## 🛠️ System Architecture

```
                       +-----------------------------+
                       |      JARVIC Renderer        |
                       | (React + Vite + TypeScript) |
                       +--------------+--------------+
                                      |
                           jarvic-audio-event (IPC)
                                      |
                       +--------------v--------------+
                       |        VoiceManager         |
                       |  (Voice State Machine)      |
                       +--------------+--------------+
                                      |
                                 SpeechRouter
                                      |
                       +--------------v--------------+
                       |     BrowserSpeechEngine     |
                       | (Local WebSocket Bridge)    |
                       +--------------+--------------+
                                      |
                                 WebSocket
                                      |
         +----------------------------v----------------------------+
         |     Automated Background Chrome (Playwright Client)     |
         |         (Web Speech API Recognition Engine)             |
         +---------------------------------------------------------+
```

### Voice Priority Hierarchy
1. **User Speech** *(Highest)*: Speech detection immediately halts active TTS and enters listening mode.
2. **Speech Recognition**: Continuously streams partial transcripts and auto-detects end-of-speech silence.
3. **AI Processing**: Processes finalized prompt through AI Planner.
4. **Text-to-Speech** *(Lowest)*: Vocal playback that can be interrupted instantly.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v18.0.0` or higher
- **npm**: `v9.0.0` or higher
- **Google Gemini API Key**: Obtainable from [Google AI Studio](https://aistudio.google.com/)

---

### Step 1: Install Dependencies

```bash
npm install
```

---

### Step 2: Configure Environment Variables

Create a `.env` file in the root directory (or copy `.env.example`):

```env
# Gemini API Key (Required for AI Planner)
GEMINI_API_KEY=your_gemini_api_key_here

# Optional Voice Configuration
JARVIC_SPEECH_MODE=BROWSER
JARVIC_VOICE_BROWSER_PORT=8765
JARVIC_FOLLOWUP_TIMEOUT_MS=8000
JARVIC_SILENCE_TIMEOUT_MS=1500
```

---

### Step 3: Run in Development Mode

Run the local server and Electron application concurrently:

```bash
npm run electron:dev
```

> **Note**: On first launch, Playwright will automatically initialize a hidden Chromium context for speech recognition and grant microphone permissions automatically.

---

## 📦 Building for Production

### Build Desktop Application Executable (Windows)

```bash
npm run dist:win
```

The output executable will be available in the `dist-electron/` / `dist/` release directories.

### Build Application Bundles

```bash
npm run electron:build
```

---

## 📜 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Runs the local backend server (`server.ts`) |
| `npm run electron:dev` | Launches JARVIC in full desktop development mode |
| `npm run build` | Compiles Vite frontend assets and server entry point |
| `npm run electron:build` | Bundles main process, preload scripts, and renderer code |
| `npm run dist:win` | Packages the production Windows executable (`.exe`) |
| `npm run lint` | Runs TypeScript typechecks on frontend code |
| `npm run lint:electron` | Runs TypeScript typechecks on main Electron process code |

---

## 📂 Project Structure

```
├── electron/
│   ├── main.ts                     # Electron main process entry point
│   ├── preload.ts                  # Secure IPC bridge context definition
│   ├── preload-mini.ts             # Floating mini-widget preload script
│   ├── browser/                    # Browser automation manager (Playwright)
│   ├── ipc/                        # Safe IPC handlers and tool registry
│   ├── tools/                      # Audio, TTS, and Desktop automation tools
│   └── voice/                      # Modular Voice Pipeline
│       ├── browserSpeechEngine.ts  # Web Speech API + WS Bridge + Playwright Chrome
│       ├── offlineSpeechEngine.ts  # Modular offline engine stub
│       ├── voiceManager.ts         # Voice state machine & barge-in controller
│       ├── speechRouter.ts         # Speech engine mode router
│       ├── noiseFilter.ts          # Noise filtering & transcript sanitizer
│       ├── notify.ts               # Electron IPC audio event sender
│       └── types.ts                # Voice system type definitions
├── src/                            # React Frontend App
│   ├── App.tsx                     # Main JARVIC user interface
│   ├── components/                 # UI Components
│   └── main.tsx                    # React DOM entry point
├── server.ts                       # Local Express backend server
├── package.json                    # Project dependencies & build scripts
└── tsconfig.json                   # TypeScript configuration
```

---

## 📄 License

This project is licensed under the MIT License.
