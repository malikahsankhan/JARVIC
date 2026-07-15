import path from "path";
import { registerTool } from "../ipc/toolRegistry";
import { assertWindows, runCaptured, runPowerShell } from "./lib";

registerTool({
  name: "processes.list",
  description: "Lists running processes with PID, name, CPU time, and memory (working set).",
  validateArgs: () => undefined,
  handler: async () => {
    assertWindows("processes.list");
    const json = await runPowerShell(
      "Get-Process | Select-Object Id,ProcessName,CPU,@{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress"
    );
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  },
});

registerTool({
  name: "processes.kill",
  description: "Forcefully terminates a process by PID.",
  destructive: true,
  validateArgs: (raw) => {
    const pid = typeof raw === "object" && raw !== null ? (raw as any).pid : undefined;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
      throw new Error("Expected { pid: positive integer }");
    }
    return { pid };
  },
  handler: async ({ pid }: { pid: number }) => {
    assertWindows("processes.kill");
    const windir = process.env["WINDIR"] || "C:\\Windows";
    const output = await runCaptured(path.join(windir, "System32", "taskkill.exe"), ["/PID", String(pid), "/F"]);
    return { killed: pid, output: output.trim() };
  },
});
