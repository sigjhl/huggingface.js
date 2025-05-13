#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// cli.ts
var readline = __toESM(require("readline/promises"));
var import_node_process = require("process");
var import_node_path = require("path");
var import_node_os = require("os");

// src/utils.ts
var import_util = require("util");
function debug(...args) {
  if (process.env.DEBUG) {
    console.debug((0, import_util.inspect)(args, { depth: Infinity, colors: true }));
  }
}
var ANSI = {
  BLUE: "\x1B[34m",
  GRAY: "\x1B[90m",
  GREEN: "\x1B[32m",
  RED: "\x1B[31m",
  RESET: "\x1B[0m"
};

// src/McpClient.ts
var import_client = require("@modelcontextprotocol/sdk/client/index.js");
var import_stdio = require("@modelcontextprotocol/sdk/client/stdio.js");
var import_inference = require("@huggingface/inference");

// package.json
var version = "0.1.3";

// src/McpClient.ts
var McpClient = class {
  client;
  provider;
  model;
  clients = /* @__PURE__ */ new Map();
  availableTools = [];
  constructor({
    provider,
    endpointUrl,
    model,
    apiKey
  }) {
    this.client = endpointUrl ? new import_inference.InferenceClient(apiKey, { endpointUrl }) : new import_inference.InferenceClient(apiKey);
    this.provider = provider;
    this.model = model;
  }
  async addMcpServers(servers) {
    await Promise.all(servers.map((s) => this.addMcpServer(s)));
  }
  async addMcpServer(server) {
    const transport = new import_stdio.StdioClientTransport({
      ...server,
      env: { ...server.env, PATH: process.env.PATH ?? "" }
    });
    const mcp = new import_client.Client({ name: "@huggingface/mcp-client", version });
    await mcp.connect(transport);
    const toolsResult = await mcp.listTools();
    debug(
      "Connected to server with tools:",
      toolsResult.tools.map(({ name }) => name)
    );
    for (const tool of toolsResult.tools) {
      this.clients.set(tool.name, mcp);
    }
    this.availableTools.push(
      ...toolsResult.tools.map((tool) => {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }
        };
      })
    );
  }
  async *processSingleTurnWithTools(messages, opts = {}) {
    debug("start of single turn");
    const stream = this.client.chatCompletionStream({
      provider: this.provider,
      model: this.model,
      messages,
      tools: opts.exitLoopTools ? [...opts.exitLoopTools, ...this.availableTools] : this.availableTools,
      tool_choice: "auto",
      signal: opts.abortSignal
    });
    const message = {
      role: "unknown",
      content: ""
    };
    const finalToolCalls = {};
    let numOfChunks = 0;
    for await (const chunk of stream) {
      if (opts.abortSignal?.aborted) {
        throw new Error("AbortError");
      }
      yield chunk;
      debug(chunk.choices[0]);
      numOfChunks++;
      const delta = chunk.choices[0]?.delta;
      if (!delta) {
        continue;
      }
      if (delta.role) {
        message.role = delta.role;
      }
      if (delta.content) {
        message.content += delta.content;
      }
      for (const toolCall of delta.tool_calls ?? []) {
        if (!finalToolCalls[toolCall.index]) {
          finalToolCalls[toolCall.index] = toolCall;
        }
        if (finalToolCalls[toolCall.index].function.arguments === void 0) {
          finalToolCalls[toolCall.index].function.arguments = "";
        }
        if (toolCall.function.arguments) {
          finalToolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
        }
      }
      if (opts.exitIfFirstChunkNoTool && numOfChunks <= 2 && Object.keys(finalToolCalls).length === 0) {
        return;
      }
    }
    messages.push(message);
    for (const toolCall of Object.values(finalToolCalls)) {
      const toolName = toolCall.function.name ?? "unknown";
      const toolArgs = toolCall.function.arguments === "" ? {} : JSON.parse(toolCall.function.arguments);
      const toolMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: "",
        name: toolName
      };
      if (opts.exitLoopTools?.map((t) => t.function.name).includes(toolName)) {
        messages.push(toolMessage);
        return yield toolMessage;
      }
      const client = this.clients.get(toolName);
      if (client) {
        const result = await client.callTool({ name: toolName, arguments: toolArgs, signal: opts.abortSignal });
        toolMessage.content = result.content[0].text;
      } else {
        toolMessage.content = `Error: No session found for tool: ${toolName}`;
      }
      messages.push(toolMessage);
      yield toolMessage;
    }
  }
  async cleanup() {
    const clients = new Set(this.clients.values());
    await Promise.all([...clients].map((client) => client.close()));
  }
  async [Symbol.dispose]() {
    return this.cleanup();
  }
};

// src/Agent.ts
var DEFAULT_SYSTEM_PROMPT = `
You are an agent - please keep going until the user\u2019s query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved, or if you need more info from the user to solve the problem.

If you are not sure about anything pertaining to the user\u2019s request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer.

You MUST plan extensively before each function call, and reflect extensively on the outcomes of the previous function calls. DO NOT do this entire process by making function calls only, as this can impair your ability to solve the problem and think insightfully.
`.trim();
var MAX_NUM_TURNS = 10;
var taskCompletionTool = {
  type: "function",
  function: {
    name: "task_complete",
    description: "Call this tool when the task given by the user is complete",
    parameters: {
      type: "object",
      properties: {}
    }
  }
};
var askQuestionTool = {
  type: "function",
  function: {
    name: "ask_question",
    description: "Ask a question to the user to get more info required to solve or clarify their problem.",
    parameters: {
      type: "object",
      properties: {}
    }
  }
};
var exitLoopTools = [taskCompletionTool, askQuestionTool];
var Agent = class extends McpClient {
  servers;
  messages;
  constructor({
    provider,
    endpointUrl,
    model,
    apiKey,
    servers,
    prompt
  }) {
    super(provider ? { provider, endpointUrl, model, apiKey } : { provider, endpointUrl, model, apiKey });
    this.servers = servers;
    this.messages = [
      {
        role: "system",
        content: prompt ?? DEFAULT_SYSTEM_PROMPT
      }
    ];
  }
  async loadTools() {
    return this.addMcpServers(this.servers);
  }
  async *run(input, opts = {}) {
    this.messages.push({
      role: "user",
      content: input
    });
    let numOfTurns = 0;
    let nextTurnShouldCallTools = true;
    while (true) {
      try {
        yield* this.processSingleTurnWithTools(this.messages, {
          exitLoopTools,
          exitIfFirstChunkNoTool: numOfTurns > 0 && nextTurnShouldCallTools,
          abortSignal: opts.abortSignal
        });
      } catch (err) {
        if (err instanceof Error && err.message === "AbortError") {
          return;
        }
        throw err;
      }
      numOfTurns++;
      const currentLast = this.messages.at(-1);
      debug("current role", currentLast.role);
      if (currentLast.role === "tool" && currentLast.name && exitLoopTools.map((t) => t.function.name).includes(currentLast.name)) {
        return;
      }
      if (currentLast.role !== "tool" && numOfTurns > MAX_NUM_TURNS) {
        return;
      }
      if (currentLast.role !== "tool" && nextTurnShouldCallTools) {
        return;
      }
      if (currentLast.role === "tool") {
        nextTurnShouldCallTools = false;
      } else {
        nextTurnShouldCallTools = true;
      }
    }
  }
};

// cli.ts
var MODEL_ID = process.env.MODEL_ID ?? "Qwen/Qwen2.5-72B-Instruct";
var PROVIDER = process.env.PROVIDER ?? "nebius";
var ENDPOINT_URL = process.env.ENDPOINT_URL ?? process.env.BASE_URL;
var MCP_EXAMPLER_LOCAL_FOLDER = process.platform === "darwin" ? (0, import_node_path.join)((0, import_node_os.homedir)(), "Desktop") : (0, import_node_os.homedir)();
var SERVERS = [
  {
    // Filesystem "official" mcp-server with access to your Desktop
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", MCP_EXAMPLER_LOCAL_FOLDER]
  },
  {
    // Playwright MCP
    command: "npx",
    args: ["@playwright/mcp@latest"]
  }
];
if (process.env.EXPERIMENTAL_HF_MCP_SERVER) {
  SERVERS.push({
    // Early version of a HF-MCP server
    // you can download it from gist.github.com/julien-c/0500ba922e1b38f2dc30447fb81f7dc6
    // and replace the local path below
    command: "node",
    args: ["--disable-warning=ExperimentalWarning", (0, import_node_path.join)((0, import_node_os.homedir)(), "Desktop/hf-mcp/index.ts")],
    env: {
      HF_TOKEN: process.env.HF_TOKEN ?? ""
    }
  });
}
async function main() {
  if (process.argv.includes("--version")) {
    console.log(version);
    process.exit(0);
  }
  if (!process.env.HF_TOKEN) {
    console.error(`a valid HF_TOKEN must be present in the env`);
    process.exit(1);
  }
  const agent = new Agent(
    ENDPOINT_URL ? {
      endpointUrl: ENDPOINT_URL,
      model: MODEL_ID,
      apiKey: process.env.HF_TOKEN,
      servers: SERVERS
    } : {
      provider: PROVIDER,
      model: MODEL_ID,
      apiKey: process.env.HF_TOKEN,
      servers: SERVERS
    }
  );
  const rl = readline.createInterface({ input: import_node_process.stdin, output: import_node_process.stdout });
  let abortController = new AbortController();
  let waitingForInput = false;
  async function waitForInput() {
    waitingForInput = true;
    const input = await rl.question("> ");
    waitingForInput = false;
    return input;
  }
  rl.on("SIGINT", async () => {
    if (waitingForInput) {
      await agent.cleanup();
      import_node_process.stdout.write("\n");
      rl.close();
    } else {
      abortController.abort();
      abortController = new AbortController();
      import_node_process.stdout.write("\n");
      import_node_process.stdout.write(ANSI.GRAY);
      import_node_process.stdout.write("Ctrl+C a second time to exit");
      import_node_process.stdout.write(ANSI.RESET);
      import_node_process.stdout.write("\n");
    }
  });
  process.on("uncaughtException", (err) => {
    import_node_process.stdout.write("\n");
    rl.close();
    throw err;
  });
  await agent.loadTools();
  import_node_process.stdout.write(ANSI.BLUE);
  import_node_process.stdout.write(`Agent loaded with ${agent.availableTools.length} tools:
`);
  import_node_process.stdout.write(agent.availableTools.map((t) => `- ${t.function.name}`).join("\n"));
  import_node_process.stdout.write(ANSI.RESET);
  import_node_process.stdout.write("\n");
  while (true) {
    const input = await waitForInput();
    for await (const chunk of agent.run(input, { abortSignal: abortController.signal })) {
      if ("choices" in chunk) {
        const delta = chunk.choices[0]?.delta;
        if (delta.content) {
          import_node_process.stdout.write(delta.content);
        }
        if (delta.tool_calls) {
          import_node_process.stdout.write(ANSI.GRAY);
          for (const deltaToolCall of delta.tool_calls) {
            if (deltaToolCall.id) {
              import_node_process.stdout.write(`<Tool ${deltaToolCall.id}>
`);
            }
            if (deltaToolCall.function.name) {
              import_node_process.stdout.write(deltaToolCall.function.name + " ");
            }
            if (deltaToolCall.function.arguments) {
              import_node_process.stdout.write(deltaToolCall.function.arguments);
            }
          }
          import_node_process.stdout.write(ANSI.RESET);
        }
      } else {
        import_node_process.stdout.write("\n\n");
        import_node_process.stdout.write(ANSI.GREEN);
        import_node_process.stdout.write(`Tool[${chunk.name}] ${chunk.tool_call_id}
`);
        import_node_process.stdout.write(chunk.content);
        import_node_process.stdout.write(ANSI.RESET);
        import_node_process.stdout.write("\n\n");
      }
    }
    import_node_process.stdout.write("\n");
  }
}
main();
