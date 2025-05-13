"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Agent: () => Agent,
  McpClient: () => McpClient
});
module.exports = __toCommonJS(src_exports);

// src/McpClient.ts
var import_client = require("@modelcontextprotocol/sdk/client/index.js");
var import_stdio = require("@modelcontextprotocol/sdk/client/stdio.js");
var import_inference = require("@huggingface/inference");

// package.json
var version = "0.1.3";

// src/utils.ts
var import_util = require("util");
function debug(...args) {
  if (process.env.DEBUG) {
    console.debug((0, import_util.inspect)(args, { depth: Infinity, colors: true }));
  }
}

// src/McpClient.ts
var McpClient = class {
  client;
  provider;
  clientEndpointUrl;
  // Store endpointUrl if provided
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
    this.clientEndpointUrl = endpointUrl;
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
    const streamParams = {
      model: this.model,
      messages,
      signal: opts.abortSignal
      // tools and tool_choice will be added conditionally below
    };
    if (this.provider && !this.clientEndpointUrl) {
      streamParams.provider = this.provider;
    }
    const allToolsForLLM = [];
    if (opts.exitLoopTools && opts.exitLoopTools.length > 0) {
      allToolsForLLM.push(...opts.exitLoopTools);
    }
    if (this.availableTools && this.availableTools.length > 0) {
      allToolsForLLM.push(...this.availableTools);
    }
    if (allToolsForLLM.length > 0) {
      streamParams.tools = allToolsForLLM;
      streamParams.tool_choice = "auto";
    }
    debug("Calling chatCompletionStream with params:", streamParams);
    const stream = this.client.chatCompletionStream(streamParams);
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
          finalToolCalls[toolCall.index] = { ...toolCall, function: { ...toolCall.function, arguments: "" } };
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
      const toolArgsString = toolCall.function.arguments ?? "";
      const toolArgs = toolArgsString === "" ? {} : JSON.parse(toolArgsString);
      const toolMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        // Assuming id will always be present for a tool_call
        content: "",
        name: toolName
      };
      const isExitTool = opts.exitLoopTools?.some((et) => et.function.name === toolName);
      if (isExitTool) {
        messages.push(toolMessage);
        yield toolMessage;
        return;
      }
      const client = this.clients.get(toolName);
      if (client) {
        try {
          const result = await client.callTool({ name: toolName, arguments: toolArgs, signal: opts.abortSignal });
          toolMessage.content = result.content[0]?.text ?? JSON.stringify(result.content);
        } catch (e) {
          toolMessage.content = `Error calling tool ${toolName}: ${e.message}`;
          console.error(`Error during tool call to ${toolName}:`, e);
        }
      } else {
        toolMessage.content = `Error: No client session found for tool: ${toolName}`;
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
var MAX_NUM_TURNS = 10;
var exitLoopTools = [];
var Agent = class extends McpClient {
  servers;
  messages;
  toolsOff;
  constructor({
    provider,
    endpointUrl,
    model,
    apiKey,
    servers,
    prompt,
    toolsOff
    // Added
  }) {
    super(provider ? { provider, endpointUrl, model, apiKey } : { provider, endpointUrl, model, apiKey });
    this.servers = servers;
    this.toolsOff = toolsOff ?? false;
    let actualSystemPrompt;
    if (prompt) {
      actualSystemPrompt = prompt;
    } else {
      let systemPromptCore;
      if (this.toolsOff) {
        systemPromptCore = `You are a helpful assistant.`;
      } else {
        systemPromptCore = `You are a helpful assistant. 
You must keep using tools, sequentially, until you arrive at an answer. 
Do not be lazy. Use additional tool calls eagerly. 
`;
      }
      const currentDate = /* @__PURE__ */ new Date();
      const formattedDate = currentDate.toLocaleDateString("en-US", {
        // Or your preferred locale
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      });
      actualSystemPrompt = systemPromptCore.trim();
      actualSystemPrompt += `

Today's date is ${formattedDate}. Please use this information if the user's query is time-sensitive or implies current knowledge.`;
      actualSystemPrompt = actualSystemPrompt.trim();
    }
    this.messages = [
      {
        role: "system",
        content: actualSystemPrompt
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
          // This is the empty constant from Agent.ts
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Agent,
  McpClient
});
