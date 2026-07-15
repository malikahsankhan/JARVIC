import os from "os";
import dns from "dns/promises";
import { registerTool } from "../ipc/toolRegistry";
import { assertWindows, runPowerShell, launchDetached } from "./lib";

registerTool({
  name: "system.usage",
  description: "Reports CPU load, RAM usage, and uptime for this machine.",
  validateArgs: () => undefined,
  handler: () => {
    const total = os.totalmem();
    const free = os.freemem();
    return {
      cpu: { cores: os.cpus().length, model: os.cpus()[0]?.model ?? "Unknown", loadAverage: os.loadavg() },
      memory: { totalBytes: total, freeBytes: free, usedBytes: total - free, usedPercent: Math.round(((total - free) / total) * 100) },
      uptimeSeconds: Math.floor(os.uptime()),
      platform: os.platform(),
    };
  },
});

registerTool({
  name: "system.diskUsage",
  description: "Reports free/used space for each local disk drive.",
  validateArgs: () => undefined,
  handler: async () => {
    assertWindows("system.diskUsage");
    const json = await runPowerShell(
      "Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{N='UsedGB';E={[math]::Round($_.Used/1GB,2)}},@{N='FreeGB';E={[math]::Round($_.Free/1GB,2)}} | ConvertTo-Json -Compress"
    );
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  },
});

registerTool({
  name: "system.batteryStatus",
  description: "Reports battery presence, charge percentage, and charging status (desktops typically report none).",
  validateArgs: () => undefined,
  handler: async () => {
    assertWindows("system.batteryStatus");
    const json = await runPowerShell(
      "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress"
    );
    if (!json.trim()) return { present: false };
    return { present: true, ...JSON.parse(json) };
  },
});

registerTool({
  name: "system.internetStatus",
  description: "Checks whether this machine currently has internet connectivity.",
  validateArgs: () => undefined,
  handler: async () => {
    try {
      await dns.lookup("one.one.one.one");
      return { online: true };
    } catch {
      return { online: false };
    }
  },
});

registerTool({
  name: "system.lock",
  description: "Locks the workstation (same as Win+L).",
  validateArgs: () => undefined,
  handler: () => {
    assertWindows("system.lock");
    const windir = process.env["WINDIR"] || "C:\\Windows";
    launchDetached(windir + "\\System32\\rundll32.exe", ["user32.dll,LockWorkStation"]);
    return { locked: true };
  },
});

registerTool({
  name: "system.sleep",
  description: "Puts the machine to sleep.",
  destructive: true,
  validateArgs: () => undefined,
  handler: async () => {
    assertWindows("system.sleep");
    const windir = process.env["WINDIR"] || "C:\\Windows";
    launchDetached(windir + "\\System32\\rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]);
    return { sleeping: true };
  },
});

function requireConfirm(raw: unknown, action: string) {
  if (typeof raw !== "object" || raw === null || (raw as any).confirm !== true) {
    throw new Error(`Refusing to ${action} without explicit confirm: true.`);
  }
}

registerTool({
  name: "system.restart",
  description: "Restarts the machine. Requires confirm: true.",
  destructive: true,
  validateArgs: (raw) => {
    requireConfirm(raw, "restart");
    return {};
  },
  handler: async () => {
    assertWindows("system.restart");
    const windir = process.env["WINDIR"] || "C:\\Windows";
    launchDetached(windir + "\\System32\\shutdown.exe", ["/r", "/t", "5"]);
    return { restarting: true, inSeconds: 5 };
  },
});

registerTool({
  name: "system.shutdown",
  description: "Shuts the machine down. Requires confirm: true.",
  destructive: true,
  validateArgs: (raw) => {
    requireConfirm(raw, "shut down");
    return {};
  },
  handler: async () => {
    assertWindows("system.shutdown");
    const windir = process.env["WINDIR"] || "C:\\Windows";
    launchDetached(windir + "\\System32\\shutdown.exe", ["/s", "/t", "5"]);
    return { shuttingDown: true, inSeconds: 5 };
  },
});
