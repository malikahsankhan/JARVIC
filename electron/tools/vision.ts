import { registerTool } from "../ipc/toolRegistry";
import { captureScreenForVision } from "./screenshot";

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI VISION — lets the AI actually SEE the screen, not just read its
// accessibility tree. This is a fallback for apps/content that
// desktop.dumpControls can't describe (games, canvas/custom-rendered UI,
// icon-only toolbars with no accessible name) or for visually confirming
// something (a checkbox's checked state, a color, a QR code, which item is
// highlighted).
//
// The image itself is NOT sent back through the normal JSON tool-result path
// (that would blow up token usage as raw base64 text). Instead the handler
// returns it under a special `__visionImage` key on the result; server.ts
// strips that out of the JSON functionResponse and re-attaches it as a real
// `inlineData` image part in the same turn, so Gemini sees actual pixels.
// ─────────────────────────────────────────────────────────────────────────────

registerTool({
  name: "vision.see",
  description:
    "Captures the current screen and returns it as an image you can actually SEE (true multimodal vision), not just a file path. Use this when desktop.dumpControls returns empty/unhelpful results (games, canvas or custom-rendered UI, icon-only controls with no accessible name), or when you need to visually confirm something on screen a text-only tool can't tell you (a checkbox's checked state, a color, which item is highlighted, reading a QR code or diagram). The returned result includes imageWidth/imageHeight (the image you're looking at) and screenWidth/screenHeight (the real screen). If you locate something at pixel (ix, iy) in the image, convert it to a real screen coordinate before calling input.mouseClick/input.mouseMove: x = ix * (screenWidth / imageWidth), y = iy * (screenHeight / imageHeight). Prefer desktop.listWindows + desktop.dumpControls + desktop.clickControl first when the app exposes a usable accessibility tree — that's faster and more precise than clicking based on an estimated pixel position; use vision.see when that path fails or for pure visual confirmation.",
  validateArgs: () => ({}),
  handler: async () => {
    const { base64, mimeType, imageWidth, imageHeight, screenWidth, screenHeight } = await captureScreenForVision();
    return {
      success: true,
      message: `Screenshot captured (${imageWidth}x${imageHeight}, real screen ${screenWidth}x${screenHeight}).`,
      imageWidth,
      imageHeight,
      screenWidth,
      screenHeight,
      __visionImage: { mimeType, data: base64 },
    };
  },
});
