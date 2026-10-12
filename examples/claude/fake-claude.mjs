// Offline CLI contract fixture, not a Claude model or a measurement of its quality.
import assert from "node:assert/strict";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const emit = event => process.stdout.write(JSON.stringify(event) + "\n");

async function main() {
  assert(args.includes("-p"));
  assert.equal(flag("--output-format"), "stream-json");
  assert.equal(flag("--setting-sources"), "");
  assert(args.includes("--strict-mcp-config"));
  assert(args.includes("--no-session-persistence"));
  assert.equal(flag("--permission-mode"), "dontAsk");
  assert(!args.includes("--dangerously-skip-permissions"));
  assert(process.env.CLAUDE_CONFIG_DIR.startsWith(path.dirname(process.env.HOME)));
  assert(process.env.HOME !== process.cwd());
  const config = JSON.parse(await readFile(flag("--mcp-config"), "utf8"));
  const servers = Object.entries(config.mcpServers);
  const skills = await readdir(".claude/skills").catch(() => []);
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  emit({ type: "system", subtype: "init", model: flag("--model"), claude_code_version: "offline-fixture",
    tools: ["Read", "Skill"], skills, mcp_servers: servers.map(([name]) => ({ name, status: "connected" })) });
  const call = (name, input) => emit({ type: "assistant",
    message: { model: "offline-model", content: [{ type: "tool_use", id: "call-1", name, input }] } });
  const response = text => emit({ type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "call-1", content: text }] } });
  let result = "NO_FINDING";
  if (input.includes("formatting-only")) result = "FORMAT_OK";
  else if (skills.length) {
    const name = skills[0];
    await access(path.join(".claude/skills", name, "SKILL.md"));
    call("Skill", { skill: name });
    result = (await readFile(path.join(".claude/skills", name, "reference.txt"), "utf8")).trim();
    response(result);
  } else if (servers.length) {
    const [name, server] = servers[0];
    const client = new Client({ name: "offline-claude", version: "1" });
    const transport = new StdioClientTransport({ command: server.command, args: server.args, env: process.env });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert(tools.tools.some(tool => tool.name === "review_code"));
      call(`mcp__${name}__review_code`, { prompt: input });
      const value = await client.callTool({ name: "review_code", arguments: { prompt: input } });
      result = value.content[0].text;
      response(result);
    } finally { await client.close(); }
  }
  if (input.includes("repair sum.mjs") && result === "RACE_FOUND") {
    call("Edit", { file_path: "sum.mjs" });
    await writeFile("sum.mjs", "export const sum = (a, b) => a + b;\n");
    response("File updated");
  }
  emit({ type: "result", subtype: "success", is_error: false, result,
    usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 },
    total_cost_usd: 0.001 });
}
main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
