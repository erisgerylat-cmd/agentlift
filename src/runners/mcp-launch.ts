// Launch a stdio MCP with its own cwd and an explicit environment. Claude's
// authentication environment must not be inherited by the tool server.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { McpServerConfig } from "../types.js";

async function main() {
  const servers: McpServerConfig[] = JSON.parse(await readFile(process.argv[2]!, "utf8"));
  const server = servers[Number(process.argv[3])];
  if (!server) throw new Error("Missing MCP server");
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME", "XDG_DATA_HOME", "SystemRoot", "ComSpec", "PATHEXT"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, server.env);
  const child = spawn(server.command[0]!, server.command.slice(1), {
    cwd: server.cwd, env, stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", () => { process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code ?? 1; });
}
main().catch(() => { process.stderr.write("MCP launcher failed\n"); process.exitCode = 1; });
