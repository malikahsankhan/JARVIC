/**
 * os_control.ts
 * Full Windows OS control: volume, brightness, clipboard, Wi-Fi, Bluetooth,
 * notifications, app-switcher, taskbar, recycle-bin, network info,
 * environment variables, and more — all via PowerShell or Windows APIs.
 */

import { registerTool } from "../ipc/toolRegistry";
import { assertWindows, runPowerShell, launchDetached } from "./lib";
import path from "path";
import os from "os";

const windir = process.env["WINDIR"] || "C:\\Windows";

// ─────────────────────────────────────────────────────────────────────────────
// VOLUME CONTROL
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "system.setVolume",
  description:
    "Sets the master system volume to an exact percentage (0-100). Use this for 'set volume to 50%' requests.",
  validateArgs: (raw) => {
    const level = (raw as any)?.level;
    if (typeof level !== "number" || level < 0 || level > 100)
      throw new Error("Expected { level: number } between 0 and 100");
    return { level: Math.round(level) };
  },
  handler: async ({ level }: { level: number }) => {
    assertWindows("system.setVolume");
    await runPowerShell(
      `$vol = ${level / 100};
       $wshell = New-Object -ComObject WScript.Shell;
       $wshell.SendKeys([char]174 * 50);
       $steps = [Math]::Round($vol * 50);
       for ($i=0; $i -lt $steps; $i++) { $wshell.SendKeys([char]175); Start-Sleep -Milliseconds 30 }`
    );
    return { success: true, volumePercent: level };
  },
});

registerTool({
  name: "system.adjustVolume",
  description:
    "Adjusts the system volume up, down, or toggles mute. Steps (default 5) sets how many key-taps (each ≈ 2%).",
  validateArgs: (raw) => {
    const action = (raw as any)?.action;
    if (!["up", "down", "mute"].includes(action))
      throw new Error("action must be 'up', 'down', or 'mute'");
    const steps = typeof (raw as any)?.steps === "number" ? (raw as any).steps : 5;
    return { action, steps };
  },
  handler: async ({ action, steps }: { action: string; steps: number }) => {
    assertWindows("system.adjustVolume");
    const keyChar = action === "up" ? 175 : action === "down" ? 174 : 173;
    const repeat = action === "mute" ? 1 : steps;
    await runPowerShell(
      `$wsh = New-Object -ComObject WScript.Shell;
       for ($i=0; $i -lt ${repeat}; $i++) { $wsh.SendKeys([char]${keyChar}); Start-Sleep -Milliseconds 50 }`
    );
    return { success: true, action, steps: repeat };
  },
});

registerTool({
  name: "system.getVolume",
  description: "Gets the current master volume level (0-100) and mute state.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.getVolume");
    const raw = await runPowerShell(
      `Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { }
'@;
$DevEnum = [System.Runtime.InteropServices.Marshal]::GetComInterfaceForObject(
  (New-Object -ComObject MMDeviceEnumerator), [System.Type]::GetTypeFromCLSID('BCDE0395-E52F-467C-8E3D-C4579291692E'));
# Fallback: return mixer level via nircmd or WMI
try { 
  $vol = [math]::Round((Get-AudioDevice -Playback).Volume); 
  Write-Output "{\"volume\":$vol}"
} catch {
  Write-Output "{\"volume\":\"unknown\",\"error\":\"$($_.Exception.Message)\"}"
}`
    );
    try { return JSON.parse(raw.trim()); }
    catch { return { volume: "unknown" }; }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// BRIGHTNESS CONTROL
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "system.getBrightness",
  description: "Gets the current screen brightness percentage (laptop/monitors that support WMI).",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.getBrightness");
    const raw = await runPowerShell(
      `(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness`
    );
    const pct = parseInt(raw.trim());
    return { brightness: isNaN(pct) ? "unknown" : pct };
  },
});

registerTool({
  name: "system.setBrightness",
  description:
    "Sets screen brightness to a percentage (0-100). Works on laptops and monitors that expose WMI brightness control.",
  validateArgs: (raw) => {
    const level = (raw as any)?.level;
    if (typeof level !== "number" || level < 0 || level > 100)
      throw new Error("Expected { level: number } between 0 and 100");
    return { level: Math.round(level) };
  },
  handler: async ({ level }: { level: number }) => {
    assertWindows("system.setBrightness");
    await runPowerShell(
      `Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = ${level} }`
    );
    return { success: true, brightnessPercent: level };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIPBOARD
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "clipboard.read",
  description: "Reads the current text content of the system clipboard.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("clipboard.read");
    const text = await runPowerShell(`Get-Clipboard`);
    return { text: text.trim() };
  },
});

registerTool({
  name: "clipboard.write",
  description: "Writes (overwrites) text to the system clipboard.",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.text !== "string")
      throw new Error("Expected { text: string }");
    return { text: (raw as any).text as string };
  },
  handler: async ({ text }: { text: string }) => {
    assertWindows("clipboard.write");
    const escaped = text.replace(/'/g, "''");
    await runPowerShell(`Set-Clipboard -Value '${escaped}'`);
    return { success: true, length: text.length };
  },
});

registerTool({
  name: "clipboard.clear",
  description: "Clears the system clipboard.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("clipboard.clear");
    await runPowerShell(`Set-Clipboard -Value $null`);
    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// WI-FI CONTROL
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "wifi.status",
  description: "Gets the current Wi-Fi connection status and the SSID currently connected to.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("wifi.status");
    const raw = await runPowerShell(
      `netsh wlan show interfaces | Select-String 'SSID|State|Signal'`
    );
    return { info: raw.trim() };
  },
});

registerTool({
  name: "wifi.listNetworks",
  description: "Lists available nearby Wi-Fi networks with signal strength.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("wifi.listNetworks");
    const raw = await runPowerShell(`netsh wlan show networks mode=bssid`);
    return { networks: raw.trim() };
  },
});

registerTool({
  name: "wifi.disable",
  description: "Disables Wi-Fi on this machine.",
  destructive: true,
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("wifi.disable");
    await runPowerShell(
      `Get-NetAdapter | Where-Object {$_.Name -like "*Wi-Fi*" -or $_.Name -like "*Wireless*"} | Disable-NetAdapter -Confirm:$false`
    );
    return { success: true, wifi: "disabled" };
  },
});

registerTool({
  name: "wifi.enable",
  description: "Enables Wi-Fi on this machine.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("wifi.enable");
    await runPowerShell(
      `Get-NetAdapter | Where-Object {$_.Name -like "*Wi-Fi*" -or $_.Name -like "*Wireless*"} | Enable-NetAdapter -Confirm:$false`
    );
    return { success: true, wifi: "enabled" };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK INFO
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "network.info",
  description: "Returns detailed network adapter info: IP, MAC, DNS, gateway for all active adapters.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("network.info");
    const raw = await runPowerShell(
      `Get-NetIPConfiguration | Where-Object {$_.IPv4Address} | Select-Object InterfaceAlias, @{N='IP';E={$_.IPv4Address.IPAddress}}, @{N='Gateway';E={$_.IPv4DefaultGateway.NextHop}}, @{N='DNS';E={$_.DNSServer.ServerAddresses}} | ConvertTo-Json -Compress`
    );
    try { return JSON.parse(raw.trim()); }
    catch { return { raw: raw.trim() }; }
  },
});

registerTool({
  name: "network.publicIp",
  description: "Fetches the machine's public IP address from an external service.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("network.publicIp");
    const raw = await runPowerShell(`(Invoke-RestMethod -Uri 'https://api.ipify.org?format=json').ip`);
    return { publicIp: raw.trim() };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// BLUETOOTH
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "bluetooth.status",
  description: "Checks whether Bluetooth is enabled or disabled.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("bluetooth.status");
    const raw = await runPowerShell(
      `Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Select-Object Status, FriendlyName | ConvertTo-Json -Compress`
    );
    try { return JSON.parse(raw.trim()); }
    catch { return { raw: raw.trim() }; }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// RECYCLE BIN
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "recycleBin.empty",
  description: "Permanently empties the Windows Recycle Bin. Requires the user to have explicitly agreed first.",
  destructive: true,
  validateArgs: (raw) => {
    if ((raw as any)?.confirm !== true)
      throw new Error("Provide { confirm: true } after user explicitly agrees.");
    return {};
  },
  handler: async () => {
    assertWindows("recycleBin.empty");
    await runPowerShell(`Clear-RecycleBin -Force -Confirm:$false`);
    return { success: true, message: "Recycle Bin has been emptied." };
  },
});

registerTool({
  name: "recycleBin.size",
  description: "Reports how many items and total size (MB) are currently in the Recycle Bin.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("recycleBin.size");
    const raw = await runPowerShell(
      `$shell = New-Object -ComObject Shell.Application;
       $bin = $shell.Namespace(0xA);
       $items = $bin.Items();
       $count = $items.Count;
       $size = ($items | ForEach-Object { $_.Size } | Measure-Object -Sum).Sum;
       Write-Output "{\"items\":$count,\"sizeMB\":[math]::Round($size/1MB,2)}"` 
    );
    try { return JSON.parse(raw.trim()); }
    catch { return { raw: raw.trim() }; }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT & SYSTEM INFO
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "system.hostname",
  description: "Returns the computer's hostname and Windows edition.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.hostname");
    const raw = await runPowerShell(
      `$info = Get-CimInstance Win32_OperatingSystem;
       Write-Output "{\"hostname\":\"$($env:COMPUTERNAME)\",\"os\":\"$($info.Caption)\",\"build\":\"$($info.BuildNumber)\",\"user\":\"$($env:USERNAME)\"}"` 
    );
    try { return JSON.parse(raw.trim()); }
    catch { return { hostname: os.hostname() }; }
  },
});

registerTool({
  name: "system.installedApps",
  description: "Lists installed applications (name, publisher, version) from the Windows registry.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.installedApps");
    const raw = await runPowerShell(
      `Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* |
       Select-Object DisplayName, Publisher, DisplayVersion |
       Where-Object { $_.DisplayName } |
       Sort-Object DisplayName |
       ConvertTo-Json -Compress`
    );
    try {
      const apps = JSON.parse(raw.trim());
      return { apps: Array.isArray(apps) ? apps : [apps] };
    } catch { return { raw: raw.trim() }; }
  },
});

registerTool({
  name: "system.runningServices",
  description: "Lists all currently running Windows services with their names and display names.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.runningServices");
    const raw = await runPowerShell(
      `Get-Service | Where-Object { $_.Status -eq 'Running' } | Select-Object Name, DisplayName | ConvertTo-Json -Compress`
    );
    try {
      const services = JSON.parse(raw.trim());
      return { services: Array.isArray(services) ? services : [services] };
    } catch { return { raw: raw.trim() }; }
  },
});

registerTool({
  name: "system.envVars",
  description: "Lists all system and user environment variables.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.envVars");
    const raw = await runPowerShell(
      `[System.Environment]::GetEnvironmentVariables() | ConvertTo-Json -Compress`
    );
    try { return JSON.parse(raw.trim()); }
    catch { return { raw: raw.trim() }; }
  },
});

registerTool({
  name: "system.setEnvVar",
  description: "Sets a persistent user-level environment variable (requires JARVIC restart or new shell to take effect).",
  validateArgs: (raw) => {
    if (typeof (raw as any)?.name !== "string" || typeof (raw as any)?.value !== "string")
      throw new Error("Expected { name: string, value: string }");
    return { name: (raw as any).name as string, value: (raw as any).value as string };
  },
  handler: async ({ name, value }: { name: string; value: string }) => {
    assertWindows("system.setEnvVar");
    const safeName = name.replace(/'/g, "''");
    const safeValue = value.replace(/'/g, "''");
    await runPowerShell(`[System.Environment]::SetEnvironmentVariable('${safeName}', '${safeValue}', 'User')`);
    return { success: true, name, value };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY & TASKBAR
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "system.getScreenResolution",
  description: "Returns the current screen resolution and number of monitors.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.getScreenResolution");
    const raw = await runPowerShell(
      `Get-CimInstance -ClassName Win32_VideoController | Select-Object CurrentHorizontalResolution, CurrentVerticalResolution, Name | ConvertTo-Json -Compress`
    );
    try {
      const r = JSON.parse(raw.trim());
      return { displays: Array.isArray(r) ? r : [r] };
    } catch { return { raw: raw.trim() }; }
  },
});

registerTool({
  name: "system.openTaskbar",
  description: "Shows the Windows Taskbar and Start Menu area.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.openTaskbar");
    await runPowerShell(`$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys('^{ESC}')`);
    return { success: true };
  },
});

registerTool({
  name: "system.openActionCenter",
  description: "Opens the Windows Action Center / Notifications panel (Win + A).",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.openActionCenter");
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms;
       [System.Windows.Forms.SendKeys]::SendWait('%{F10}');
       Start-Sleep -Milliseconds 100;`
    );
    launchDetached(path.join(windir, "System32", "cmd.exe"), ["/c", "start", "", "ms-actioncenter:"]);
    return { success: true };
  },
});

registerTool({
  name: "system.openSettings",
  description: "Opens a specific Windows Settings page. Pages: 'home', 'display', 'sound', 'notifications', 'wifi', 'bluetooth', 'power', 'storage', 'apps', 'accounts', 'update', 'privacy'.",
  validateArgs: (raw) => {
    const page = (raw as any)?.page ?? "home";
    return { page };
  },
  handler: async ({ page }: { page: string }) => {
    assertWindows("system.openSettings");
    const pageMap: Record<string, string> = {
      home: "ms-settings:",
      display: "ms-settings:display",
      sound: "ms-settings:sound",
      notifications: "ms-settings:notifications",
      wifi: "ms-settings:network-wifi",
      bluetooth: "ms-settings:bluetooth",
      power: "ms-settings:powersleep",
      storage: "ms-settings:storagesense",
      apps: "ms-settings:appsfeatures",
      accounts: "ms-settings:yourinfo",
      update: "ms-settings:windowsupdate",
      privacy: "ms-settings:privacy",
    };
    const uri = pageMap[page] ?? "ms-settings:";
    launchDetached(path.join(windir, "System32", "cmd.exe"), ["/c", "start", "", uri]);
    return { success: true, opened: uri };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// POWER / SLEEP TIMERS
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "system.setShutdownTimer",
  description: "Schedules an automatic shutdown after N minutes. Set minutes to 0 to cancel.",
  validateArgs: (raw) => {
    const minutes = (raw as any)?.minutes;
    if (typeof minutes !== "number" || minutes < 0)
      throw new Error("Expected { minutes: number }");
    return { minutes };
  },
  handler: async ({ minutes }: { minutes: number }) => {
    assertWindows("system.setShutdownTimer");
    if (minutes === 0) {
      launchDetached(path.join(windir, "System32", "shutdown.exe"), ["/a"]);
      return { success: true, message: "Shutdown timer cancelled." };
    }
    const seconds = minutes * 60;
    launchDetached(path.join(windir, "System32", "shutdown.exe"), ["/s", "/t", String(seconds)]);
    return { success: true, message: `Machine will shut down in ${minutes} minute(s).` };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// WINDOW MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "system.minimizeAllWindows",
  description: "Minimizes all open windows to show the desktop (Win + D equivalent).",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.minimizeAllWindows");
    await runPowerShell(
      `$shell = New-Object -ComObject Shell.Application; $shell.MinimizeAll()`
    );
    return { success: true };
  },
});

registerTool({
  name: "system.restoreAllWindows",
  description: "Restores all previously minimized windows.",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.restoreAllWindows");
    await runPowerShell(
      `$shell = New-Object -ComObject Shell.Application; $shell.UndoMinimizeALL()`
    );
    return { success: true };
  },
});

registerTool({
  name: "system.switchWindow",
  description: "Switches to the next open application window (Alt+Tab equivalent).",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("system.switchWindow");
    await runPowerShell(
      `Add-Type -AssemblyName System.Windows.Forms;
       [System.Windows.Forms.SendKeys]::SendWait('%{TAB}')`
    );
    return { success: true };
  },
});
