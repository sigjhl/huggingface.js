#!/usr/bin/env node
import {
  ANSI,
  Agent,
  version
} from "./chunk-WL6FLAUM.mjs";

// cli.ts
import * as readline from "readline/promises";
import { stdin, stdout, exit as processExit, env as processEnv } from "process";
import { join } from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { writeFile as fsWriteFile, readFile as fsReadFile, unlink as fsUnlink } from "fs/promises";
var currentPlatformString = os.platform();
console.log("[CLI.TS TOP LEVEL] currentPlatformString:", currentPlatformString, "Type:", typeof currentPlatformString);
var IS_TOOLS_OFF = processEnv.TOOLS_OFF === "true";
var GOOGLE_API_KEY = processEnv.GOOGLE_API_KEY;
var MODEL_ID = processEnv.MODEL_ID ?? "Qwen/Qwen2.5-72B-Instruct";
var PROVIDER = processEnv.PROVIDER ?? "nebius";
var ENDPOINT_URL = processEnv.ENDPOINT_URL ?? processEnv.BASE_URL;
function getEditorCommand() {
  console.log("[GET_EDITOR_COMMAND IN TS] currentPlatformString:", currentPlatformString, "Type:", typeof currentPlatformString);
  if (processEnv.EDITOR) {
    return processEnv.EDITOR;
  }
  switch (currentPlatformString) {
    case "win32":
      return "notepad";
    case "darwin":
      console.log("[GET_EDITOR_COMMAND IN TS] Detected darwin correctly!");
      try {
        const result = spawnSync("which", ["nano"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "nano -t";
        }
      } catch (err) {
      }
      try {
        const result = spawnSync("which", ["vim"], { stdio: "pipe" });
        if (result.status === 0 && result.stdout && result.stdout.toString().trim().length > 0) {
          return "vim";
        }
      } catch (err) {
      }
      try {
        const result = spawnSync("which", ["vi"], { stdio: "pipe" });
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
          const result = spawnSync("which", [editor], { stdio: "pipe" });
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
  if (processEnv.DEBUG || !processEnv.CI) {
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
if (processEnv.EXPERIMENTAL_HF_MCP_SERVER) {
  SERVERS.push({
    command: "node",
    args: ["--disable-warning=ExperimentalWarning", join(os.homedir(), "Desktop/hf-mcp/index.ts")],
    env: {
      HF_TOKEN: processEnv.HF_TOKEN ?? ""
    }
  });
}
async function main() {
  if (process.argv.includes("--version")) {
    console.log(version);
    processExit(0);
  }
  if (!processEnv.HF_TOKEN) {
    console.error(`A valid HF_TOKEN must be present in the env`);
    processExit(1);
  }
  const agent = new Agent(
    ENDPOINT_URL ? {
      endpointUrl: ENDPOINT_URL,
      model: MODEL_ID,
      apiKey: processEnv.HF_TOKEN,
      servers: SERVERS,
      toolsOff: IS_TOOLS_OFF
      // Pass toolsOff flag
    } : {
      provider: PROVIDER,
      model: MODEL_ID,
      apiKey: processEnv.HF_TOKEN,
      servers: SERVERS,
      toolsOff: IS_TOOLS_OFF
      // Pass toolsOff flag
    }
  );
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let abortController = new AbortController();
  let waitingForInput = false;
  let isInEditorMode = false;
  let editorTempFilePath = null;
  async function getCustomInput() {
    stdout.write(ANSI.RESET);
    waitingForInput = true;
    const initialLine = await rl.question("> ");
    waitingForInput = false;
    if (initialLine.trim().toLowerCase() === "!multi") {
      const multiLineBuffer = [];
      stdout.write(ANSI.BLUE + "Multiline mode enabled. Type '!end' on a new line to submit.\n" + ANSI.RESET);
      while (true) {
        stdout.write(ANSI.RESET);
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
        stdout.write(ANSI.BLUE + `Using specified editor: ${specifiedEditor}
` + ANSI.RESET);
      } else {
        const contentMatch = initialLine.match(/^!edit\s+(.+)$/i);
        if (contentMatch && contentMatch[1]) {
          initialContentForEditor = contentMatch[1];
        }
      }
      stdout.write(ANSI.BLUE + "Opening editor... Please save and close the file when done.\n" + ANSI.RESET);
      const editorCommand = specifiedEditor || getEditorCommand();
      if (editorCommand.includes("nano")) {
        stdout.write(ANSI.GREEN + "Using nano editor (auto-save mode): Press Ctrl+X to save and exit.\n" + ANSI.RESET);
      } else if (editorCommand === "vim" || editorCommand === "vi") {
        stdout.write(ANSI.GREEN + "Using vim/vi editor: Press Escape, then :wq and Enter to save and exit.\n" + ANSI.RESET);
      }
      const tempDir = os.tmpdir();
      const tempFileName = `mcp-client-input-${Date.now()}.txt`;
      const tempFilePathLocal = join(tempDir, tempFileName);
      isInEditorMode = true;
      editorTempFilePath = tempFilePathLocal;
      try {
        await fsWriteFile(tempFilePathLocal, initialContentForEditor, "utf-8");
        let editorCmdParts = editorCommand.split(" ");
        let cmd = editorCmdParts.shift();
        let args = [...editorCmdParts, tempFilePathLocal];
        if (currentPlatformString === "darwin" && cmd === "open" && editorCommand.includes("-t")) {
          args = ["-W", "-t", tempFilePathLocal];
          stdout.write(ANSI.YELLOW + "Warning: TextEdit can sometimes cause hanging issues. Consider EDITOR=nano/vim.\n" + ANSI.RESET);
          stdout.write(ANSI.YELLOW + "If CLI hangs after closing TextEdit, press Ctrl+C.\n" + ANSI.RESET);
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
        stdout.write(ANSI.BLUE + "Editor session will timeout after 5 minutes if not closed.\n" + ANSI.RESET);
        const editorProcess = spawnSync(cmd, args, {
          stdio: "inherit",
          timeout: 3e5
          // 5 minutes
        });
        if (editorProcess.error) {
          if (editorProcess.error.code === "ETIMEDOUT") {
            stdout.write(ANSI.RED + `Editor session timed out. Reading file as is.
` + ANSI.RESET);
          } else {
            stdout.write(ANSI.RED + `Error launching editor: ${editorProcess.error.message}
` + ANSI.RESET);
            return "";
          }
        }
        if (editorProcess.status !== 0 && editorProcess.status !== null) {
          stdout.write(ANSI.YELLOW + `Editor closed with non-zero exit code (${editorProcess.status}).
` + ANSI.RESET);
        }
        stdout.write(ANSI.GREEN + `Editor closed. Returning to CLI...
` + ANSI.RESET);
        const fileContent = await fsReadFile(tempFilePathLocal, "utf-8");
        stdout.write(ANSI.BLUE + `Read ${fileContent.trimEnd().length} characters from editor.
` + ANSI.RESET);
        return fileContent.trimEnd();
      } catch (err) {
        stdout.write(ANSI.RED + `Error during edit process: ${err.message}
` + ANSI.RESET);
        return "";
      } finally {
        isInEditorMode = false;
        if (editorTempFilePath) {
          try {
            await fsUnlink(editorTempFilePath);
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
      stdout.write("\n" + ANSI.RED + "Ctrl+C in editor mode. Attempting to clean up..." + ANSI.RESET + "\n");
      if (editorTempFilePath) {
        try {
          await fsUnlink(editorTempFilePath);
        } catch (e) {
        }
        editorTempFilePath = null;
      }
      isInEditorMode = false;
      stdout.write("> ");
    } else if (waitingForInput) {
      await agent.cleanup();
      stdout.write("\n");
      rl.close();
      processExit(0);
    } else {
      abortController.abort();
      abortController = new AbortController();
      stdout.write("\n" + ANSI.GRAY + "Ctrl+C again to exit" + ANSI.RESET + "\n");
    }
  });
  process.on("uncaughtException", (err) => {
    stdout.write("\n");
    console.error("Uncaught Exception:", err);
    rl.close();
    processExit(1);
  });
  await agent.loadTools();
  if (!IS_TOOLS_OFF) {
    stdout.write(ANSI.BLUE);
    if (agent.availableTools.length > 0) {
      stdout.write(`Agent loaded with ${agent.availableTools.length} tools:
`);
      stdout.write(agent.availableTools.map((t) => `- ${t.function.name}`).join("\n"));
    } else {
      stdout.write(`Agent loaded. No custom tools configured or available.
`);
    }
    stdout.write(ANSI.RESET + "\n");
  }
  stdout.write(ANSI.BLUE);
  stdout.write("Type '!multi' to enter multiple lines, then '!end' to finish.\n");
  stdout.write("Type '!edit' to open an editor, or '!edit some text' to pre-populate.\n");
  stdout.write("Use '!edit --editor vim' to specify an editor (e.g., vim, nano).\n");
  stdout.write("Type 'exit' or 'quit' to exit.\n");
  stdout.write(ANSI.RESET + "\n");
  let isThinking = false;
  const THINK_START_TAG = "<think>";
  const THINK_END_TAG = "</think>";
  while (true) {
    const input = await getCustomInput();
    if (input === "exit" || input === "quit") {
      await agent.cleanup();
      rl.close();
      stdout.write("Exiting agent.\n");
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
                  stdout.write(ANSI.YELLOW + textToPrint);
                stdout.write(ANSI.YELLOW + THINK_END_TAG);
                isThinking = false;
                currentChunkContent = currentChunkContent.substring(endTagIndex + THINK_END_TAG.length);
              } else {
                stdout.write(ANSI.YELLOW + currentChunkContent);
                currentChunkContent = "";
              }
            } else {
              const startTagIndex = currentChunkContent.indexOf(THINK_START_TAG);
              if (startTagIndex !== -1) {
                const textToPrint = currentChunkContent.substring(0, startTagIndex);
                if (textToPrint)
                  stdout.write(ANSI.CYAN + textToPrint);
                stdout.write(ANSI.YELLOW + THINK_START_TAG);
                isThinking = true;
                currentChunkContent = currentChunkContent.substring(startTagIndex + THINK_START_TAG.length);
              } else {
                stdout.write(ANSI.CYAN + currentChunkContent);
                currentChunkContent = "";
              }
            }
          }
        }
        if (delta?.tool_calls) {
          if (isThinking) {
            stdout.write(ANSI.RESET);
            isThinking = false;
          }
          stdout.write(ANSI.GRAY);
          for (const deltaToolCall of delta.tool_calls) {
            if (deltaToolCall.id) {
              stdout.write(`<Tool ${deltaToolCall.id}>
`);
            }
            if (deltaToolCall.function.name) {
              stdout.write(deltaToolCall.function.name + " ");
            }
            if (deltaToolCall.function.arguments) {
              stdout.write(deltaToolCall.function.arguments);
            }
          }
          stdout.write(ANSI.RESET);
        }
      } else {
        if (isThinking) {
          stdout.write(ANSI.RESET);
          isThinking = false;
        }
        stdout.write("\n\n");
        stdout.write(ANSI.GREEN);
        stdout.write(`Tool[${chunk.name}] ${chunk.tool_call_id}
`);
        stdout.write(chunk.content);
        stdout.write(ANSI.RESET);
        stdout.write("\n\n");
      }
    }
    if (isThinking) {
      stdout.write(ANSI.RESET);
      isThinking = false;
    }
    stdout.write("\n");
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
  processExit(1);
});
