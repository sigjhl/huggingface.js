// src/McpClient.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InferenceClient } from "@huggingface/inference";

// package.json
var version = "0.1.3";

// src/utils.ts
import { inspect } from "util";
function debug(...args) {
  if (process.env.DEBUG) {
    console.debug(inspect(args, { depth: Infinity, colors: true }));
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
    this.client = endpointUrl ? new InferenceClient(apiKey, { endpointUrl }) : new InferenceClient(apiKey);
    this.provider = provider;
    this.model = model;
  }
  async addMcpServers(servers) {
    await Promise.all(servers.map((s) => this.addMcpServer(s)));
  }
  async addMcpServer(server) {
    const transport = new StdioClientTransport({
      ...server,
      env: { ...server.env, PATH: process.env.PATH ?? "" }
    });
    const mcp = new Client({ name: "@huggingface/mcp-client", version });
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

export {
  version,
  ANSI,
  McpClient,
  Agent
};
