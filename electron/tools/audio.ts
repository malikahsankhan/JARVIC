import { registerTool } from "../ipc/toolRegistry";
import { voiceManager } from "../voice";

registerTool({
  name: "system.audio.listen",
  description:
    "Control speech recognition listening state (start, stop, toggle), hard mic power (power_on, power_off, power_toggle), wake-word gating (wake_word_on, wake_word_off, wake_word_toggle), and status.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).mode !== "string") {
      throw new Error("Expected { mode: string }");
    }
    return { mode: (raw as any).mode as string };
  },
  handler: async ({ mode }: { mode: string }) => {
    switch (mode) {
      case "start":
        voiceManager.startListening();
        return { success: true, message: "Browser speech recognition started." };
      case "stop":
        voiceManager.stopListening();
        return { success: true, message: "Browser speech recognition stopped." };
      case "toggle":
        voiceManager.toggleListening();
        return { success: true, message: "Browser speech recognition toggled." };
      case "power_off":
        await voiceManager.powerOffMic();
        return { success: true, message: "Microphone powered off." };
      case "power_on":
        await voiceManager.powerOnMic();
        return { success: true, message: "Microphone powered on." };
      case "power_toggle":
        if (voiceManager.isMicPowered()) {
          await voiceManager.powerOffMic();
          return { success: true, message: "Microphone powered off." };
        } else {
          await voiceManager.powerOnMic();
          return { success: true, message: "Microphone powered on." };
        }
      case "wake_word_on":
        voiceManager.setWakeWordEnabled(true);
        return { success: true, message: "Wake-word listening enabled." };
      case "wake_word_off":
        voiceManager.setWakeWordEnabled(false);
        return { success: true, message: "Wake-word listening disabled." };
      case "wake_word_toggle":
        voiceManager.setWakeWordEnabled(!voiceManager.isWakeWordEnabled());
        return {
          success: true,
          message: voiceManager.isWakeWordEnabled() ? "Wake-word listening enabled." : "Wake-word listening disabled.",
        };
      case "status":
        return {
          success: true,
          message: "Voice status.",
          state: voiceManager.getState(),
          micPowered: voiceManager.isMicPowered(),
          wakeWordEnabled: voiceManager.isWakeWordEnabled(),
        };
      default:
        throw new Error(`Unsupported mode: ${mode}`);
    }
  },
});

