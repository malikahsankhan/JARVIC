import fs from "fs/promises";
import os from "os";
import path from "path";
import { registerTool } from "../ipc/toolRegistry";

const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB — plenty for text files, guards against accidentally reading huge binaries
const MAX_SEARCH_RESULTS = 500;
const MAX_SEARCH_DEPTH = 8;
const SKIP_DIRS = new Set(["node_modules", ".git", "$Recycle.Bin", "System Volume Information"]);

function str(raw: unknown, field: string): string {
  if (typeof raw !== "object" || raw === null || typeof (raw as any)[field] !== "string" || !(raw as any)[field].trim()) {
    throw new Error(`Expected "${field}" to be a non-empty string`);
  }
  return (raw as any)[field];
}

registerTool({
  name: "files.read",
  description: "Reads a text file's contents (UTF-8, up to 5MB).",
  validateArgs: (raw) => ({ target: path.resolve(str(raw, "path")) }),
  handler: async ({ target }: { target: string }) => {
    const stat = await fs.stat(target);
    if (stat.size > MAX_READ_BYTES) {
      throw new Error(`File is ${stat.size} bytes, exceeding the ${MAX_READ_BYTES}-byte read limit.`);
    }
    const content = await fs.readFile(target, "utf-8");
    return { path: target, content, bytes: stat.size };
  },
});

registerTool({
  name: "files.write",
  description: "Writes (overwrites) a text file with the given content, creating parent folders if needed.",
  validateArgs: (raw) => ({ target: path.resolve(str(raw, "path")), content: str(raw, "content") }),
  handler: async ({ target, content }: { target: string; content: string }) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
    return { path: target, bytesWritten: Buffer.byteLength(content, "utf-8") };
  },
});

registerTool({
  name: "files.append",
  description: "Appends text to the end of a file, creating it if it doesn't exist.",
  validateArgs: (raw) => ({ target: path.resolve(str(raw, "path")), content: str(raw, "content") }),
  handler: async ({ target, content }: { target: string; content: string }) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, content, "utf-8");
    return { path: target, bytesAppended: Buffer.byteLength(content, "utf-8") };
  },
});

registerTool({
  name: "files.delete",
  description: "PERMANENTLY deletes a single file. Requires confirm: true.",
  destructive: true,
  validateArgs: (raw) => {
    const target = path.resolve(str(raw, "path"));
    if ((raw as any).confirm !== true) throw new Error("Refusing to delete without explicit confirm: true.");
    return { target };
  },
  handler: async ({ target }: { target: string }) => {
    await fs.unlink(target);
    return { deleted: target };
  },
});

registerTool({
  name: "files.search",
  description: "Searches for files by (partial, case-insensitive) filename and/or extension under a root folder.",
  validateArgs: (raw) => {
    if (typeof raw !== "object" || raw === null) throw new Error("Expected an object");
    const root = path.resolve(typeof (raw as any).root === "string" ? (raw as any).root : os.homedir());
    const nameContains = typeof (raw as any).nameContains === "string" ? (raw as any).nameContains.toLowerCase() : undefined;
    const extension = typeof (raw as any).extension === "string" ? (raw as any).extension.replace(/^\./, "").toLowerCase() : undefined;
    if (!nameContains && !extension) throw new Error("Provide at least nameContains or extension");
    return { root, nameContains, extension };
  },
  handler: async ({ root, nameContains, extension }: { root: string; nameContains?: string; extension?: string }) => {
    const results: string[] = [];

    async function walk(dir: string, depth: number) {
      if (results.length >= MAX_SEARCH_RESULTS || depth > MAX_SEARCH_DEPTH) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // permission-denied or vanished dir — skip silently
      }
      for (const entry of entries) {
        if (results.length >= MAX_SEARCH_RESULTS) return;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
        } else {
          const lower = entry.name.toLowerCase();
          const nameOk = !nameContains || lower.includes(nameContains);
          const extOk = !extension || lower.endsWith(`.${extension}`);
          if (nameOk && extOk) results.push(full);
        }
      }
    }

    await walk(root, 0);
    return { root, count: results.length, truncated: results.length >= MAX_SEARCH_RESULTS, results };
  },
});
