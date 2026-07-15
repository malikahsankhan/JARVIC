import React from "react";
import { motion } from "motion/react";
import { JarvicState, ThemeName } from "../types";
import { Cpu, Activity, ShieldAlert, Wifi } from "lucide-react";

interface CoreReactorProps {
  state: JarvicState;
  theme: ThemeName;
  themeHex: string;
  onClick: () => void;
}

export default function CoreReactor({ state, theme, themeHex, onClick }: CoreReactorProps) {
  // Configs based on state
  const stateLabels = {
    idle: "ONLINE / MONITORING",
    listening: "AURAL SCAN ACTIVE",
    thinking: "COGNITIVE SYNC",
    speaking: "VOCAL TRANSMISSION",
  };

  const stateColors: Record<JarvicState, string> = {
    idle: "text-cyan-400 border-cyan-500",
    listening: "text-amber-400 border-amber-500",
    thinking: "text-purple-400 border-purple-500",
    speaking: "text-emerald-400 border-emerald-500",
  };

  // Get glow colors based on theme
  const getGlowShadow = () => {
    switch (state) {
      case "listening": return `0 0 30px rgba(245, 158, 11, 0.4)`;
      case "thinking": return `0 0 30px rgba(168, 85, 247, 0.4)`;
      case "speaking": return `0 0 30px rgba(16, 185, 129, 0.4)`;
      default:
        // Use theme base colors
        if (theme === "amber") return "0 0 30px rgba(245, 158, 11, 0.3)";
        if (theme === "emerald") return "0 0 30px rgba(16, 185, 129, 0.3)";
        if (theme === "crimson") return "0 0 30px rgba(239, 68, 68, 0.3)";
        if (theme === "purple") return "0 0 30px rgba(168, 85, 247, 0.3)";
        return "0 0 30px rgba(6, 182, 212, 0.3)";
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-950/40 rounded-2xl border border-slate-800/80 shadow-2xl relative overflow-hidden h-full">
      {/* Holographic matrix background accent */}
      <div className="absolute inset-0 grid-overlay opacity-20 pointer-events-none" />

      {/* Top status rail */}
      <div className="w-full flex justify-between items-center px-2 mb-6 text-[10px] font-mono tracking-widest text-slate-500">
        <div className="flex items-center gap-1.5">
          <Wifi className="w-3.5 h-3.5 animate-pulse text-emerald-500" />
          <span>NET_BRIDGE: ONLINE</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-cyan-500" />
          <span>SUB_SYS: STABLE</span>
        </div>
      </div>

      {/* Main Core Visual Area */}
      <div className="relative w-64 h-64 flex items-center justify-center cursor-pointer group" onClick={onClick}>
        {/* Glow halo behind */}
        <div 
          className="absolute w-56 h-56 rounded-full transition-all duration-700 pointer-events-none"
          style={{ boxShadow: getGlowShadow() }}
        />

        {/* Rotator Ring 1: Outer Tech Grid (Counter-Clockwise) */}
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ repeat: Infinity, duration: state === "thinking" ? 6 : 20, ease: "linear" }}
          className="absolute w-60 h-60 border-2 border-dashed rounded-full opacity-30"
          style={{ borderColor: themeHex }}
        />

        {/* Rotator Ring 2: Diagnostic Dashes (Clockwise) */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: state === "thinking" ? 4 : 12, ease: "linear" }}
          className="absolute w-52 h-52 border border-dotted rounded-full opacity-40"
          style={{ borderColor: themeHex, borderWidth: '2px' }}
        />

        {/* Rotator Ring 3: Segmented Core Guard */}
        <motion.svg
          animate={{ rotate: -180 }}
          transition={{ repeat: Infinity, duration: state === "thinking" ? 8 : 16, ease: "linear" }}
          className="absolute w-44 h-44 opacity-65"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke={themeHex}
            strokeWidth="2"
            fill="none"
            strokeDasharray="40 10 20 15 5 10"
          />
        </motion.svg>

        {/* Inner soundwave ring when speaking */}
        {state === "speaking" && (
          <motion.div
            animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0.1, 0.6] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
            className="absolute w-36 h-36 border border-emerald-500 rounded-full"
          />
        )}

        {/* Inner sonar ring when listening */}
        {state === "listening" && (
          <motion.div
            animate={{ scale: [0.8, 1.35, 0.8], opacity: [0.8, 0, 0.8] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeOut" }}
            className="absolute w-36 h-36 border-2 border-amber-500 rounded-full"
          />
        )}

        {/* The Pulsing Core Center (Reactor Eye) */}
        <div 
          className="absolute w-28 h-28 rounded-full flex flex-col items-center justify-center text-center p-2 bg-slate-900 border-2 relative z-10 shadow-inner group-hover:scale-105 transition-transform duration-300"
          style={{ borderColor: themeHex }}
        >
          {/* Inner core energy pulse */}
          <motion.div 
            animate={{ 
              scale: state === "thinking" ? [0.9, 1.1, 0.9] : [1, 1.05, 1],
              opacity: state === "thinking" ? [0.7, 1, 0.7] : [0.8, 1, 0.8]
            }}
            transition={{ repeat: Infinity, duration: state === "thinking" ? 0.6 : 2 }}
            className="absolute inset-2 rounded-full opacity-25"
            style={{ backgroundColor: themeHex, filter: "blur(6px)" }}
          />

          {/* Icon indicator */}
          <div className="z-20 relative">
            {state === "listening" ? (
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="text-amber-400">
                <span className="text-xs font-bold tracking-wider">LISTENING</span>
              </motion.div>
            ) : state === "thinking" ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }} className="text-purple-400">
                <Cpu className="w-8 h-8" />
              </motion.div>
            ) : state === "speaking" ? (
              <motion.div animate={{ scale: [0.95, 1.15, 0.95] }} transition={{ repeat: Infinity, duration: 0.5 }} className="text-emerald-400">
                <Activity className="w-8 h-8" />
              </motion.div>
            ) : (
              <div className="flex flex-col items-center">
                <motion.div 
                  animate={{ scale: [1, 1.08, 1] }} 
                  transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                >
                  <div className="w-10 h-10 rounded-full border border-cyan-500/50 flex items-center justify-center" style={{ borderColor: themeHex + "80" }}>
                    <div className="w-5 h-5 rounded-full" style={{ backgroundColor: themeHex }} />
                  </div>
                </motion.div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Core status labeling */}
      <div className="mt-6 text-center z-10 w-full">
        <p className="text-[10px] font-mono tracking-widest text-slate-500 mb-1">COGNITIVE STATE</p>
        <h3 className="text-sm font-display font-medium tracking-wider text-slate-200 uppercase" style={{ textShadow: `0 0 10px ${themeHex}40` }}>
          {stateLabels[state]}
        </h3>

        {/* Real-time decorative analytics */}
        <div className="mt-4 pt-4 border-t border-slate-900 grid grid-cols-2 gap-4 text-left font-mono text-[11px] text-slate-400">
          <div>
            <span className="text-slate-600 block text-[9px] tracking-wider">CORE THERMALS</span>
            <span className="text-slate-300 font-medium">38.4°C</span>
          </div>
          <div>
            <span className="text-slate-600 block text-[9px] tracking-wider">RESPONSE LATENCY</span>
            <span className="text-slate-300 font-medium">0.084s</span>
          </div>
          <div>
            <span className="text-slate-600 block text-[9px] tracking-wider">SYSTEM THREADS</span>
            <span className="text-slate-300 font-medium">100% OK</span>
          </div>
          <div>
            <span className="text-slate-600 block text-[9px] tracking-wider">AI FRAMEWORK</span>
            <span className="text-slate-300 font-medium">GEMINI-3.5</span>
          </div>
        </div>
      </div>

      {/* Interactive Hint */}
      <div className="mt-5 text-[10px] font-mono text-slate-500 italic text-center animate-pulse">
        * Click core to trigger voice input
      </div>
    </div>
  );
}
