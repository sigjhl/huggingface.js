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
var import_node_child_process = require("child_process");
var import_node_fs_promises = require("fs/promises");
const IS_TOOLS_OFF = process.env.TOOLS_OFF === 'true';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;


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
  CYAN: "\x1B[36m", // For regular assistant responses
  RESET: "\x1B[0m"
};

// Get the appropriate editor command for the current platform
function getEditorCommand() {
  // First, check if EDITOR environment variable is set
  if (process.env.EDITOR) {
    return process.env.EDITOR;
  }

  // Otherwise, use platform-specific defaults
  switch (process.platform) {
    case "win32":
      return "notepad";
    case "darwin": // macOS
      // Always prefer nano on macOS for the best CLI experience
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["nano"], { stdio: "pipe" });
        if (result.status === 0) {
          // Return nano with just the auto-save flag (-t) which is compatible with pico
          return "nano -t";
        }
      } catch (err) {
        // Ignore error and try other editors
      }

      // Fall back to vim or vi if nano is not available
      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["vim"], { stdio: "pipe" });
        if (result.status === 0) {
          return "vim";
        }
      } catch (err) {
        // Ignore error and try vi
      }

      try {
        const result = (0, import_node_child_process.spawnSync)("which", ["vi"], { stdio: "pipe" });
        if (result.status === 0) {
          return "vi";
        }
      } catch (err) {
        // Fall back to TextEdit
      }

      // Last resort, use TextEdit (but this is not recommended)
      return "open -W -t";
    default: // Linux and others
      // Try to find a common editor in this order
      const editors = ["nano", "vim", "vi"];
      for (const editor of editors) {
        try {
          // Check if editor exists by running 'which'
          const result = (0, import_node_child_process.spawnSync)("which", [editor], { stdio: "pipe" });
          if (result.status === 0) {
            return editor;
          }
        } catch (err) {
          // Continue to the next editor if not found
        }
      }
      return "nano"; // Default to nano if nothing else works
  }
}

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
    const streamParams = {
      // provider: this.provider, // Only include if 'provider' is used, not 'endpointUrl' for InferenceClient
      model: this.model,
      messages,
      tools: opts.exitLoopTools ? [...opts.exitLoopTools, ...this.availableTools] : this.availableTools,
      tool_choice: "auto",
      signal: opts.abortSignal
    };
    if (this.temperature !== undefined) {
      streamParams.temperature = this.temperature;
    }
    if (this.topP !== undefined) {
      streamParams.top_p = this.topP; // Standard OpenAI parameter name
    }
    if (this.topK !== undefined) {
      streamParams.top_k = this.topK; // Standard OpenAI parameter name
    }
    if (this.provider && !this.client.endpointUrl) { // this.client.endpointUrl is from InferenceClient's options
      streamParams.provider = this.provider;
    }
    // Prepare the list of all tools the LLM should know about for this turn
    // opts.exitLoopTools is passed from Agent.run and is already conditional on IS_TOOLS_OFF
    const allToolsForLLM = [];
    if (opts.exitLoopTools && opts.exitLoopTools.length > 0) { // exitLoopTools will be [] if IS_TOOLS_OFF
        allToolsForLLM.push(...opts.exitLoopTools);
    }
    if (this.availableTools && this.availableTools.length > 0) { // this.availableTools will be [] if IS_TOOLS_OFF
        allToolsForLLM.push(...this.availableTools);
    }

    // Only add tools and tool_choice to the API call if there are actually any tools
    if (allToolsForLLM.length > 0) {
      streamParams.tools = allToolsForLLM;
      streamParams.tool_choice = "auto"; // Or "any" or other strategies if needed
    }
    // If allToolsForLLM is empty, 'tools' and 'tool_choice' are omitted, signaling no tools to the LLM.
    debug("Calling chatCompletionStream with params:", streamParams); // Optional: for debugging
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
// var DEFAULT_SYSTEM_PROMPT = `
// You are an agent - please keep going until the user\u2019s query is completely resolved, before ending your turn and yielding back to the user. Only terminate your turn when you are sure that the problem is solved, or if you need more info from the user to solve the problem.

// If you are not sure about anything pertaining to the user\u2019s request, use your tools to read files and gather the relevant information: do NOT guess or make up an answer.

// You MUST plan extensively before each function call, and reflect extensively on the outcomes of the previous function calls. DO NOT do this entire process by making function calls only, as this can impair your ability to solve the problem and think insightfully.
// `.trim();

// var DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant. 

// You must keep using tools, sequentially, until you arrive at an answer. 
// Do not be lazy. Use additional tool calls eagerly. 
// `;

let systemPromptCore;

if (IS_TOOLS_OFF) {
  systemPromptCore = `You are a helpful assistant.`;
} else {
  // For Qwen, a general prompt is often best, letting the endpoint handle tool formatting.
  // If your endpoint doesn't auto-inject Qwen's tool instructions, you might need to be more explicit here.
  systemPromptCore = `You are a helpful assistant. 
  You must keep using tools, sequentially, until you arrive at an answer. 
  Do not be lazy. Use additional tool calls eagerly. 
  `
}

const currentDate = new Date();
const formattedDate = currentDate.toLocaleDateString('en-US', { // Or your preferred locale
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}); 

var DEFAULT_SYSTEM_PROMPT = systemPromptCore; // <-- INITIALIZE HERE

DEFAULT_SYSTEM_PROMPT += `\n\nToday's date is ${formattedDate}. Please use this information if the user's query is time-sensitive or implies current knowledge.`;
DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT.trim();
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
var exitLoopTools = []//[taskCompletionTool, askQuestionTool];
var Agent = class extends McpClient {
  servers;
  messages;
  temperature;
  topP;
  topK;
  constructor({
    provider,
    endpointUrl,
    model,
    apiKey,
    servers,
    prompt,
    temperature,
    topP,
    topK
  }) {
    super(provider ? { provider, endpointUrl, model, apiKey } : { provider, endpointUrl, model, apiKey });
    this.servers = servers;
    this.messages = [
      {
        role: "system",
        content: prompt ?? DEFAULT_SYSTEM_PROMPT
      }
    ];
    this.temperature = temperature;
    this.topP = topP;
    this.topK = topK;
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
// var SERVERS = [
//   {
//     // Filesystem "official" mcp-server with access to your Desktop
//     command: "npx",
//     args: ["-y", "@modelcontextprotocol/server-filesystem", (0, import_node_path.join)((0, import_node_os.homedir)(), "Desktop")]
//   },
//   {
//     // Playwright MCP
//     command: "npx",
//     args: ["@playwright/mcp@latest"]
//   }
// ];

// var SERVERS = [
//     // google-search server configuration
//     {
//       command: "node", // The command to execute
//       args: [
//         // Arguments for the command
//         "/Users/sigjhl/Documents/Projects/MCP/mcp-google-custom-search-server/build/index.js"
//       ],
//       env: {
//         // Environment variables for the server process
//         GOOGLE_API_KEY: GOOGLE_API_KEY,
//         GOOGLE_SEARCH_ENGINE_ID: "921d659c1c5bd4172"
//         // NOTE: The script also adds PATH automatically later when spawning
//       }
//     },
//     // fetch server configuration
//     {
//       command: "node", // The command to execute
//       args: [
//         // Arguments for the command
//         "/Users/sigjhl/Documents/Projects/MCP/fetch-mcp/dist/index.js"
//       ]
//       // No 'env' was specified for this server in your config, so it's omitted here.
//       // The script will still add PATH automatically later.
//     }
// ]

var SERVERS;
  if (IS_TOOLS_OFF) { // Use the global IS_TOOLS_OFF
    SERVERS = [];
    if (process.env.DEBUG || !process.env.CI) { // Avoid logging in CI, show if debugging or interactive
        console.log(ANSI.YELLOW + "TOOLS_OFF flag is set. Running in chat-only mode. No MCP servers will be loaded." + ANSI.RESET);
    }
  } else {
    SERVERS = [
      // Your google-search server configuration
      {
        command: "node",
        args: ["/Users/sigjhl/Documents/Projects/MCP/mcp-google-custom-search-server/build/index.js"],
        env: {
          GOOGLE_API_KEY: GOOGLE_API_KEY,
          GOOGLE_SEARCH_ENGINE_ID: "921d659c1c5bd4172"
        }
      },
      // Your fetch server configuration
      {
        command: "node",
        args: ["/Users/sigjhl/Documents/Projects/MCP/fetch-mcp/dist/index.js"]
      }
    ];
  }

if (process.env.EXPERIMENTAL_HF_MCP_SERVER) {
  SERVERS.push({
    // Early version of a HF-MCP server
    // you can download it from gist.github.com/julien-c/0500ba922e1b38f2dc30447fb81f7dc6
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
  const TEMPERATURE = process.env.TEMPERATURE ? parseFloat(process.env.TEMPERATURE) : undefined; // Default: undefined (let the API decide or use its default)
  const TOP_P = process.env.TOP_P ? parseFloat(process.env.TOP_P) : undefined; // Default: undefined
  const TOP_K = process.env.TOP_K ? parseInt(process.env.TOP_K) : undefined;   // Default: undefined
  const agent = new Agent(
    ENDPOINT_URL ? {
      endpointUrl: ENDPOINT_URL,
      model: MODEL_ID,
      apiKey: process.env.HF_TOKEN,
      servers: SERVERS,
      temperature: TEMPERATURE,
      topP: TOP_P,
      topK: TOP_K
    } : {
      provider: PROVIDER,
      model: MODEL_ID,
      apiKey: process.env.HF_TOKEN,
      servers: SERVERS,
      temperature: TEMPERATURE,
      topP: TOP_P,
      topK: TOP_K
    }
  );
  const rl = readline.createInterface({ input: import_node_process.stdin, output: import_node_process.stdout });
  let abortController = new AbortController();
  let waitingForInput = false;
  
  // New input function def
  async function getCustomInput() {
    import_node_process.stdout.write(ANSI.RESET);

    waitingForInput = true;
    let initialLine = await rl.question("> ");
    waitingForInput = false;

    if (initialLine.trim().toLowerCase() === "!multi") {
      let multiLineBuffer = [];
      import_node_process.stdout.write(ANSI.BLUE + "Multiline mode enabled. Type '!end' on a new line to submit.\n" + ANSI.RESET);
      while (true) {
        import_node_process.stdout.write(ANSI.RESET);
        waitingForInput = true;
        const nextLine = await rl.question("... ");
        waitingForInput = false;

        if (nextLine.trim().toLowerCase() === "!end") {
          break;
        }
        multiLineBuffer.push(nextLine);
      }
      return multiLineBuffer.join("\n");
    } else if (initialLine.trim().toLowerCase().startsWith("!edit")) {
      // Check for editor specification in the command
      const editorMatch = initialLine.match(/^!edit\s+--editor\s+(\S+)\s*(.*)$/i);
      let specifiedEditor = null;
      let initialContent = '';

      if (editorMatch) {
        // User specified an editor with --editor flag
        specifiedEditor = editorMatch[1];
        initialContent = editorMatch[2] || '';
        import_node_process.stdout.write(ANSI.BLUE + `Using specified editor: ${specifiedEditor}\n` + ANSI.RESET);
      }

      // External editor mode
      import_node_process.stdout.write(ANSI.BLUE + "Opening editor... Please save and close the file when done.\n" + ANSI.RESET);

      // Determine which editor will be used
      const editorCommand = specifiedEditor || getEditorCommand();

      // Show editor-specific instructions
      if (editorCommand.includes("nano")) {
        import_node_process.stdout.write(ANSI.GREEN + "Using nano editor (auto-save mode): Press Ctrl+X to save and exit when done.\n" + ANSI.RESET);
      } else if (editorCommand === "vim" || editorCommand === "vi") {
        import_node_process.stdout.write(ANSI.GREEN + "Using vim/vi editor: Press Escape, then :wq and Enter to save and exit.\n" + ANSI.RESET);
      }

      // Create a temporary file with a consistent name (makes it easier to recognize in the editor)
      const tempDir = (0, import_node_os.tmpdir)();
      const tempFileName = `mcp-client-input.txt`;
      const tempFilePath = (0, import_node_path.join)(tempDir, tempFileName);

      // Set editor mode flag and save the temp file path
      isInEditorMode = true;
      editorTempFilePath = tempFilePath;

      try {
        // Check if we have initial content to pre-populate the editor with
        let initialContent = '';

        // If not already set by --editor flag, check for initial content
        if (!editorMatch) {
          const match = initialLine.match(/^!edit\s+(.+)$/i);
          if (match && match[1]) {
            initialContent = match[1];
          }
        }

        // Create the file with initial content
        await (0, import_node_fs_promises.writeFile)(tempFilePath, initialContent, 'utf-8');

        // Use the already determined editor command
        let editorCmd, editorArgs;

        // Handle special case for macOS
        if (process.platform === "darwin") {
          // Check if the command is the open command that launches TextEdit
          if (editorCommand.startsWith("open") && editorCommand.includes("-t")) {
            // Warn about potential issues with TextEdit
            import_node_process.stdout.write(ANSI.YELLOW + "Warning: TextEdit can sometimes cause hanging issues. " +
              "Consider setting the EDITOR environment variable to 'nano' or 'vim'.\n" + ANSI.RESET);
            import_node_process.stdout.write(ANSI.YELLOW + "If the CLI hangs after closing TextEdit, press Ctrl+C to continue.\n" + ANSI.RESET);

            editorCmd = "open";
            editorArgs = ["-W", "-t", tempFilePath]; // -W flag waits for the app to close
          }
          // Check if it's another app specified with open -a
          else if (editorCommand.startsWith("open") && editorCommand.includes("-a")) {
            const appName = editorCommand.split("-a ")[1].trim();
            editorCmd = "open";
            editorArgs = ["-W", "-a", appName, tempFilePath];
          }
          // If it's the open command without special args
          else if (editorCommand.startsWith("open")) {
            editorCmd = "open";
            editorArgs = [tempFilePath];
          }
          // Otherwise it's a terminal editor like nano or vim
          else {
            const parts = editorCommand.split(" ");
            editorCmd = parts[0];
            editorArgs = [...parts.slice(1), tempFilePath];
          }
        } else {
          // For other editors, split the command and arguments
          const parts = editorCommand.split(" ");
          editorCmd = parts[0];
          editorArgs = [...parts.slice(1), tempFilePath];
        }

        // Launch the editor and wait for it to close
        // Set a timeout (5 minutes) to prevent the CLI from getting stuck indefinitely
        import_node_process.stdout.write(ANSI.BLUE + "Editor session will timeout after 5 minutes if not closed.\n" + ANSI.RESET);

        const editorProcess = (0, import_node_child_process.spawnSync)(editorCmd, editorArgs, {
          stdio: "inherit", // Redirect stdio to allow the user to interact with the editor
          timeout: 300000 // 5 minute timeout (in milliseconds)
        });

        // Check for errors in the editor process
        if (editorProcess.error) {
          // Handle different error types
          if (editorProcess.error.code === 'ETIMEDOUT') {
            import_node_process.stdout.write(ANSI.RED + `Editor session timed out after 5 minutes. Reading the file as is.\n` + ANSI.RESET);
          } else {
            import_node_process.stdout.write(ANSI.RED + `Error launching editor: ${editorProcess.error.message}\n` + ANSI.RESET);
            return "";
          }
        }

        if (editorProcess.status !== 0 && editorProcess.status !== null) {
          import_node_process.stdout.write(ANSI.YELLOW + `Editor closed with non-zero exit code (${editorProcess.status}). Input might be incomplete.\n` + ANSI.RESET);
        }

        // Add a clear indicator that we're back in the CLI
        import_node_process.stdout.write(ANSI.GREEN + `Editor closed. Returning to CLI...\n` + ANSI.RESET);

        // Read the file content
        const fileContent = await (0, import_node_fs_promises.readFile)(tempFilePath, 'utf-8');

        // Trim trailing whitespace but preserve intentional newlines within the content
        const trimmedContent = fileContent.trimEnd();

        // Show a preview/confirmation of the content length
        import_node_process.stdout.write(ANSI.BLUE + `Read ${trimmedContent.length} characters from editor.\n` + ANSI.RESET);

        // Reset editor mode flags
        isInEditorMode = false;
        editorTempFilePath = null;

        return trimmedContent;
      } catch (err) {
        import_node_process.stdout.write(ANSI.RED + `Error during edit process: ${err.message}\n` + ANSI.RESET);

        // Reset editor mode flags on error
        isInEditorMode = false;
        editorTempFilePath = null;

        return "";
      } finally {
        // Clean up the temporary file
        try {
          await (0, import_node_fs_promises.unlink)(tempFilePath);
        } catch (unlinkErr) {
          // Just log cleanup errors without failing
          console.warn(`Failed to delete temporary file: ${tempFilePath}`, unlinkErr);
        }
      }
    } else if (initialLine.trim().toLowerCase() === "exit" || initialLine.trim().toLowerCase() === "quit") {
      return initialLine.trim().toLowerCase();
    } else {
      return initialLine;
    }
  }

  let isThinking = false; // State variable for thinking blocks
  const THINK_START_TAG = "<think>";
  const THINK_END_TAG = "</think>";

  //old input function
  // async function waitForInput() {
  //   waitingForInput = true;
  //   const input = await rl.question("> ");
  //   waitingForInput = false;
  //   return input;
  // }

  // Track if we're in editor mode
  let isInEditorMode = false;
  let editorTempFilePath = null;

  rl.on("SIGINT", async () => {
    if (isInEditorMode) {
      // We're in editor mode, handle the interrupt
      import_node_process.stdout.write("\n");
      import_node_process.stdout.write(ANSI.RED);
      import_node_process.stdout.write("Detected Ctrl+C while waiting for editor. Attempting to force exit editor mode...");
      import_node_process.stdout.write(ANSI.RESET);
      import_node_process.stdout.write("\n");

      // Clean up temp file if it exists
      if (editorTempFilePath) {
        try {
          await (0, import_node_fs_promises.unlink)(editorTempFilePath);
        } catch (err) {
          // Ignore errors during cleanup
        }
        editorTempFilePath = null;
      }

      isInEditorMode = false;
      // Return to the prompt
      import_node_process.stdout.write("> ");
    }
    else if (waitingForInput) {
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
  if (!IS_TOOLS_OFF) { // Use the global IS_TOOLS_OFF
    import_node_process.stdout.write(ANSI.BLUE);
    // agent.availableTools will be empty if currentServers was empty
    if (agent.availableTools.length > 0) {
        import_node_process.stdout.write(`Agent loaded with ${agent.availableTools.length} tools:\n`);
        import_node_process.stdout.write(agent.availableTools.map((t) => `- ${t.function.name}`).join("\n"));
    } else {
        import_node_process.stdout.write(`Agent loaded. No custom tools configured or available.\n`);
    }
    import_node_process.stdout.write(ANSI.RESET);
    import_node_process.stdout.write("\n");
  }

  // ADDED USER INSTRUCTIONS
  import_node_process.stdout.write(ANSI.BLUE);
  import_node_process.stdout.write("Type '!multi' to enter multiple lines, then '!end' to finish.\n");
  import_node_process.stdout.write("Type '!edit' to open nano (just press Ctrl+X to save and exit), or '!edit text' to pre-populate it.\n");
  import_node_process.stdout.write("Type 'exit' or 'quit' to exit.\n");
  import_node_process.stdout.write(ANSI.RESET);
  import_node_process.stdout.write("\n");

  while (true) {
    const input = await getCustomInput();
    // HANDLE EXIT COMMANDS
    if (input === "exit" || input === "quit") {
      await agent.cleanup();
      rl.close();
      import_node_process.stdout.write("Exiting agent.\n");
      break;
    }

    // SKIP EMPTY INPUT
    if (input.trim() === "") {
        continue;
    }

    for await (const chunk of agent.run(input, { abortSignal: abortController.signal })) {
      if ("choices" in chunk) {
        const delta = chunk.choices[0]?.delta;
        if (delta.content) {
          let currentChunkContent = delta.content;

          while (currentChunkContent.length > 0) {
            if (isThinking) { // Currently inside a <think>...</think> block
              const endTagIndex = currentChunkContent.indexOf(THINK_END_TAG);
              if (endTagIndex !== -1) {
                // Found </think>. Text before it is YELLOW. Tag itself is YELLOW.
                const textToPrint = currentChunkContent.substring(0, endTagIndex);
                if (textToPrint.length > 0) {
                  import_node_process.stdout.write(ANSI.YELLOW + textToPrint);
                }
                // Print the </think> tag itself in YELLOW
                import_node_process.stdout.write(ANSI.YELLOW + THINK_END_TAG);
                isThinking = false; // Exit thinking mode
                currentChunkContent = currentChunkContent.substring(endTagIndex + THINK_END_TAG.length);
                // Any subsequent text in this chunk will be processed as non-thinking (CYAN) in the next loop iteration.
                // If </think> was the last thing and it was yellow, next output will be cyan or reset.
                // No explicit reset here, as the next content will dictate its color.
              } else {
                // No </think> tag in this part of the chunk, print all of it as YELLOW.
                import_node_process.stdout.write(ANSI.YELLOW + currentChunkContent);
                currentChunkContent = ""; // All of this part of the chunk processed.
              }
            } else { // Not currently in a thinking block. Expecting normal assistant text (CYAN) or a new <think> tag.
              const startTagIndex = currentChunkContent.indexOf(THINK_START_TAG);
              if (startTagIndex !== -1) {
                // Found <think>. Text before it is CYAN. Tag itself is YELLOW.
                const textToPrint = currentChunkContent.substring(0, startTagIndex);
                if (textToPrint.length > 0) {
                  import_node_process.stdout.write(ANSI.CYAN + textToPrint);
                }
                // Print the <think> tag itself in YELLOW
                import_node_process.stdout.write(ANSI.YELLOW + THINK_START_TAG);
                isThinking = true; // Enter thinking mode
                currentChunkContent = currentChunkContent.substring(startTagIndex + THINK_START_TAG.length);
                // Any subsequent text in this chunk (after <think>) will be processed as thinking (YELLOW) in the next loop iteration.
              } else {
                // No <think> tag in this part of the chunk, print all of it as CYAN.
                import_node_process.stdout.write(ANSI.CYAN + currentChunkContent);
                currentChunkContent = ""; // All of this part of the chunk processed.
              }
            }
          }
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
