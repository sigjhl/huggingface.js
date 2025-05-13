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
var os = __toESM(require("os"));
var import_node_child_process = require("child_process");
var import_promises = require("fs/promises");

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
  YELLOW: "\x1B[33m",
  // Added
  CYAN: "\x1B[36m",
  // Added
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

// cli.ts
var currentPlatformString = os.platform();
console.log("[CLI.TS TOP LEVEL] currentPlatformString:", currentPlatformString, "Type:", typeof currentPlatformString);
var IS_TOOLS_OFF = import_node_process.env.TOOLS_OFF === "true";
var GOOGLE_API_KEY = import_node_process.env.GOOGLE_API_KEY;
var MODEL_ID = import_node_process.env.MODEL_ID ?? "Qwen/Qwen2.5-72B-Instruct";
var PROVIDER = import_node_process.env.PROVIDER ?? "nebius";
var ENDPOINT_URL = import_node_process.env.ENDPOINT_URL ?? import_node_process.env.BASE_URL;
function getEditorCommand() {
  console.log("[GET_EDITOR_COMMAND IN TS] currentPlatformString:", currentPlatformString, "Type:", typeof currentPlatformString);
  if (import_node_process.env.EDITOR) {
    return import_node_process.env.EDITOR;
  }
  switch (currentPlatformString) {
    case "win32":
      return "notepad";
    case "darwin":
      console.log("[GET_EDITOR_COMMAND IN TS] Detected darwin correctly!");
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["nano"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "nano -t";
        }
      } catch (err) {
      }
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["vim"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "vim";
        }
      } catch (err) {
      }
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["vi"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "vi";
        }
      } catch (err) {
      }
      return "open -W -t";
    default:
      console.log("[GET_EDITOR_COMMAND IN TS] Default case, platform was:", currentPlatformString);
      const editors = ["nano", "vim", "vi"];
      for (const editor of editors) {
        try {
          const result = (0, import_node_child_process.spawnSync)("which", [editor], { stdio: "pipe" });
          if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
            return editor;
          }
        } catch (err) {
        }
      }
      return "nano";
  }
}
var SERVERS;
if (IS_TOOLS_OFF) {
  SERVERS = [];
  if (import_node_process.env.DEBUG || !import_node_process.env.CI) {
    console.log(ANSI.YELLOW + "TOOLS_OFF flag is set. Running in chat-only mode. No MCP servers will be loaded." + ANSI.RESET);
  }
} else {
  SERVERS = [
    {
      command: "node",
      args: ["/Users/sigjhl/Documents/Projects/MCP/mcp-google-custom-search-server/build/index.js"],
      env: {
        GOOGLE_API_KEY,
        // Will be undefined if not set, handled by server
        GOOGLE_SEARCH_ENGINE_ID: "921d659c1c5bd4172"
      }
    },
    {
      command: "node",
      args: ["/Users/sigjhl/Documents/Projects/MCP/fetch-mcp/dist/index.js"]
    }
    // Default filesystem server (optional, added if needed, or keep for compatibility)
    // {
    // 	command: "npx",
    // 	args: ["-y", "@modelcontextprotocol/server-filesystem", join(homedir(), "Desktop")],
    // },
  ];
}
if (import_node_process.env.EXPERIMENTAL_HF_MCP_SERVER) {
  SERVERS.push({
    command: "node",
    args: ["--disable-warning=ExperimentalWarning", (0, import_node_path.join)(os.homedir(), "Desktop/hf-mcp/index.ts")],
    env: {
      HF_TOKEN: import_node_process.env.HF_TOKEN ?? ""
    }
  });
}
async function main() {
  if (process.argv.includes("--version")) {
    console.log(version);
    (0, import_node_process.exit)(0);
  }
  if (!import_node_process.env.HF_TOKEN) {
    console.error(`A valid HF_TOKEN must be present in the env`);
    (0, import_node_process.exit)(1);
  }
  const agent = new Agent(
    ENDPOINT_URL ? {
      endpointUrl: ENDPOINT_URL,
      model: MODEL_ID,
      apiKey: import_node_process.env.HF_TOKEN,
      servers: SERVERS,
      toolsOff: IS_TOOLS_OFF
      // Pass toolsOff flag
    } : {
      provider: PROVIDER,
      model: MODEL_ID,
      apiKey: import_node_process.env.HF_TOKEN,
      servers: SERVERS,
      toolsOff: IS_TOOLS_OFF
      // Pass toolsOff flag
    }
  );
  const rl = readline.createInterface({ input: import_node_process.stdin, output: import_node_process.stdout });
  let abortController = new AbortController();
  let waitingForInput = false;
  let isInEditorMode = false;
  let editorTempFilePath = null;
  async function getCustomInput() {
    import_node_process.stdout.write(ANSI.RESET);
    waitingForInput = true;
    const initialLine = await rl.question("> ");
    waitingForInput = false;
    if (initialLine.trim().toLowerCase() === "!multi") {
      const multiLineBuffer = [];
      import_node_process.stdout.write(ANSI.BLUE + "Multiline mode enabled. Type '!end' on a new line to submit.\n" + ANSI.RESET);
      while (true) {
        import_node_process.stdout.write(ANSI.RESET);
        waitingForInput = true;
        const nextLine = await rl.question("... ");
        waitingForInput = false;
        if (nextLine.trim().toLowerCase() === "!end")
          break;
        multiLineBuffer.push(nextLine);
      }
      return multiLineBuffer.join("\n");
    } else if (initialLine.trim().toLowerCase().startsWith("!edit")) {
      const editorMatch = initialLine.match(/^!edit\s+--editor\s+(\S+)\s*(.*)$/i);
      let specifiedEditor = null;
      let initialContentForEditor = "";
      if (editorMatch) {
        specifiedEditor = editorMatch[1];
        initialContentForEditor = editorMatch[2] || "";
        import_node_process.stdout.write(ANSI.BLUE + `Using specified editor: ${specifiedEditor}
` + ANSI.RESET);
      } else {
        const contentMatch = initialLine.match(/^!edit\s+(.+)$/i);
        if (contentMatch && contentMatch[1]) {
          initialContentForEditor = contentMatch[1];
        }
      }
      import_node_process.stdout.write(ANSI.BLUE + "Opening editor... Please save and close the file when done.\n" + ANSI.RESET);
      const editorCommand = specifiedEditor || getEditorCommand();
      if (editorCommand.includes("nano")) {
        import_node_process.stdout.write(ANSI.GREEN + "Using nano editor (auto-save mode): Press Ctrl+X to save and exit.\n" + ANSI.RESET);
      } else if (editorCommand === "vim" || editorCommand === "vi") {
        import_node_process.stdout.write(ANSI.GREEN + "Using vim/vi editor: Press Escape, then :wq and Enter to save and exit.\n" + ANSI.RESET);
      }
      const tempDir = os.tmpdir();
      const tempFileName = `mcp-client-input-${Date.now()}.txt`;
      const tempFilePathLocal = (0, import_node_path.join)(tempDir, tempFileName);
      isInEditorMode = true;
      editorTempFilePath = tempFilePathLocal;
      try {
        await (0, import_promises.writeFile)(tempFilePathLocal, initialContentForEditor, "utf-8");
        let editorCmdParts = editorCommand.split(" ");
        let cmd = editorCmdParts.shift();
        let args = [...editorCmdParts, tempFilePathLocal];
        if (currentPlatformString === "darwin" && cmd === "open" && editorCommand.includes("-t")) {
          args = ["-W", "-t", tempFilePathLocal];
          import_node_process.stdout.write(ANSI.YELLOW + "Warning: TextEdit can sometimes cause hanging issues. Consider EDITOR=nano/vim.\n" + ANSI.RESET);
          import_node_process.stdout.write(ANSI.YELLOW + "If CLI hangs after closing TextEdit, press Ctrl+C.\n" + ANSI.RESET);
        } else if (currentPlatformString === "darwin" && cmd === "open" && editorCommand.includes("-a")) {
          const originalEditorCmdParts = editorCommand.split(" ");
          const appNameIndex = originalEditorCmdParts.indexOf("-a") + 1;
          if (appNameIndex > 0 && appNameIndex < originalEditorCmdParts.length) {
            const appName = originalEditorCmdParts[appNameIndex];
            args = ["-W", "-a", appName, tempFilePathLocal];
          } else {
            args = [tempFilePathLocal];
          }
        }
        import_node_process.stdout.write(ANSI.BLUE + "Editor session will timeout after 5 minutes if not closed.\n" + ANSI.RESET);
        const editorProcess = (0, import_node_child_process.spawnSync)(cmd, args, {
          stdio: "inherit",
          timeout: 3e5
          // 5 minutes
        });
        if (editorProcess.error) {
          if (editorProcess.error.code === "ETIMEDOUT") {
            import_node_process.stdout.write(ANSI.RED + `Editor session timed out. Reading file as is.
` + ANSI.RESET);
          } else {
            import_node_process.stdout.write(ANSI.RED + `Error launching editor: ${editorProcess.error.message}
` + ANSI.RESET);
            return "";
          }
        }
        if (editorProcess.status !== 0 && editorProcess.status !== null) {
          import_node_process.stdout.write(ANSI.YELLOW + `Editor closed with non-zero exit code (${editorProcess.status}).
` + ANSI.RESET);
        }
        import_node_process.stdout.write(ANSI.GREEN + `Editor closed. Returning to CLI...
` + ANSI.RESET);
        const fileContent = await (0, import_promises.readFile)(tempFilePathLocal, "utf-8");
        import_node_process.stdout.write(ANSI.BLUE + `Read ${fileContent.trimEnd().length} characters from editor.
` + ANSI.RESET);
        return fileContent.trimEnd();
      } catch (err) {
        import_node_process.stdout.write(ANSI.RED + `Error during edit process: ${err.message}
` + ANSI.RESET);
        return "";
      } finally {
        isInEditorMode = false;
        if (editorTempFilePath) {
          try {
            await (0, import_promises.unlink)(editorTempFilePath);
          } catch (unlinkErr) {
            console.warn(`Failed to delete temp file: ${editorTempFilePath}`, unlinkErr.message);
          }
          editorTempFilePath = null;
        }
      }
    } else if (initialLine.trim().toLowerCase() === "exit" || initialLine.trim().toLowerCase() === "quit") {
      return initialLine.trim().toLowerCase();
    }
    return initialLine;
  }
  rl.on("SIGINT", async () => {
    if (isInEditorMode) {
      import_node_process.stdout.write("\n" + ANSI.RED + "Ctrl+C in editor mode. Attempting to clean up..." + ANSI.RESET + "\n");
      if (editorTempFilePath) {
        try {
          await (0, import_promises.unlink)(editorTempFilePath);
        } catch (e) {
        }
        editorTempFilePath = null;
      }
      isInEditorMode = false;
      import_node_process.stdout.write("> ");
    } else if (waitingForInput) {
      await agent.cleanup();
      import_node_process.stdout.write("\n");
      rl.close();
      (0, import_node_process.exit)(0);
    } else {
      abortController.abort();
      abortController = new AbortController();
      import_node_process.stdout.write("\n" + ANSI.GRAY + "Ctrl+C again to exit" + ANSI.RESET + "\n");
    }
  });
  process.on("uncaughtException", (err) => {
    import_node_process.stdout.write("\n");
    console.error("Uncaught Exception:", err);
    rl.close();
    (0, import_node_process.exit)(1);
  });
  await agent.loadTools();
  if (!IS_TOOLS_OFF) {
    import_node_process.stdout.write(ANSI.BLUE);
    if (agent.availableTools.length > 0) {
      import_node_process.stdout.write(`Agent loaded with ${agent.availableTools.length} tools:
`);
      import_node_process.stdout.write(agent.availableTools.map((t) => `- ${t.function.name}`).join("\n"));
    } else {
      import_node_process.stdout.write(`Agent loaded. No custom tools configured or available.
`);
    }
    import_node_process.stdout.write(ANSI.RESET + "\n");
  }
  import_node_process.stdout.write(ANSI.BLUE);
  import_node_process.stdout.write("Type '!multi' to enter multiple lines, then '!end' to finish.\n");
  import_node_process.stdout.write("Type '!edit' to open an editor, or '!edit some text' to pre-populate.\n");
  import_node_process.stdout.write("Use '!edit --editor vim' to specify an editor (e.g., vim, nano).\n");
  import_node_process.stdout.write("Type 'exit' or 'quit' to exit.\n");
  import_node_process.stdout.write(ANSI.RESET + "\n");
  let isThinking = false;
  const THINK_START_TAG = "<think>";
  const THINK_END_TAG = "</think>";
  while (true) {
    const input = await getCustomInput();
    if (input === "exit" || input === "quit") {
      await agent.cleanup();
      rl.close();
      import_node_process.stdout.write("Exiting agent.\n");
      break;
    }
    if (input.trim() === "") {
      continue;
    }
    for await (const chunk of agent.run(input, { abortSignal: abortController.signal })) {
      if ("choices" in chunk) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          let currentChunkContent = delta.content;
          while (currentChunkContent.length > 0) {
            if (isThinking) {
              const endTagIndex = currentChunkContent.indexOf(THINK_END_TAG);
              if (endTagIndex !== -1) {
                const textToPrint = currentChunkContent.substring(0, endTagIndex);
                if (textToPrint)
                  import_node_process.stdout.write(ANSI.YELLOW + textToPrint);
                import_node_process.stdout.write(ANSI.YELLOW + THINK_END_TAG);
                isThinking = false;
                currentChunkContent = currentChunkContent.substring(endTagIndex + THINK_END_TAG.length);
              } else {
                import_node_process.stdout.write(ANSI.YELLOW + currentChunkContent);
                currentChunkContent = "";
              }
            } else {
              const startTagIndex = currentChunkContent.indexOf(THINK_START_TAG);
              if (startTagIndex !== -1) {
                const textToPrint = currentChunkContent.substring(0, startTagIndex);
                if (textToPrint)
                  import_node_process.stdout.write(ANSI.CYAN + textToPrint);
                import_node_process.stdout.write(ANSI.YELLOW + THINK_START_TAG);
                isThinking = true;
                currentChunkContent = currentChunkContent.substring(startTagIndex + THINK_START_TAG.length);
              } else {
                import_node_process.stdout.write(ANSI.CYAN + currentChunkContent);
                currentChunkContent = "";
              }
            }
          }
        }
        if (delta?.tool_calls) {
          if (isThinking) {
            import_node_process.stdout.write(ANSI.RESET);
            isThinking = false;
          }
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
        if (isThinking) {
          import_node_process.stdout.write(ANSI.RESET);
          isThinking = false;
        }
        import_node_process.stdout.write("\n\n");
        import_node_process.stdout.write(ANSI.GREEN);
        import_node_process.stdout.write(`Tool[${chunk.name}] ${chunk.tool_call_id}
`);
        import_node_process.stdout.write(chunk.content);
        import_node_process.stdout.write(ANSI.RESET);
        import_node_process.stdout.write("\n\n");
      }
    }
    if (isThinking) {
      import_node_process.stdout.write(ANSI.RESET);
      isThinking = false;
    }
    import_node_process.stdout.write("\n");
  }
}
main().catch(async (err) => {
  console.error("CLI Error:", err);
  try {
    const agentInstance = global.agentForCleanup;
    if (agentInstance && typeof agentInstance.cleanup === "function") {
      await agentInstance.cleanup();
    }
  } catch (cleanupErr) {
    console.error("Error during cleanup:", cleanupErr);
  }
  (0, import_node_process.exit)(1);
});
