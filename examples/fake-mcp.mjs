import readline from "node:readline";

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  );
}

input.on("line", (line) => {
  const request = JSON.parse(line);

  switch (request.method) {
    case "initialize":
      respond(request.id, {
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "agentlift-fake-review",
          version: "0.0.0",
        },
      });
      break;
    case "notifications/initialized":
      break;
    case "tools/list":
      respond(request.id, {
        tools: [
          {
            name: "review_code",
            description: "Review code for concurrency defects.",
            inputSchema: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                },
              },
              required: ["prompt"],
            },
          },
        ],
      });
      break;
    case "tools/call":
      if (request.params?.name !== "review_code") {
        fail(request.id, -32602, "Unknown tool");
        break;
      }
      respond(request.id, {
        content: [
          {
            type: "text",
            text: "RACE_FOUND",
          },
        ],
      });
      break;
    default:
      fail(request.id, -32601, "Method not found");
  }
});
