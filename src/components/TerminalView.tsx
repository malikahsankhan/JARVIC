import React, { useState, useRef, useEffect } from "react";
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
    <div className="flex flex-col h-full bg-[#030712]/95 border border-slate-800/80 rounded-xl overflow-hidden shadow-2xl relative">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 font-mono text-[11px] tracking-wider text-slate-400">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-cyan-500" />
          <span>COGNITIVE_TERMINAL_V4.2.0</span>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onClearLogs}
            className="hover:text-slate-200 transition-colors flex items-center gap-1.5"
            title="Clear Console Output"
          >
            <RefreshCw className="w-3 h-3" />
            <span>RESET</span>
          </button>
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          </div>
        </div>
      </div>

      {/* Terminal Output Stream */}
      <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-3 scrollbar-thin select-text">
        {/* Welcome Banner */}
        <div className="border-l-2 pl-3 border-cyan-500/50 text-slate-400 py-1 mb-4">
          <p className="text-cyan-400 font-semibold tracking-wider">JARVIC SYSTEM INTERFACE ONLINE</p>
          <p className="text-[10px] opacity-70">Initialize handshake... SECURE SOCKET SHELL v4.2</p>
          <p className="text-[10px] opacity-70">Type commands or conversational directives directly below.</p>
          <p className="text-[10px] text-amber-500/80 mt-1">Try commands: <span className="underline">help</span>, <span className="underline">status</span>, <span className="underline">scan</span>, <span className="underline">clear</span></p>
        </div>

        {/* Logs and conversations chronologically mixed or visual representation */}
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

            return (
              <div key={`log-${idx}`} className="leading-relaxed whitespace-pre-wrap text-slate-300">
                {content}
              </div>
            );
          })}
        </div>
        <div ref={logsEndRef} />
      </div>

      {/* Input prompt area */}
      <form onSubmit={handleSubmit} className="border-t border-slate-800 bg-slate-900/60 p-3 flex gap-2 items-center">
        <span className="text-[11px] font-mono text-cyan-400 select-none pl-1">
          {currentDir}$
        </span>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter command or speak to JARVIC..."
          className="flex-1 bg-transparent border-0 outline-none focus:ring-0 text-xs font-mono text-cyan-300 placeholder-slate-600 tracking-wide"
          style={{ caretColor: themeHex }}
          id="terminal-input"
        />
        <button
          type="submit"
          disabled={!inputValue.trim()}
          className="p-1.5 rounded bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/50 disabled:opacity-30 disabled:hover:bg-transparent text-cyan-400 transition-all flex items-center justify-center cursor-pointer"
          id="btn-send-command"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
