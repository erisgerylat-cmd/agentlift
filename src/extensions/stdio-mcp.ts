import { access, stat } from "node:fs/promises";
import path from "node:path";

import type { McpServerConfig } from "../types.js";
import type {
  ExtensionAdapter,
  ExtensionRuntimeConfig,
} from "./extension-adapter.js";

export interface StdioMcpExtensionOptions {
  name: string;
  command: string[];
  cwd: string;
  envAllowlist: string[];
}

function allowedEnvironment(names: string[]): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

export class StdioMcpExtension implements ExtensionAdapter {
  readonly name = "stdio-mcp";
  private installed = false;

  constructor(private readonly options: StdioMcpExtensionOptions) {}

  async validate(): Promise<void> {
    const cwd = await stat(this.options.cwd);
    if (!cwd.isDirectory()) {
      throw new Error(`MCP cwd is not a directory: ${this.options.cwd}`);
    }

    const program = this.options.command[0];
    if (
      program &&
      (path.isAbsolute(program) ||
        program.startsWith(".") ||
        program.includes("/") ||
        program.includes("\\"))
    ) {
      await access(
        path.isAbsolute(program)
          ? program
          : path.resolve(this.options.cwd, program),
      );
    }
  }

  async install(_experimentRoot: string): Promise<void> {
    this.installed = true;
  }

  async enable(): Promise<ExtensionRuntimeConfig> {
    if (!this.installed) {
      throw new Error("Stdio MCP extension must be installed before enabling");
    }

    const server: McpServerConfig = {
      name: this.options.name,
      transport: "stdio",
      command: this.options.command,
      cwd: this.options.cwd,
      env: allowedEnvironment(this.options.envAllowlist),
    };

    return {
      servers: [server],
    };
  }

  async disable(): Promise<null> {
    return null;
  }

  async uninstall(): Promise<void> {
    this.installed = false;
  }
}
