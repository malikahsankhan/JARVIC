import { desktopCapturer, screen } from "electron";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { registerTool } from "../ipc/toolRegistry";

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

    const pngBuffer = primarySource.thumbnail.toPNG();

    const screenshotsDir = path.join(os.homedir(), "Pictures", "Screenshots");
    await fs.mkdir(screenshotsDir, { recursive: true });
    const targetPath = path.join(screenshotsDir, fileName);
    await fs.writeFile(targetPath, pngBuffer);

    return { savedTo: targetPath, width: primarySource.thumbnail.getSize().width, height: primarySource.thumbnail.getSize().height };
  },
});
