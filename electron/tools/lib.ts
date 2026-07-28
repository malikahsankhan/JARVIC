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

/**
 * Run a PowerShell command (args passed as an array; command text itself is a
 * fixed, developer-authored string, never raw user input).
 *
 * NOTE: an earlier version of this function tried to route calls through one
 * persistent `powershell.exe -Command -` session (piped stdin/stdout) to
 * avoid the ~200ms-1s cold-start cost of spawning a fresh interpreter per
 * call. That approach turned out to be unreliable in practice — PowerShell's
 * console host does not behave as a clean line-buffered REPL over a
 * non-console (piped) stdin/stdout in the way a naive marker-based framing
 * protocol assumes, and commands would hang until timeout rather than ever
 * returning. Rather than ship a plausible-but-unverified optimization that
 * silently breaks every system.* tool, this reverts to spawning a fresh,
 * one-shot powershell.exe per call — slower, but correct and predictable.
 *
 * If this needs revisiting later, the safer path is a small persistent
 * *.NET/C# or Node-native helper (e.g. via a native addon calling Win32 APIs
 * directly) for the hottest-path actions (volume, clipboard, brightness),
 * rather than trying to keep a PowerShell host alive across calls.
 */
export function runPowerShell(script: string, timeoutMs = 10_000): Promise<string> {
  return runCaptured(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    timeoutMs
  );
}

/**
 * No-op kept only so electron/main.ts's shutdown hooks (which call this
 * alongside shutdownAutomationWorker) don't need to be edited again now that
 * there is no persistent PowerShell process to tear down.
 */
export function shutdownPowerShellWorker(): void {
  // Nothing to clean up — runPowerShell no longer keeps a background process alive.
}
