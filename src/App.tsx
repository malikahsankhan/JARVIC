import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Message, ThemeName, ThemeColors, Directive, SystemStatus, JarvicState, ToolCall, ToolCallResult } from "./types";
import { isDestructiveTool } from "../shared/toolManifest";
import CoreReactor from "./components/CoreReactor";
import TerminalView from "./components/TerminalView";
import { 
  Shield, 
  Cpu, 
  Database, 
  Thermometer, 
  MapPin, 
  Wifi, 
  Plus, 
  Trash2, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  RefreshCw,
  FolderOpen,
  Terminal,
  Play,
  Settings,
  Video,
  VideoOff,
  Camera,
  Scan,
  Files,
  AppWindow,
  HardDrive,
  Search,
  Eye
} from "lucide-react";

// Audio sound synthesizers using native Web Audio API
const playSound = (type: "click" | "beep" | "success" | "warning") => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === "click") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === "beep") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      gain.gain.setValueAtTime(0.03, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "success") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === "warning") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(250, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(150, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch (err) {
    // browser blocked audio or not supported
  }
};

const THEMES: Record<ThemeName, ThemeColors> = {
  cyan: {
    primary: "text-cyan-400 border-cyan-500",
    primaryHex: "#22d3ee",
    bgDark: "bg-cyan-950/20",
    borderGlow: "shadow-[0_0_15px_rgba(6,182,212,0.15)]",
    accentGlow: "shadow-[0_0_8px_#22d3ee]",
    textGlow: "text-shadow-cyan"
  },
  amber: {
    primary: "text-amber-400 border-amber-500",
    primaryHex: "#f59e0b",
    bgDark: "bg-amber-950/20",
    borderGlow: "shadow-[0_0_15px_rgba(245,158,11,0.15)]",
    accentGlow: "shadow-[0_0_8px_#f59e0b]",
    textGlow: "text-shadow-amber"
  },
  emerald: {
    primary: "text-emerald-400 border-emerald-500",
    primaryHex: "#10b981",
    bgDark: "bg-emerald-950/20",
    borderGlow: "shadow-[0_0_15px_rgba(16,185,129,0.15)]",
    accentGlow: "shadow-[0_0_8px_#10b981]",
    textGlow: "text-shadow-emerald"
  },
  crimson: {
    primary: "text-rose-400 border-rose-500",
    primaryHex: "#f43f5e",
    bgDark: "bg-rose-950/20",
    borderGlow: "shadow-[0_0_15px_rgba(244,63,94,0.15)]",
    accentGlow: "shadow-[0_0_8px_#f43f5e]",
    textGlow: "text-shadow-crimson"
  },
  purple: {
    primary: "text-purple-400 border-purple-500",
    primaryHex: "#a855f7",
    bgDark: "bg-purple-950/20",
    borderGlow: "shadow-[0_0_15px_rgba(168,85,247,0.15)]",
    accentGlow: "shadow-[0_0_8px_#a855f7]",
    textGlow: "text-shadow-purple"
  }
};

export default function App() {
  const [themeName, setThemeName] = useState<ThemeName>("cyan");
  const theme = THEMES[themeName];

  // Core app state
  const [jarvicState, setJarvicState] = useState<JarvicState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [newDirectiveText, setNewDirectiveText] = useState("");
  const [systemLogs, setSystemLogs] = useState<string[]>([
    "[SYSTEM] Loading JARVIC Neural Core...",
    "[SYSTEM] Synthesizing audio engines... OK",
    "[SYSTEM] Initializing server pipeline... OK",
  ]);

  // System Diagnostics telemetry state
  const [diagnostics, setDiagnostics] = useState<SystemStatus | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);

  // Audio / Speech customization features
  const [isMuted, setIsMuted] = useState(false);
  const [voiceRecognitionActive, setVoiceRecognitionActive] = useState(false);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [livePartial, setLivePartial] = useState<string | null>(null);

  // Uplink active state and sandbox detection
  const [activeUplink, setActiveUplink] = useState<{ name: string; url: string } | null>(null);
  const [showSandboxBanner, setShowSandboxBanner] = useState(() => typeof window !== "undefined" && !window.jarvic);

  // Sub-System controller tab state
  const [rightPanelTab, setRightPanelTab] = useState<"env" | "apps">("apps");

  // Optical sensor (Webcam) features
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startCamera = async () => {
    playSound("click");
    addLog(">> [JARVIC] Deploying optical diagnostic imaging array...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      setCameraStream(stream);
      setIsCameraActive(true);
      // Wait for ref to bind in render
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
      addLog(">> [JARVIC] Optical channels active. Live lens feed online, Sir.");
      speakVoice("Optical channels are now active, Sir. Live lens feed has been initialized on the center HUD console.");
      playSound("success");
    } catch (err: any) {
      addLog(`>> [ERROR] Failed to engage optical sensor array: ${err.message || err}`);
      speakVoice("I was unable to deploy the optical sensors, Sir. Please confirm camera permissions in your mainframe browser.");
      playSound("warning");
    }
  };

  const stopCamera = () => {
    playSound("click");
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setIsCameraActive(false);
    addLog(">> [JARVIC] Optical sensor array powered down. Channels closed.");
    speakVoice("Optical sensor array has been powered down. Main HUD reverted to standard reactor sync.");
  };

  // Time stamp helper
  const [timeStr, setTimeStr] = useState("");

  // Fetch telemetry and directives on load
  useEffect(() => {
    fetchDiagnostics();
    fetchDirectives();
    
    // Update local clock
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short'
      };
      setTimeStr(now.toLocaleDateString('en-US', options).toUpperCase());
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // Cancel any ongoing speech synthesis output immediately (Interruption/Barge-in)
  const cancelSpeech = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
    if (typeof window !== "undefined" && (window as any).jarvic?.invokeTool) {
      try {
        (window as any).jarvic.invokeTool("system.tts.stop").catch(() => {});
      } catch (e) {}
    }
  };

  // Helper to filter non-speech environmental noise artifacts (coughing, birds, door shut, etc.)
  const sanitizeVoiceInput = (rawText: string): string => {
    if (!rawText) return "";
    const trimmed = rawText.trim();
    if (!trimmed) return "";

    // Entirely enclosed in brackets e.g. (coughing), [door shut], *birds chirping*
    if (/^[\(\[\*].*[\)\]\*]$/.test(trimmed)) return "";

    const noisePhrases = [
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

    const cleanLower = trimmed.toLowerCase().replace(/[\.\!\?\,]/g, "");
    for (const phrase of noisePhrases) {
      if (cleanLower === phrase) return "";
    }

    let cleaned = rawText
      .replace(/[\(\[\*][^\)\}\*]*[\)\]\*]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const checkCleanedLower = cleaned.toLowerCase().replace(/[\.\!\?\,]/g, "");
    for (const phrase of noisePhrases) {
      if (checkCleanedLower === phrase) return "";
    }

    if (cleaned.length <= 1) return "";

    return cleaned;
  };

  const addLog = (text: string) => {
    setSystemLogs(prev => [...prev, text]);
  };

  const fetchDiagnostics = async () => {
    setLoadingDiagnostics(true);
    try {
      const res = await fetch("/api/system/status");
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data);
        addLog(`>> [SYSTEM] Refreshed diagnostics telemetry successfully.`);
      } else {
        addLog(`>> [ERROR] Telemetry handshake failed.`);
      }
    } catch (err) {
      addLog(`>> [ERROR] Pipeline failure when querying diagnostics.`);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const fetchDirectives = async () => {
    try {
      const res = await fetch("/api/directives");
      if (res.ok) {
        const data = await res.json();
        setDirectives(data);
      }
    } catch (err) {
      addLog(`>> [ERROR] Could not fetch global directives list.`);
    }
  };

  const handleAddDirective = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newDirectiveText.trim()) return;
    playSound("click");
    try {
      const res = await fetch("/api/directives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newDirectiveText })
      });
      if (res.ok) {
        const data = await res.json();
        setDirectives(prev => [...prev, data]);
        addLog(`>> [DIRECTIVE] Added code protocol "${newDirectiveText}" successfully.`);
        setNewDirectiveText("");
        playSound("success");
      }
    } catch (err) {
      addLog(`>> [ERROR] Directive transmission interrupted.`);
    }
  };

  const handleDeleteDirective = async (id: string, content: string) => {
    playSound("click");
    try {
      const res = await fetch(`/api/directives/${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setDirectives(prev => prev.filter(d => d.id !== id));
        addLog(`>> [DIRECTIVE] Archive updated. Protocol "${content}" terminated.`);
        playSound("success");
      }
    } catch (err) {
      addLog(`>> [ERROR] Directive deletion request rejected by server.`);
    }
  };

  // Trigger JARVIC voice text-to-speech using Browser Web Speech API
  const speakVoice = async (text: string) => {
    if (isMuted) return;

    cancelSpeech();

    // Clean markdown and length cap
    const cleanText = text
      .replace(/[*_#`~>]/g, "")
      .replace(/\[.*?\]\(.*?\)/g, "")
      .substring(0, 1000);

    if (!cleanText.trim()) return;

    if (typeof window === "undefined" || !window.speechSynthesis) {
      addLog(">> [WARNING] Speech synthesis API unavailable in this browser environment.");
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voices = window.speechSynthesis.getVoices();
      const britishVoice = voices.find((v) => v.lang.includes("GB") || v.name.toLowerCase().includes("british") || v.name.toLowerCase().includes("uk") || v.name.toLowerCase().includes("george") || v.name.toLowerCase().includes("hazel"));
      const englishVoice = voices.find((v) => v.lang.startsWith("en"));
      if (britishVoice) {
        utterance.voice = britishVoice;
      } else if (englishVoice) {
        utterance.voice = englishVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        setJarvicState("speaking");
      };
      utterance.onend = () => {
        setJarvicState(voiceRecognitionActive ? "listening" : "idle");
      };
      utterance.onerror = () => {
        setJarvicState(voiceRecognitionActive ? "listening" : "idle");
      };

      speechUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("Browser speech synthesis error:", err);
      setJarvicState(voiceRecognitionActive ? "listening" : "idle");
    }
  };

  const stopVoiceCapture = async () => {
    setLivePartial(null);
    cancelSpeech();
    try {
      if ((window as any).jarvic?.invokeTool) {
        await (window as any).jarvic.invokeTool("system.audio.listen", { mode: "stop" });
      }
    } catch (err) {
      console.warn("Could not stop voice capture", err);
    }
    setVoiceRecognitionActive(false);
    setJarvicState("idle");
  };

  // Toggle voice capture (speech recognition)
  const toggleVoiceCapture = () => {
    playSound("click");
    if ((window as any).jarvic?.invokeTool) {
      (window as any).jarvic.invokeTool("system.audio.listen", { mode: "toggle" }).catch((err: any) => {
        console.error("Voice toggle error", err);
        addLog(">> [ERROR] Could not toggle voice capture: " + (err?.message ?? err));
      });
    } else {
      if (voiceRecognitionActive) {
        stopVoiceCapture().catch((err) => console.error("Voice stop error", err));
      } else {
        startVoiceCapture().catch((err) => console.error("Voice start error", err));
      }
    }
  };

  const startVoiceCapture = async () => {
    cancelSpeech();
    try {
      if ((window as any).jarvic?.invokeTool) {
        await (window as any).jarvic.invokeTool("system.audio.listen", { mode: "start" });
        setVoiceRecognitionActive(true);
        setJarvicState("listening");
        return;
      }
    } catch (err: any) {
      console.error("Could not start voice capture via tool", err);
    }

    setVoiceRecognitionActive(false);
    setJarvicState("idle");
  };

  // Safe manual text entry processing
  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    cancelSpeech();

    const query = text.trim();
    addLog(`$ ${query}`);

    const lowerQuery = query.toLowerCase();

    // 1. YouTube specific search routing
    const isYtSearch = lowerQuery.includes("youtube") && (lowerQuery.includes("search") || lowerQuery.includes("find") || lowerQuery.includes("lookup") || lowerQuery.includes("query") || lowerQuery.includes("open"));
    const isSpecificMrBeastSearch = lowerQuery.includes("mr beast") || lowerQuery.includes("mrbeast");

    if (isYtSearch || isSpecificMrBeastSearch) {
      let searchTerms = query;
      searchTerms = searchTerms.replace(/(search for|search|lookup|find|query|open|channel|on youtube|youtube)/gi, "").trim();
      if (!searchTerms && isSpecificMrBeastSearch) {
        searchTerms = "MrBeast";
      }
      
      if (searchTerms) {
        playSound("beep");
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerms)}`;
        addLog(`>> [JARVIC] Initializing YouTube mainframe search sequence for "${searchTerms}"...`);

        setActiveUplink({ name: `YouTube: "${searchTerms}"`, url });

        try {
          const jarvic = (window as any).jarvic;
          if (jarvic?.invokeTool) {
            // Opens in JARVIC's own persistent browser (BrowserManager),
            // not the OS default browser.
            const result = await jarvic.invokeTool("web.open", { url });
            if (result?.success) {
              addLog(`>> [JARVIC] YouTube query uplink established: [VIEW SEARCH RESULTS](${url})`);
              speakVoice(`Searching YouTube for ${searchTerms}, Sir. Query uplink established successfully.`);
            } else {
              addLog(`>> [WARNING] Could not open YouTube: ${result?.error ?? "Unknown error"}. Use this link: [CLICK TO SEARCH YOUTUBE](${url})`);
              speakVoice(`Could not open YouTube, Sir. Please use the link in the console.`);
            }
          } else {
            const opened = window.open(url, "_blank");
            if (opened) {
              addLog(`>> [JARVIC] YouTube query uplink established: [VIEW SEARCH RESULTS](${url})`);
              speakVoice(`Searching YouTube for ${searchTerms}, Sir. Query uplink established successfully.`);
            } else {
              addLog(`>> [WARNING] Direct query blocked by secure browser iframe shield. Please click the glowing bridge button on the console center, or use this link: [CLICK TO SEARCH YOUTUBE](${url})`);
              speakVoice(`Uplink blocked by browser shield, Sir. Please confirm using the central bridge button.`);
            }
          }
        } catch {
          addLog(`>> [WARNING] Direct lookup failed. Click manual bridge: [CLICK TO SEARCH YOUTUBE](${url})`);
          speakVoice(`Please confirm using the central bridge button, Sir.`);
        }
        playSound("success");
        return;
      }
    }

    // 1.5. Sub-system layout and panel activation command keywords

    if (lowerQuery.includes("show apps") || lowerQuery.includes("open apps") || lowerQuery.includes("other applications") || lowerQuery.includes("applications") || lowerQuery.includes("app launcher") || lowerQuery.includes("open applications") || lowerQuery.includes("show applications")) {
      playSound("beep");
      setRightPanelTab("apps");
      addLog(`>> [JARVIC] Initializing Application Launcher grid on console side-channel...`);
      speakVoice("Deploying the Application Launcher suite in the side panel, Sir. Under your command.");
      playSound("success");
      return;
    }

    // 2. Camera Command activation
    if (lowerQuery.includes("open camera") || lowerQuery.includes("start camera") || lowerQuery.includes("turn on camera") || lowerQuery.includes("activate camera") || lowerQuery.includes("deploy camera")) {
      await startCamera();
      return;
    }
    if (lowerQuery.includes("close camera") || lowerQuery.includes("stop camera") || lowerQuery.includes("turn off camera") || lowerQuery.includes("deactivate camera") || lowerQuery.includes("kill camera")) {
      stopCamera();
      return;
    }

    // Web opening detection logic
    const detectWebLaunch = (txt: string): { name: string; url: string } | null => {
      const lower = txt.toLowerCase();
      if (lower.includes("open youtube") || lower.includes("youtube.com")) {
        return { name: "YouTube", url: "https://youtube.com" };
      }
      if (lower.includes("open google") || lower.includes("google.com")) {
        return { name: "Google", url: "https://google.com" };
      }
      if (lower.includes("open github") || lower.includes("github.com")) {
        return { name: "GitHub", url: "https://github.com" };
      }
      if (lower.includes("open stackoverflow") || lower.includes("stackoverflow.com")) {
        return { name: "StackOverflow", url: "https://stackoverflow.com" };
      }
      if (lower.includes("open wikipedia") || lower.includes("wikipedia.org")) {
        return { name: "Wikipedia", url: "https://wikipedia.org" };
      }
      if (lower.includes("open chatgpt") || lower.includes("openai.com")) {
        return { name: "ChatGPT", url: "https://chatgpt.com" };
      }
      if (lower.includes("open netflix") || lower.includes("netflix.com")) {
        return { name: "Netflix", url: "https://netflix.com" };
      }
      if (lower.includes("open facebook") || lower.includes("facebook.com")) {
        return { name: "Facebook", url: "https://facebook.com" };
      }
      if (lower.includes("open x") || lower.includes("open twitter") || lower.includes("twitter.com")) {
        return { name: "Twitter/X", url: "https://x.com" };
      }
      if (lower.includes("open maps") || lower.includes("google maps")) {
        return { name: "Google Maps", url: "https://maps.google.com" };
      }
      if (lower.includes("open gmail") || lower.includes("gmail.com")) {
        return { name: "Gmail", url: "https://mail.google.com" };
      }
      
      // Check for generic "open <url>"
      const urlRegex = /(https?:\/\/[^\s]+)/;
      const match = txt.match(urlRegex);
      if (match) {
        return { name: "Uplink", url: match[1] };
      }

      // Check for generic "open <site>.com"
      const domainRegex = /open\s+([a-zA-Z0-9-]+\.[a-zA-Z]{2,6})/;
      const domainMatch = lower.match(domainRegex);
      if (domainMatch) {
        return { name: domainMatch[1], url: `https://${domainMatch[1]}` };
      }

      return null;
    };

    const webLaunch = detectWebLaunch(query);
    if (webLaunch) {
      playSound("beep");
      addLog(`>> [JARVIC] Initializing secure terminal uplink to ${webLaunch.name}...`);

      // Stage active manual bridge override
      setActiveUplink({ name: webLaunch.name, url: webLaunch.url });

      try {
        // In Electron, open in JARVIC's own persistent browser via the
        // web.open tool (BrowserManager) so these shortcuts land in the
        // same Chrome instance/profile as every other browser command —
        // never the OS default browser. Fall back to window.open in a
        // plain (non-Electron) browser context.
        const jarvic = (window as any).jarvic;
        if (jarvic?.invokeTool) {
          const result = await jarvic.invokeTool("web.open", { url: webLaunch.url });
          if (result?.success) {
            addLog(`>> [JARVIC] Uplink successfully launched: [OPEN ${webLaunch.name.toUpperCase()}](${webLaunch.url})`);
            speakVoice(`Opening ${webLaunch.name}, Sir. Uplink launched successfully.`);
          } else {
            addLog(`>> [WARNING] Could not open ${webLaunch.name}: ${result?.error ?? "Unknown error"}. Use this link: [CLICK TO OPEN ${webLaunch.name.toUpperCase()}](${webLaunch.url})`);
            speakVoice(`Could not open ${webLaunch.name}, Sir. Please use the link in the console.`);
          }
        } else {
          const opened = window.open(webLaunch.url, "_blank");
          if (opened) {
            addLog(`>> [JARVIC] Uplink successfully launched: [OPEN ${webLaunch.name.toUpperCase()}](${webLaunch.url})`);
            speakVoice(`Opening ${webLaunch.name}, Sir. Uplink launched successfully.`);
          } else {
            addLog(`>> [WARNING] Pop-up blocked. Use this link: [CLICK TO OPEN ${webLaunch.name.toUpperCase()}](${webLaunch.url})`);
            speakVoice(`Please use the link in the console, Sir.`);
          }
        }
      } catch (err) {
        addLog(`>> [WARNING] Direct window initialization failed. Click this link: [CLICK TO OPEN ${webLaunch.name.toUpperCase()}](${webLaunch.url})`);
        speakVoice(`Please use the link in the console, Sir.`);
      }
      playSound("success");
      return;
    }

    // Parse built-in visual console command commands
    const parts = query.toLowerCase().split(" ");
    const command = parts[0];

    if (command === "help") {
      addLog(`>> [JARVIC] Available commands:
 - help           : Display this diagnostic blueprint instructions
 - scan           : Scan the physical folder directory tree of the server
 - status         : Refresh system hardware parameters & thermals
 - clear          : Flush the terminal output memory buffers
 - tweak <theme>  : Tweak aesthetic matrix theme (cyan, amber, emerald, crimson, purple)
 - say <phrase>   : Synthesize custom phrase vocally using UK audio matrix
 - directive <t>  : Append a high-priority system directive to mainframe`);
      playSound("success");
      return;
    }

    if (command === "scan") {
      playSound("beep");
      addLog(">> [JARVIC] Deploying directory scanner recursively...");
      if (diagnostics && diagnostics.files) {
        const renderFiles = (filesList: any[], level = 0) => {
          filesList.forEach(f => {
            const indent = "  ".repeat(level);
            if (f.type === 'directory') {
              addLog(`>> ${indent}📁 ${f.name}/`);
              if (f.children) renderFiles(f.children, level + 1);
            } else {
              const sizeKB = (f.size / 1024).toFixed(1);
              addLog(`>> ${indent}📄 ${f.name} (${sizeKB} KB)`);
            }
          });
        };
        renderFiles(diagnostics.files);
        addLog(">> [JARVIC] Directory scan complete. All modules mapped.");
        playSound("success");
      } else {
        await fetchDiagnostics();
        addLog(">> [JARVIC] Telemetry retrieved. Try 'scan' again, Sir.");
      }
      return;
    }

    if (command === "status") {
      playSound("beep");
      await fetchDiagnostics();
      if (diagnostics) {
        addLog(`>> [DIAGNOSTICS] Status: ${diagnostics.status}
 - Platform       : ${diagnostics.platform} (${diagnostics.arch})
 - Cores          : ${diagnostics.cpu.cores} CPU(s)
 - Uptime         : ${diagnostics.uptime} seconds
 - System RAM     : ${(diagnostics.memory.total / (1024*1024*1024)).toFixed(1)} GB
 - Available RAM  : ${(diagnostics.memory.free / (1024*1024*1024)).toFixed(1)} GB`);
        playSound("success");
      }
      return;
    }

    if (command === "clear") {
      setSystemLogs([]);
      setMessages([]);
      addLog(">> Terminal memory flushed. Conversation history reset.");
      playSound("click");
      return;
    }

    if (command === "tweak") {
      const selectedTheme = parts[1] as ThemeName;
      if (selectedTheme && THEMES[selectedTheme]) {
        setThemeName(selectedTheme);
        addLog(`>> [SYSTEM] Theme reconfigured. HUD core tuned to ${selectedTheme.toUpperCase()} spectrum.`);
        playSound("success");
      } else {
        addLog(">> [WARNING] Spectrum error. Available grids: cyan, amber, emerald, crimson, purple.");
        playSound("warning");
      }
      return;
    }

    if (command === "say") {
      const sayPhrase = query.substring(4);
      if (sayPhrase) {
        addLog(`>> Vocally transmitting: "${sayPhrase}"`);
        speakVoice(sayPhrase);
      } else {
        addLog(">> Voice system requires parameters. Usage: say <phrase>");
      }
      return;
    }

    if (command === "directive") {
      const directiveContent = query.substring(10);
      if (directiveContent) {
        setNewDirectiveText(directiveContent);
        await handleAddDirective();
      } else {
        addLog(">> Directive requires contents. Usage: directive <instructions>");
      }
      return;
    }

    // Default: Forward query to server-side Gemini conversational AI route,
    // running the full tool-call loop until a plain-text answer comes back.
    setJarvicState("thinking");
    let workingMessages: Message[] = [...messages, { role: "user", content: query, timestamp: new Date().toISOString() }];
    setMessages(workingMessages);

    const MAX_TOOL_ROUNDS = 12;

    // The full `messages` state keeps growing for as long as the app stays
    // open (every dumpControls/screenshot result from every command all
    // session long), and there's no automatic reset. Sending all of it on
    // every round is what caused the "payload too large" -> HTML error page
    // -> "Unexpected token '<'" failure, and it'll keep recurring in long
    // sessions even with the server-side size bump, since history only ever
    // grows. Instead, only send a recent, bounded window to the API: keep
    // the last N messages in full, and replace any tool-result content
    // older than that with a short placeholder so the model still knows a
    // tool ran there, without resending its (possibly huge) payload.
    const RECENT_MESSAGES_KEPT_IN_FULL = 16;
    function buildApiPayload(all: Message[]): Message[] {
      const cutoff = Math.max(0, all.length - RECENT_MESSAGES_KEPT_IN_FULL);
      return all.map((m, i) => {
        if (i >= cutoff || m.role !== "tool" || !m.toolResults) return m;
        return {
          ...m,
          toolResults: m.toolResults.map((tr) => ({
            ...tr,
            result: typeof tr.result === "object" && tr.result !== null ? { ...(tr.result as Record<string, any>), data: "[older tool output omitted to keep request size bounded]" } : tr.result,
          })),
        };
      });
    }

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: buildApiPayload(workingMessages) })
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Subroutine communication error");
        }

        const botMessage: { role: "assistant"; content: string; toolCalls?: ToolCall[] } = await response.json();

        const assistantMsg: Message = {
          role: "assistant",
          content: botMessage.content,
          timestamp: new Date().toISOString(),
          toolCalls: botMessage.toolCalls,
        };
        workingMessages = [...workingMessages, assistantMsg];
        setMessages(workingMessages);

        if (botMessage.content) {
          addLog(`>> [JARVIC] ${botMessage.content}`);
          speakVoice(botMessage.content);
        }

        if (!botMessage.toolCalls || botMessage.toolCalls.length === 0) {
          playSound("success");
          setJarvicState("idle");
          return;
        }

        // Execute each requested tool call and collect structured results.
        const toolResults: ToolCallResult[] = [];
        for (const call of botMessage.toolCalls) {
          addLog(`>> [TOOL] Requesting ${call.name}(${JSON.stringify(call.args)})`);

          if (!window.jarvic) {
            toolResults.push({
              id: call.id,
              name: call.name,
              result: { success: false, error: "Desktop tools are unavailable — JARVIC is running in a plain browser tab, not the desktop app.", executionTimeMs: 0 },
            });
            addLog(`>> [WARNING] ${call.name} skipped — desktop bridge not present.`);
            continue;
          }

          if (isDestructiveTool(call.name)) {
            const proceed = window.confirm(
              `JARVIC wants to run "${call.name}" with arguments:\n${JSON.stringify(call.args, null, 2)}\n\nThis action is irreversible or high-impact. Allow it?`
            );
            if (!proceed) {
              toolResults.push({
                id: call.id,
                name: call.name,
                result: { success: false, error: "The user declined to confirm this action.", executionTimeMs: 0 },
              });
              addLog(`>> [SECURITY] ${call.name} declined by user.`);
              continue;
            }
          }

          try {
            const result = await window.jarvic.invokeTool(call.name, call.args);
            toolResults.push({ id: call.id, name: call.name, result });
            addLog(result.success ? `>> [TOOL] ${call.name} succeeded.` : `>> [TOOL] ${call.name} failed: ${result.error}`);
          } catch (err: any) {
            toolResults.push({
              id: call.id,
              name: call.name,
              result: { success: false, error: err?.message ?? String(err), executionTimeMs: 0 },
            });
          }
        }

        const toolMsg: Message = { role: "tool", content: "", timestamp: new Date().toISOString(), toolResults };
        workingMessages = [...workingMessages, toolMsg];
        setMessages(workingMessages);
      }

      addLog(">> [WARNING] Tool-call loop exceeded its safety limit and was stopped.");
      playSound("warning");
      setJarvicState("idle");
    } catch (error: any) {
      console.error(error);
      addLog(`>> [ERROR] Neural processing desync: ${error.message}`);
      setJarvicState("idle");
      playSound("warning");
    }
  };

  const handleSendMessageRef = useRef(handleSendMessage);
  const toggleVoiceCaptureRef = useRef(toggleVoiceCapture);
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
    toggleVoiceCaptureRef.current = toggleVoiceCapture;
  });

  // Listen for native Electron voice events.
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).jarvic?.onAudioEvent) {
      console.log("[JARVIC] Binding native audio event listener");
      const unsubscribe = (window as any).jarvic.onAudioEvent((data: { event: string; data?: any }) => {
        if (data.event === "speech-start") {
          addLog(">> [JARVIC] User speech detected. Interrupted vocal output.");
          // Stop native TTS
          try {
            (window as any).jarvic.invokeTool("system.tts.stop").catch(() => {});
          } catch {}
          // Stop browser fallback TTS
          try {
            window.speechSynthesis?.cancel();
          } catch {}
          setJarvicState("listening");
          setVoiceRecognitionActive(true);
        } else if (data.event === "partial-transcript") {
          const text = data.data ?? "";
          setLivePartial(text || null);
          setJarvicState("listening");
          setVoiceRecognitionActive(true);
        } else if (data.event === "final-transcript") {
          const text = data.data ?? "";
          setLivePartial(null);
          if (text.trim()) {
            handleSendMessageRef.current(text);
          }
        } else if (data.event === "voice-warning") {
          const message = data.data ?? "Unknown voice pipeline issue.";
          console.warn("[JARVIC] Voice warning:", message);
          addLog(`>> [WARNING] ${message}`);
          playSound("warning");
        }
      });
      return () => {
        console.log("[JARVIC] Unbinding native audio event listener");
        unsubscribe();
      };
    }
  }, []);

  // ── Floating mini-widget bridge ──────────────────────────────────────────
  // Listen for actions from the floating mini-widget (mic toggle, send text)
  useEffect(() => {
    if (typeof window === "undefined" || !window.jarvic?.onMiniEvent) return;
    const unsubscribe = window.jarvic.onMiniEvent((data) => {
      if (data.action === "mic-toggle") {
        toggleVoiceCaptureRef.current();
      } else if (data.action === "send-text" && typeof data.payload === "string") {
        handleSendMessageRef.current(data.payload);
      }
    });
    return unsubscribe;
  }, []);

  // Push state updates to the floating mini-widget
  useEffect(() => {
    window.jarvic?.notifyMiniWidget?.(jarvicState, livePartial ?? undefined);
  }, [jarvicState, livePartial]);

  // Synthesize short test vocal greet on first interaction
  const greetUser = () => {
    playSound("success");
    speakVoice("Good day, Sir. I am JARVIC, your mainframe computer assistant. All subsystems are online. How may I assist you today?");
  };

  return (
    <div className="w-full min-h-screen bg-[#020617] text-cyan-400 font-mono flex flex-col p-4 md:p-6 lg:p-8 overflow-x-hidden relative scanlines">
      {/* Holographic glowing grids */}
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none grid-overlay" />
      <div className="absolute inset-0 bg-gradient-to-t from-cyan-950/10 via-transparent to-transparent pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col z-10">
        
        {/* Sandbox Iframe Breakout Warning Banner */}
        {showSandboxBanner && (
          <div className="mb-4 bg-amber-950/40 border border-amber-500/30 p-3 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.05)] text-[11px] animate-pulse">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping shrink-0" style={{ backgroundColor: theme.primaryHex }} />
              <span>
                <strong>SYSTEM NOTICE:</strong> Standard browser preview sandboxing blocks voice-activated tabs, automatic popups, and advanced web services inside standard iframe containers.
              </span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  playSound("success");
                  window.open(window.location.href, "_blank");
                }}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded text-[10px] tracking-wider uppercase transition-all flex items-center gap-1.5 cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.3)]"
              >
                <span>Breakout to Full Tab ↗</span>
              </button>
              <button
                onClick={() => {
                  playSound("click");
                  setShowSandboxBanner(false);
                }}
                className="px-2 py-1 bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-400 rounded text-[10px] cursor-pointer transition-all"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Header Grid */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-cyan-900/30 pb-4 mb-6 gap-4">
          <div className="flex flex-col">
            <span className="text-[9px] md:text-[10px] tracking-[0.4em] text-cyan-700 block mb-1.5 font-hud">INTELLIGENT COMPUTING ENVIRONMENT</span>
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tighter font-display metallic-text">
                JARVIC <span className="text-cyan-700/60 font-normal text-lg md:text-xl">v4.2.0</span>
              </h1>
              {/* Dynamic Theme color indicator */}
              <div className="flex gap-1 items-center pb-1">
                {(["cyan", "amber", "emerald", "crimson", "purple"] as ThemeName[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setThemeName(t);
                      playSound("click");
                      addLog(`>> [SYSTEM] Mainframe HUD color tuned to ${t.toUpperCase()}.`);
                    }}
                    className={`w-3 h-3 rounded-full border transition-all ${
                      themeName === t ? "scale-125 border-white shadow-md" : "border-transparent opacity-60 hover:opacity-100"
                    }`}
                    style={{ backgroundColor: THEMES[t].primaryHex }}
                    title={`Set grid color to ${t}`}
                  />
                ))}
              </div>
            </div>
          </div>
          
          <div className="text-left md:text-right flex flex-col font-mono text-[11px] md:text-xs">
            <div className="flex items-center md:justify-end gap-2 text-cyan-400">
              <span>STATUS:</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1.5 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
                OPTIMAL
              </span>
            </div>
            <span className="opacity-50 mt-1 tracking-wider uppercase text-[10px] md:text-[11px] font-hud">
              {timeStr || "09 JUL 2026 | UTC"}
            </span>
          </div>
        </header>

        {/* Core Main HUD Content Grid */}
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
          
          {/* LEFT WIDGET COLUMN (span 3) */}
          <div className="lg:col-span-3 flex flex-col gap-5">
            
            {/* Diagnostics Stats card */}
            <div className="glass-panel rounded-xl p-5 relative overflow-hidden corner-brackets">
              <h2 className="text-[10px] uppercase tracking-widest text-cyan-600 mb-4 flex items-center justify-between font-hud">
                <span>Hardware Metrics</span>
                <button 
                  onClick={fetchDiagnostics} 
                  disabled={loadingDiagnostics}
                  className="hover:text-cyan-400 transition-colors cursor-pointer group"
                  title="Query Telemetry Now"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDiagnostics ? 'animate-spin' : 'group-hover:rotate-180'} transition-transform duration-500`} />
                </button>
              </h2>
              
              <div className="space-y-4 font-mono text-xs">
                {/* Neural core cpu usage simulation */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1.5 text-slate-300">
                    <span className="tracking-wider">NEURAL CORE</span>
                    <span className="font-semibold">{diagnostics ? "14%" : "12%"}</span>
                  </div>
                  <div className="h-1.5 bg-slate-900/80 rounded-full overflow-hidden border border-slate-800/50">
                    <motion.div 
                      className="h-full rounded-full"
                      style={{ backgroundColor: theme.primaryHex }}
                      animate={{ width: diagnostics ? "14%" : "12%" }}
                      transition={{ duration: 1 }}
                    />
                  </div>
                </div>

                {/* Simulated/Real synaptics memory usage */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1.5 text-slate-300">
                    <span className="tracking-wider">SYNAPTIC RAM</span>
                    <span className="font-semibold">
                      {diagnostics 
                        ? `${(diagnostics.memory.processUsed / (1024*1024)).toFixed(1)} MB` 
                        : "4.2 TB / 16 TB"}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-900/80 rounded-full overflow-hidden border border-slate-800/50">
                    <motion.div 
                      className="h-full rounded-full"
                      style={{ backgroundColor: theme.primaryHex }}
                      animate={{ width: diagnostics ? "35%" : "26%" }}
                      transition={{ duration: 1 }}
                    />
                  </div>
                </div>

                {/* Thermal stats */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1.5 text-slate-300">
                    <span className="tracking-wider">THERMAL PSI</span>
                    <span className="text-emerald-400 font-semibold">32°C</span>
                  </div>
                  <div className="h-1.5 bg-slate-900/80 rounded-full overflow-hidden border border-slate-800/50">
                    <div className="h-full bg-emerald-500 w-[32%] rounded-full" />
                  </div>
                </div>
              </div>
            </div>

            {/* Directives / Active protocols card */}
            <div className="glass-panel rounded-xl p-5 flex-1 flex flex-col justify-between relative overflow-hidden corner-brackets">
              <div>
                <h2 className="text-[10px] uppercase tracking-widest text-cyan-600 mb-4 flex justify-between items-center font-hud">
                  <span>Active Directives</span>
                  <span className="text-slate-500 font-mono text-[9px]">{directives.length} RUNNING</span>
                </h2>
                
                {/* Scrollable list of active protocols */}
                <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1 terminal-scroll">
                  {directives.length === 0 ? (
                    <p className="text-xs text-slate-500 italic py-2">No custom system directives registered, Sir.</p>
                  ) : (
                    directives.map((d) => (
                      <div 
                        key={d.id} 
                        className="group flex items-start justify-between gap-2 p-2 bg-slate-900/30 rounded border border-slate-800/40 hover:border-slate-700/40 transition-all"
                      >
                        <div className="flex gap-2">
                          <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: theme.primaryHex, boxShadow: `0 0 6px ${theme.primaryHex}` }} />
                          <span className="text-[11px] text-slate-300 leading-normal">{d.content}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteDirective(d.id, d.content)}
                          className="text-slate-600 hover:text-red-400 p-0.5 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          title="Purge Directive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Add Custom Directive visual input form */}
              <form onSubmit={handleAddDirective} className="mt-4 pt-4 border-t border-slate-800/50 flex gap-2">
                <input
                  type="text"
                  placeholder="New core directive..."
                  value={newDirectiveText}
                  onChange={(e) => setNewDirectiveText(e.target.value)}
                  className="flex-1 bg-slate-900/60 border border-slate-800/50 rounded px-2.5 py-1.5 text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 focus:shadow-[0_0_10px_rgba(6,182,212,0.1)] transition-all"
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  type="submit"
                  className="p-1.5 rounded bg-cyan-950/60 hover:bg-cyan-900/50 border border-cyan-800/50 text-cyan-400 transition-all cursor-pointer flex items-center justify-center hover:shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                  title="Inject Protocol"
                >
                  <Plus className="w-4 h-4" />
                </motion.button>
              </form>
            </div>

          </div>

          {/* CENTER CORE INTERFACE PANEL (span 6) */}
          <div className="lg:col-span-6 flex flex-col justify-between">
            {/* Large HUD visual circle module */}
            <div className="flex-1 flex flex-col items-center justify-center relative p-4 min-h-[380px]">
              {/* Glowing Interactive Uplink Bridge for sandboxed environments */}
              {activeUplink && (
                <div className="absolute inset-0 bg-slate-950/95 border border-cyan-500/50 rounded-2xl p-6 flex flex-col items-center justify-center z-40 backdrop-blur-md corner-brackets">
                  <div className="w-16 h-16 rounded-full bg-cyan-950/60 border border-cyan-500 flex items-center justify-center mb-4 shadow-[0_0_20px_rgba(6,182,212,0.4)] relative">
                    <Scan className="w-8 h-8 text-cyan-400 animate-pulse" />
                    <div className="absolute inset-0 border border-cyan-400/30 rounded-full animate-ping" />
                  </div>
                  
                  <span className="text-[10px] tracking-[0.3em] text-cyan-500 font-mono mb-2 uppercase font-hud">Uplink Telemetry Detected</span>
                  <h3 className="text-sm font-semibold text-white font-mono text-center mb-3 tracking-wider">
                    BRIDGE PATH: <span className="text-cyan-400">{activeUplink.name.toUpperCase()}</span>
                  </h3>
                  
                  <p className="text-[11px] text-slate-400 font-mono text-center max-w-sm mb-6 leading-relaxed">
                    Browser security policies require manual confirmation for cross-origin frames. Click below to establish the connection directly.
                  </p>

                  <div className="flex gap-4 w-full justify-center">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        playSound("success");
                        window.open(activeUplink.url, "_blank");
                        setActiveUplink(null);
                      }}
                      className="px-5 py-2.5 bg-cyan-500 text-black font-semibold rounded-lg font-mono text-xs tracking-wider uppercase transition-all flex items-center gap-2 cursor-pointer shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:bg-cyan-400"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Establish Uplink</span>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        playSound("click");
                        setActiveUplink(null);
                      }}
                      className="px-4 py-2.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-400 font-mono text-xs rounded-lg transition-all cursor-pointer"
                    >
                      Dismiss
                    </motion.button>
                  </div>
                </div>
              )}

              {isCameraActive ? (
                <div className="w-full h-full max-w-md flex flex-col items-center justify-center bg-slate-950/80 border border-red-500/30 rounded-2xl p-4 shadow-[0_0_25px_rgba(239,68,68,0.15)] relative overflow-hidden corner-brackets">
                  {/* Blinking recording/active state dot */}
                  <div className="absolute top-4 left-4 flex items-center gap-2 z-10 font-mono text-[10px] text-red-500 bg-black/60 px-2 py-1 rounded-md border border-red-900/50">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping absolute left-[6px]" />
                    <span>LENS ACTIVE // FEED ONLINE</span>
                  </div>

                  {/* Resolution telemetry label */}
                  <div className="absolute top-4 right-4 z-10 font-mono text-[9px] text-cyan-400/80 bg-black/60 px-2 py-1 rounded-md border border-cyan-900/50">
                    <span>640x480px // RGB // 30 FPS</span>
                  </div>

                  {/* Webcam video element with futuristic overlay scanline & target reticle */}
                  <div className="w-full flex-1 aspect-video rounded-lg overflow-hidden border border-slate-800 relative bg-black/40">
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      className="w-full h-full object-cover grayscale opacity-90 contrast-125 saturate-50"
                    />
                    
                    {/* Futuristic Crosshairs */}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-12 h-12 border border-red-500/40 rounded-full animate-spin-slow" />
                      <div className="absolute w-20 h-20 border border-cyan-500/20 rounded-full" />
                      <div className="absolute w-1.5 h-1.5 bg-red-500/80 rounded-full" />
                      
                      {/* Target corner marks */}
                      <div className="absolute top-4 left-4 w-4 h-4 border-t-2 border-l-2 border-cyan-500/50" />
                      <div className="absolute top-4 right-4 w-4 h-4 border-t-2 border-r-2 border-cyan-500/50" />
                      <div className="absolute bottom-4 left-4 w-4 h-4 border-b-2 border-l-2 border-cyan-500/50" />
                      <div className="absolute bottom-4 right-4 w-4 h-4 border-b-2 border-r-2 border-cyan-500/50" />
                    </div>

                    {/* Laser scan animation overlay */}
                    <div className="absolute inset-x-0 h-[2px] bg-red-500/60 shadow-[0_0_10px_#f43f5e] top-0 animate-scan pointer-events-none" />
                    
                    {/* Scanlines layer */}
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,_rgba(0,0,0,0.25)_50%),_linear-gradient(90deg,_rgba(255,0,0,0.06),_rgba(0,255,0,0.02),_rgba(0,0,255,0.06))] bg-[size:100%_4px,_6px_100%] pointer-events-none opacity-30" />
                  </div>

                  <div className="mt-4 flex gap-3 z-10">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={stopCamera}
                      className="px-4 py-2 bg-red-950/40 border border-red-500/50 hover:bg-red-900/30 text-red-400 font-mono text-[10px] tracking-widest rounded-lg flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_10px_rgba(239,68,68,0.1)]"
                    >
                      <VideoOff className="w-3.5 h-3.5" />
                      <span>POWER DOWN OPTICS</span>
                    </motion.button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center">
                  <CoreReactor 
                    state={jarvicState} 
                    theme={themeName} 
                    themeHex={theme.primaryHex}
                    onClick={toggleVoiceCapture}
                  />
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={startCamera}
                    className="mt-6 px-4 py-2 bg-cyan-950/30 border border-cyan-800/80 hover:bg-cyan-900/30 hover:border-cyan-500 text-cyan-400 font-mono text-[10px] tracking-widest rounded-lg flex items-center gap-2 cursor-pointer transition-all shadow-[0_0_15px_rgba(6,182,212,0.1)]"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>DEPLOY OPTICAL LENS</span>
                  </motion.button>
                </div>
              )}
            </div>
            
            {/* Audio waveform / signal control helper bar */}
            <div className="glass-panel rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-slate-900/60 border border-slate-800/60">
                  <Volume2 className="w-5 h-5" style={{ color: theme.primaryHex }} />
                </div>
                <div>
                  <h4 className="text-[11px] uppercase tracking-wider text-slate-400 font-hud">Audio Synth Matrix</h4>
                  <p className="text-[10px] text-slate-500">British Voice synthesis enabled.</p>
                </div>
              </div>

              {/* Control triggers */}
              <div className="flex items-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    setIsMuted(!isMuted);
                    playSound("click");
                  }}
                  className={`px-3 py-1.5 border rounded text-[10px] font-mono tracking-widest flex items-center gap-2 cursor-pointer transition-all ${
                    isMuted 
                      ? 'border-red-900/80 bg-red-950/20 text-red-400' 
                      : 'border-slate-800/60 hover:border-slate-700/60 text-slate-300'
                  }`}
                >
                  {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  <span>{isMuted ? "MUTED" : "UNMUTED"}</span>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={toggleVoiceCapture}
                  className={`px-3 py-1.5 border rounded text-[10px] font-mono tracking-widest flex items-center gap-2 cursor-pointer transition-all ${
                    voiceRecognitionActive
                      ? 'border-amber-500 bg-amber-950/30 text-amber-400 animate-pulse'
                      : 'border-slate-800/60 hover:border-slate-700/60 text-slate-300'
                  }`}
                >
                  {voiceRecognitionActive ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  <span>{voiceRecognitionActive ? "LISTENING" : "CAPTURE VOICE"}</span>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={greetUser}
                  className="px-3 py-1.5 border border-cyan-800/80 bg-cyan-950/20 hover:bg-cyan-900/20 text-cyan-400 rounded text-[10px] font-mono tracking-widest flex items-center gap-1.5 cursor-pointer transition-all hover:shadow-[0_0_10px_rgba(6,182,212,0.15)]"
                  title="Trigger welcome greeting synthesize"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>TEST SPEECH</span>
                </motion.button>
              </div>
            </div>
           </div>

           {/* RIGHT WIDGET COLUMN (span 3) */}
          <div className="lg:col-span-3 flex flex-col gap-5">
             
            {/* Advanced Sub-System Controller (Apps, Files, and Telemetry tabs) */}
            <div className="glass-panel rounded-xl p-4 relative overflow-hidden flex-1 flex flex-col justify-between min-h-[380px] corner-brackets">
               
              {/* Card Header & cybernetic selector buttons */}
              <div>
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5 mb-3.5">
                  <h2 className="text-[10px] uppercase tracking-widest text-cyan-500 font-mono font-semibold font-hud">Sub-System Grid</h2>
                  <div className="flex gap-1 bg-slate-900/60 p-0.5 rounded border border-slate-800/50">
                    {(["apps", "env"] as const).map((tab) => (
                      <motion.button
                        key={tab}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          setRightPanelTab(tab);
                          playSound("click");
                        }}
                        className={`px-2 py-0.5 rounded text-[9px] font-mono tracking-wider uppercase transition-all cursor-pointer ${
                          rightPanelTab === tab 
                            ? "bg-cyan-500/10 border border-cyan-500/40 text-cyan-400 font-semibold" 
                            : "border border-transparent text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {tab}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* TAB 1: VIRTUAL APPLICATION LAUNCHER */}
                {rightPanelTab === "apps" && (
                  <div className="space-y-3 animate-fade-in">
                    <p className="text-[10px] font-mono text-slate-500 leading-normal mb-2">
                      Launch virtual mainframe subsystems and web interface bridges:
                    </p>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          playSound("beep");
                          setActiveUplink({ name: "Netflix Stream", url: "https://netflix.com" });
                          addLog(">> [JARVIC] Staging entertainment uplink stream to Netflix.");
                          speakVoice("Netflix stream linkage staged, Sir.");
                        }}
                        className="p-2 bg-slate-900/30 border border-slate-800/60 hover:border-cyan-500/40 hover:bg-cyan-950/10 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <AppWindow className="w-5 h-5 text-cyan-500 mb-1 group-hover:text-cyan-400 group-hover:scale-105 transition-all" />
                        <span className="text-[10px] font-mono text-slate-300 group-hover:text-cyan-300">Netflix</span>
                        <span className="text-[8px] font-mono text-slate-500 mt-0.5">ENTERTAINMENT</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          if (isCameraActive) {
                            stopCamera();
                          } else {
                            startCamera();
                          }
                        }}
                        className="p-2 bg-slate-900/30 border border-slate-800/60 hover:border-cyan-500/40 hover:bg-cyan-950/10 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <Video className={`w-5 h-5 mb-1 group-hover:scale-105 transition-all ${isCameraActive ? 'text-red-500 animate-pulse' : 'text-cyan-500'}`} />
                        <span className="text-[10px] font-mono text-slate-300 group-hover:text-cyan-300">Optical Lens</span>
                        <span className={`text-[8px] font-mono mt-0.5 ${isCameraActive ? 'text-red-400 font-semibold' : 'text-slate-500'}`}>
                          {isCameraActive ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          playSound("click");
                          addLog(">> [JARVIC] To search YouTube, speak: \"search youtube for [your query]\" or type \"youtube [query]\" in the terminal.");
                          speakVoice("Sir, speak search youtube followed by your query, or enter it directly in the console.");
                        }}
                        className="p-2 bg-slate-900/30 border border-slate-800/60 hover:border-cyan-500/40 hover:bg-cyan-950/10 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <Search className="w-5 h-5 text-cyan-500 mb-1 group-hover:text-cyan-400 group-hover:scale-105 transition-all" />
                        <span className="text-[10px] font-mono text-slate-300 group-hover:text-cyan-300">YouTube search</span>
                        <span className="text-[8px] font-mono text-slate-500 mt-0.5">AURAL / COMMAND</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          playSound("beep");
                          setActiveUplink({ name: "ChatGPT Portal", url: "https://chatgpt.com" });
                          addLog(">> [JARVIC] Staging secure manual uplink to OpenAI ChatGPT portal.");
                          speakVoice("ChatGPT uplink staged, Sir.");
                        }}
                        className="p-2 bg-slate-900/30 border border-slate-800/60 hover:border-cyan-500/40 hover:bg-cyan-950/10 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <AppWindow className="w-5 h-5 text-cyan-500 mb-1 group-hover:text-cyan-400 group-hover:scale-105 transition-all" />
                        <span className="text-[10px] font-mono text-slate-300 group-hover:text-cyan-300">ChatGPT Core</span>
                        <span className="text-[8px] font-mono text-slate-500 mt-0.5">EXTERNAL CORE</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          playSound("beep");
                          setActiveUplink({ name: "Google Mainframe", url: "https://google.com" });
                          addLog(">> [JARVIC] Staging search linkage to Google Search.");
                        }}
                        className="p-1.5 bg-slate-900/30 border border-slate-800/50 hover:border-cyan-500/30 hover:bg-cyan-950/5 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <span className="text-[9px] font-mono text-slate-400 group-hover:text-cyan-300">Google Link</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          playSound("beep");
                          setActiveUplink({ name: "Gmail Server", url: "https://mail.google.com" });
                          addLog(">> [JARVIC] Staging uplink stream to Gmail communications center.");
                        }}
                        className="p-1.5 bg-slate-900/30 border border-slate-800/50 hover:border-cyan-500/30 hover:bg-cyan-950/5 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <span className="text-[9px] font-mono text-slate-400 group-hover:text-cyan-300">Gmail Communications</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          playSound("beep");
                          setActiveUplink({ name: "GitHub Source", url: "https://github.com" });
                        }}
                        className="p-1.5 bg-slate-900/30 border border-slate-800/50 hover:border-cyan-500/30 hover:bg-cyan-950/5 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <span className="text-[9px] font-mono text-slate-400 group-hover:text-cyan-300">GitHub Portal</span>
                      </motion.button>

                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          playSound("click");
                          fetchDiagnostics();
                        }}
                        className="p-1.5 bg-slate-900/30 border border-slate-800/50 hover:border-cyan-500/30 hover:bg-cyan-950/5 rounded flex flex-col items-center justify-center text-center transition-all group cursor-pointer"
                      >
                        <span className="text-[9px] font-mono text-slate-400 group-hover:text-cyan-300">PC Diagnostics</span>
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* TAB 3: ENVIRONMENT TELEMETRY DETAILS */}
                {rightPanelTab === "env" && (
                  <div className="space-y-4 font-mono animate-fade-in">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-cyan-700 uppercase tracking-widest font-hud">Location</span>
                      <span className="text-xs text-slate-200 font-medium flex items-center gap-1.5 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-cyan-500" />
                        NEW YORK, USA
                      </span>
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-[10px] text-cyan-700 uppercase tracking-widest font-hud">Uplink Connect</span>
                      <span className="text-xs text-slate-200 font-medium flex items-center gap-1.5 mt-0.5">
                        <Wifi className="w-3.5 h-3.5 text-cyan-500" />
                        STARK_TOWER_5G_SECURE
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="text-[10px] text-cyan-700 uppercase tracking-widest font-hud">Host System</span>
                      <span className="text-xs text-slate-200 font-medium flex items-center gap-1.5 mt-0.5">
                        <Settings className="w-3.5 h-3.5 text-cyan-500" />
                        {diagnostics ? `${diagnostics.platform.toUpperCase()} (${diagnostics.arch})` : "LINUX CORE 64BIT"}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="text-[10px] text-cyan-700 uppercase tracking-widest font-hud">Engine Runtime</span>
                      <span className="text-xs text-slate-200 font-medium flex items-center gap-1.5 mt-0.5">
                        <FolderOpen className="w-3.5 h-3.5 text-cyan-500" />
                        {diagnostics ? `${diagnostics.nodeVersion}` : "NODEJS v22.14"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Holographic HUD aesthetic details */}
              <div className="mt-4 pt-4 border-t border-slate-800/60">
                <div className="flex justify-between items-center text-[10px] text-slate-500">
                  <span className="tracking-wider">CRYPTO NET</span>
                  <span className="text-emerald-500 font-semibold tracking-wider">SECURED</span>
                </div>
                <div className="mt-2 h-1 bg-slate-900/80 rounded-full overflow-hidden border border-slate-800/50">
                  <div className="h-full bg-cyan-400 w-3/4 animate-pulse rounded-full" style={{ backgroundColor: theme.primaryHex }} />
                </div>
              </div>
            </div>

            {/* Quick calibration settings controls */}
            <div className="glass-panel rounded-xl p-5">
              <h2 className="text-[10px] uppercase tracking-widest text-cyan-600 mb-3 font-hud">Recent Logs</h2>
              <div className="text-[10px] text-cyan-400/70 leading-relaxed space-y-2 max-h-[140px] overflow-y-auto pr-1 terminal-scroll">
                <p>&gt;<span className="text-slate-500"> [03:19]</span> System calibration complete.</p>
                <p>&gt;<span className="text-slate-500"> [03:18]</span> Core energy reserves at 100%.</p>
                <p>&gt;<span className="text-slate-500"> [03:17]</span> Speech synth module aligned.</p>
                <p>&gt;<span className="text-slate-500"> [03:15]</span> Handshake established successfully.</p>
              </div>
            </div>

          </div>

        </main>

        {/* FULL WIDTH TERMINAL / INTERFACE CONSOLE AT THE BOTTOM */}
        <div className="h-[280px] w-full min-h-[220px]">
          <TerminalView 
            messages={messages}
            onSendMessage={handleSendMessage}
            systemLogs={systemLogs}
            onClearLogs={() => {
              setSystemLogs([]);
              playSound("click");
            }}
            themeHex={theme.primaryHex}
          />
        </div>

        {/* Aesthetic credit rail */}
        <footer className="mt-4 py-2 text-center text-[9px] font-mono text-slate-600 tracking-[0.2em] uppercase font-hud">
          JARVIC MAIN SYSTEM ENVIRONMENT // DESIGNED FOR THE SECTOR ELEVEN PLATFORM // ALL SUBSYSTEMS STABLE
        </footer>

      </div>
    </div>
  );
}
