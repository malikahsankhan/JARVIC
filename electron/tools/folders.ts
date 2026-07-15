import { shell } from "electron";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import { registerTool } from "../ipc/toolRegistry";

const home = os.homedir();

const KNOWN_FOLDERS: Record<string, string> = {
  home,
  desktop: path.join(home, "Desktop"),
  documents: path.join(home, "Documents"),
  downloads: path.join(home, "Downloads"),
  pictures: path.join(home, "Pictures"),
  videos: path.join(home, "Videos"),
};

function requirePath(raw: unknown, field = "path"): string {
  if (typeof raw !== "object" || raw === null || typeof (raw as any)[field] !== "string" || !(raw as any)[field].trim()) {
    throw new Error(`Expected { ${field}: string }`);
  }
  return path.resolve((raw as any)[field]);
}

registerTool({
  name: "folders.openKnown",
  description: "Opens a well-known folder (home, desktop, documents, downloads, pictures, videos) in File Explorer.",
  validateArgs: (raw) => {
    const key = typeof raw === "object" && raw !== null ? (raw as any).key : undefined;
    if (typeof key !== "string" || !(key in KNOWN_FOLDERS)) {
      throw new Error(`key must be one of: ${Object.keys(KNOWN_FOLDERS).join(", ")}`);
    }
    return { key };
  },
  handler: async ({ key }: { key: string }) => {
    const target = KNOWN_FOLDERS[key];
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return { opened: target };
  },
});

registerTool({
  name: "folders.open",
  description: "Opens an arbitrary folder path in File Explorer.",
  validateArgs: (raw) => ({ target: requirePath(raw) }),
  handler: async ({ target }: { target: string }) => {
    if (!fsSync.existsSync(target) || !fsSync.statSync(target).isDirectory()) {
      throw new Error(`"${target}" is not an existing folder.`);
    }
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return { opened: target };
  },
});

registerTool({
  name: "folders.create",
  description: "Creates a new folder (and any missing parent folders) at the given path.",
  validateArgs: (raw) => ({ target: requirePath(raw) }),
  handler: async ({ target }: { target: string }) => {
    await fs.mkdir(target, { recursive: true });
    return { created: target };
  },
});

registerTool({
  name: "folders.rename",
  description: "Renames/moves a folder from one path to another.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).from !== "string" || typeof (raw as any).to !== "string") {
      throw new Error("Expected { from: string, to: string }");
    }
    return { from: path.resolve((raw as any).from), to: path.resolve((raw as any).to) };
  },
  handler: async ({ from, to }: { from: string; to: string }) => {
    await fs.rename(from, to);
    return { from, to };
  },
});

registerTool({
  name: "folders.copy",
  description: "Recursively copies a folder to a new location.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null || typeof (raw as any).from !== "string" || typeof (raw as any).to !== "string") {
      throw new Error("Expected { from: string, to: string }");
    }
    return { from: path.resolve((raw as any).from), to: path.resolve((raw as any).to) };
  },
  handler: async ({ from, to }: { from: string; to: string }) => {
    await fs.cp(from, to, { recursive: true });
    return { from, to };
  },
});

registerTool({
  name: "folders.delete",
  description: "PERMANENTLY deletes a folder and its contents. Requires confirm: true.",
  destructive: true,
  validateArgs: (raw) => {
    const target = requirePath(raw);
    const confirm = typeof raw === "object" && raw !== null ? (raw as any).confirm : undefined;
    if (confirm !== true) {
      throw new Error("Refusing to delete without explicit confirm: true.");
    }
    return { target };
  },
  handler: async ({ target }: { target: string }) => {
    await fs.rm(target, { recursive: true, force: true });
    return { deleted: target };
  },
});
