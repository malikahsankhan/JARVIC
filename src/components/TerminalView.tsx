import React, { useState, useRef, useEffect } from "react";
import { motion } from "motion/react";
import { Message, ThemeName } from "../types";
import { Terminal, Send, ShieldAlert, Cpu, HardDrive, RefreshCw } from "lucide-react";

interface TerminalViewProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  systemLogs: string[];
  onClearLogs: () => void;
  themeHex: string;
}

export default function TerminalView({
  messages,
  onSendMessage,
  systemLogs,
  onClearLogs,
  themeHex
}: TerminalViewProps) {
  const [inputValue, setInputValue] = useState("");
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [currentDir, setCurrentDir] = useState("JARVIC_CORE:\\");

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [systemLogs, messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    onSendMessage(inputValue);
    setInputValue("");
  };

  return (
    <div className="flex flex-col h-full glass-panel rounded-xl overflow-hidden relative corner-brackets">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-800/80 font-mono text-[11px] tracking-wider text-slate-400">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" style={{ color: themeHex }} />
          <span className="text-slate-300">COGNITIVE_TERMINAL_V4.2.0</span>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onClearLogs}
            className="hover:text-slate-200 transition-colors flex items-center gap-1.5 group"
            title="Clear Console Output"
          >
            <RefreshCw className="w-3 h-3 group-hover:rotate-180 transition-transform duration-500" />
            <span>RESET</span>
          </button>
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60 hover:bg-red-500 transition-colors" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60 hover:bg-yellow-500 transition-colors" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60 hover:bg-green-500 transition-colors" />
          </div>
        </div>
      </div>

      {/* Terminal Output Stream */}
      <div className="flex-1 p-4 font-mono text-xs overflow-y-auto terminal-scroll relative">
        {/* Scan line effect */}
        <div className="scan-laser opacity-30" />
        
        {/* Welcome Banner */}
        <div className="border-l-2 pl-3 border-cyan-500/50 text-slate-400 py-1 mb-4 relative">
          <div className="absolute inset-0 bg-cyan-500/5 pointer-events-none" />
          <p className="text-cyan-400 font-semibold tracking-wider font-hud">JARVIC SYSTEM INTERFACE ONLINE</p>
          <p className="text-[10px] opacity-70">Initialize handshake... SECURE SOCKET SHELL v4.2</p>
          <p className="text-[10px] opacity-70">Type commands or conversational directives directly below.</p>
          <p className="text-[10px] text-amber-500/80 mt-1">Try commands: <span className="underline cursor-pointer hover:text-amber-400">help</span>, <span className="underline cursor-pointer hover:text-amber-400">status</span>, <span className="underline cursor-pointer hover:text-amber-400">scan</span>, <span className="underline cursor-pointer hover:text-amber-400">clear</span></p>
        </div>

        {/* Logs and conversations */}
        <div className="space-y-2.5">
          {systemLogs.map((log, idx) => {
            // Simple markdown-link parsing: [Label](URL)
            const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
            const parts = [];
            let lastIndex = 0;
            let match;

            while ((match = regex.exec(log)) !== null) {
              const matchIndex = match.index;
              if (matchIndex > lastIndex) {
                parts.push(log.substring(lastIndex, matchIndex));
              }
              const label = match[1];
              const url = match[2];
              parts.push(
                <a
                  key={matchIndex}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  className="mx-1 px-2.5 py-1 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 rounded font-semibold text-cyan-300 hover:text-white inline-flex items-center gap-1 shadow-[0_0_10px_rgba(6,182,212,0.2)] transition-all cursor-pointer"
                >
                  {label} ↗
                </a>
              );
              lastIndex = regex.lastIndex;
            }

            if (lastIndex < log.length) {
              parts.push(log.substring(lastIndex));
            }

            const content = parts.length > 0 ? parts : log;

            // Determine log type for styling
            const isError = log.includes("[ERROR]") || log.includes("[WARNING]");
            const isSystem = log.includes("[SYSTEM]");
            const isJarvic = log.includes("[JARVIC]");
            const isTool = log.includes("[TOOL]");

            return (
              <div 
                key={`log-${idx}`} 
                className={`leading-relaxed whitespace-pre-wrap ${
                  isError ? "text-red-400" :
                  isSystem ? "text-slate-500" :
                  isJarvic ? "text-cyan-300" :
                  isTool ? "text-amber-300" :
                  "text-slate-300"
                }`}
              >
                {content}
              </div>
            );
          })}
        </div>
        <div ref={logsEndRef} />
      </div>

      {/* Input prompt area */}
      <form onSubmit={handleSubmit} className="border-t border-slate-800/80 bg-slate-900/80 p-3 flex gap-2 items-center terminal-glow">
        <span className="text-[11px] font-mono text-cyan-400 select-none pl-1 tracking-wider">
          {currentDir}$
        </span>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter command or speak to JARVIC..."
          className="flex-1 bg-transparent border-0 outline-none focus:ring-0 text-xs font-mono text-cyan-200 placeholder-slate-600 tracking-wide"
          style={{ caretColor: themeHex }}
          id="terminal-input"
        />
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="submit"
          disabled={!inputValue.trim()}
          className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/50 disabled:opacity-30 disabled:hover:bg-transparent text-cyan-400 transition-all flex items-center justify-center cursor-pointer hover:shadow-[0_0_10px_rgba(6,182,212,0.2)]"
          id="btn-send-command"
        >
          <Send className="w-3.5 h-3.5" />
        </motion.button>
      </form>
    </div>
  );
}
