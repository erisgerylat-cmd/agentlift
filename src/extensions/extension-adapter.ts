import type { RunStartMessage } from "../types.js";

export type ExtensionRuntimeConfig = RunStartMessage["mcpConfig"];

export interface ExtensionAdapter {
  readonly name: string;
  validate(): Promise<void>;
  install(experimentRoot: string): Promise<void>;
  enable(): Promise<ExtensionRuntimeConfig>;
  disable(): Promise<null>;
  uninstall(): Promise<void>;
}
