import { ToolDefinition } from "./types";

const registry = new Map<string, ToolDefinition<any, any>>();

export function registerTool(tool: ToolDefinition<any, any>): void {
  if (registry.has(tool.name)) {
    throw new Error(`Tool "${tool.name}" is already registered.`);
  }
  registry.set(tool.name, tool);
}

export function getTool(name: string): ToolDefinition<any, any> | undefined {
  return registry.get(name);
}

export function listToolNames(): string[] {
  return Array.from(registry.keys());
}
