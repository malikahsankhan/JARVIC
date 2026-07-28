import { desktopCapturer, screen } from "electron";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { registerTool } from "../ipc/toolRegistry";
import { assertWindows, runPowerShell } from "./lib";

/** Captures the primary display and returns a PNG buffer, shared by both tools below. */
async function captureScreenPng(): Promise<{ buffer: Buffer; width: number; height: number }> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const scaleFactor = display.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor) },
  });

  const primarySource = sources[0];
  if (!primarySource) {
    throw new Error("No screen source available to capture.");
  }

  return {
    buffer: primarySource.thumbnail.toPNG(),
    width: primarySource.thumbnail.getSize().width,
    height: primarySource.thumbnail.getSize().height,
  };
}

registerTool({
  name: "system.takeScreenshot",
  description:
    "Captures a full screenshot of the primary display and saves it as a PNG file. Returns the saved file path.",
  validateArgs: (raw) => {
    const fileName =
      typeof raw === "object" && raw !== null && typeof (raw as any).fileName === "string"
        ? (raw as any).fileName.replace(/[^\w.-]/g, "_")
        : `screenshot-${Date.now()}.png`;
    return { fileName: fileName.endsWith(".png") ? fileName : `${fileName}.png` };
  },
  handler: async ({ fileName }: { fileName: string }) => {
    const { buffer, width, height } = await captureScreenPng();

    const screenshotsDir = path.join(os.homedir(), "Pictures", "Screenshots");
    await fs.mkdir(screenshotsDir, { recursive: true });
    const targetPath = path.join(screenshotsDir, fileName);
    await fs.writeFile(targetPath, buffer);

    return { savedTo: targetPath, width, height };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN OCR — reads whatever text is actually visible on screen, regardless
// of whether the source app exposes a UIA/accessibility tree. Uses Windows'
// own built-in OCR engine (Windows.Media.Ocr, the same one behind PowerToys
// Text Extractor / Snipping Tool's text actions) via a WinRT-from-PowerShell
// bridge, so there is no extra dependency (Tesseract, etc.) to install.
// Requires a Windows OCR language pack to be installed — present by default
// on virtually every en-US/major-locale Windows 10/11 install.
// ─────────────────────────────────────────────────────────────────────────────

const OCR_POWERSHELL_SCRIPT = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null

$imagePath = "__IMAGE_PATH__"
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $ocrEngine) {
  throw "No Windows OCR language pack is installed. Install one via Settings > Time & Language > Language & region > Add a language (with 'Optical character recognition' checked)."
}

$result = Await ($ocrEngine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$lines = @()
foreach ($line in $result.Lines) {
  $words = @()
  foreach ($w in $line.Words) {
    $words += [PSCustomObject]@{
      text = $w.Text
      x = [int]$w.BoundingRect.X
      y = [int]$w.BoundingRect.Y
      width = [int]$w.BoundingRect.Width
      height = [int]$w.BoundingRect.Height
    }
  }
  $lines += [PSCustomObject]@{ text = $line.Text; words = $words }
}

[PSCustomObject]@{
  fullText = $result.Text
  lines = $lines
} | ConvertTo-Json -Compress -Depth 6
`;

registerTool({
  name: "screen.readText",
  description:
    "Reads all text currently visible on screen using OCR (optical character recognition) — works on ANY visible content, including games, images, PDFs, and custom-drawn UI that has no accessibility tree, unlike desktop.dumpControls. Returns full recognized text plus per-line and per-word screen coordinates (useful for then clicking at a specific word's position with input.click).",
  validateArgs: () => ({}),
  handler: async () => {
    assertWindows("screen.readText");
    const { buffer } = await captureScreenPng();
    const tempPath = path.join(os.tmpdir(), `jarvic-ocr-${Date.now()}.png`);
    await fs.writeFile(tempPath, buffer);

    try {
      const script = OCR_POWERSHELL_SCRIPT.replace("__IMAGE_PATH__", tempPath.replace(/\\/g, "\\\\"));
      const raw = await runPowerShell(script, 20_000);
      const parsed = JSON.parse(raw.trim());
      return { fullText: parsed.fullText ?? "", lines: parsed.lines ?? [] };
    } finally {
      fs.unlink(tempPath).catch(() => {});
    }
  },
});
