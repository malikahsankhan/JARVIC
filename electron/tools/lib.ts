import { spawn, execFile } from "child_process";

/** Throws for tools that only make sense on Windows (per project scope). */
export function assertWindows(toolName: string): void {
  if (process.platform !== "win32") {
    throw new Error(`Tool "${toolName}" is only supported on Windows.`);
  }
}

/**
 * Launch a program detached from JARVIC, with an explicit argument array
 * (never a shell string) so there is no command-injection surface.
 */
export function launchDetached(command: string, args: string[] = []): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: false,
  });
  child.unref();
}

/** Run a command and capture stdout, still with an argument array (no shell). */
export function runCaptured(command: string, args: string[], timeoutMs = 10_000, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024, cwd }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.toString().trim() || err.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

/** Run a PowerShell command (args passed as an array; command text itself is a fixed, developer-authored string, never raw user input). */
export function runPowerShell(script: string, timeoutMs = 10_000): Promise<string> {
  return runCaptured(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    timeoutMs
  );
}
