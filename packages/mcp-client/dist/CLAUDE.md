# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains the MCP (Model Context Protocol) client for Hugging Face, a Node.js library for interacting with AI models that can use tools. It allows models to connect to various MCP servers that provide different functionalities like file system access, web browsing, and more.

## Architecture

### Core Components

1. **McpClient**: Base client class that handles:
   - Connecting to Hugging Face Inference API
   - Managing MCP servers and tools
   - Processing model inputs and outputs with tool calls

2. **Agent**: Extends McpClient to provide a conversational agent that:
   - Maintains conversation history
   - Runs multi-turn conversations
   - Handles tool calls and responses

3. **CLI**: Command-line interface (cli.js) that:
   - Provides an interactive shell for users
   - Handles multiline input (!multi)
   - Supports thinking mode output (<think>...</think>)
   - Supports graceful termination

## Environment Variables

- `HF_TOKEN`: Required for authentication with Hugging Face API
- `MODEL_ID`: Model to use (default: "Qwen/Qwen2.5-72B-Instruct")
- `PROVIDER`: API provider (default: "nebius")
- `ENDPOINT_URL` or `BASE_URL`: Custom endpoint URL (optional)
- `TOOLS_OFF`: Set to 'true' to disable MCP tools (chat-only mode)
- `DEBUG`: Set to enable debug logging
- `TEMPERATURE`, `TOP_P`, `TOP_K`: Model generation parameters
- `GOOGLE_API_KEY`: For Google search MCP server (required if using Google search)
- `EDITOR`: Custom editor to use for the `!edit` command (defaults to platform-specific editors)

## Commands

### Running the CLI

```bash
# Run the client
HF_TOKEN=your_token_here node cli.js

# Run in tools-off mode (chat only)
TOOLS_OFF=true HF_TOKEN=your_token_here node cli.js
```

### CLI Commands

- `!multi`: Start multiline input mode
- `!end`: End multiline input mode
- `!edit`: Open an external editor for multiline input
  - `!edit some text`: Pre-populate the editor with text
  - `!edit --editor vim some text`: Specify an editor to use
- `exit` or `quit`: Exit the CLI
- Ctrl+C: Abort current generation
- Ctrl+C twice: Exit the CLI

### Development

The code appears to be a compiled JavaScript output in the `dist` directory, so any development should likely be done in the TypeScript source files (not visible in this `dist` directory context).

## Code Behavior Notes

1. The client can connect to multiple MCP servers providing different tools.
2. Messages use ANSI colors for better readability in the terminal.
3. The agent handles multi-turn conversations with a model up to MAX_NUM_TURNS.
4. Tool calls are processed and their responses are fed back to the model.
5. There is special formatting for "thinking" blocks enclosed in <think>...</think> tags.

## Recent Code Changes

### External Editor Support (2025-05-13)
- Added the `!edit` command to enable editing input in an external text editor
- Supports pre-populating the editor with initial text: `!edit some initial text`
- Allows specifying a custom editor: `!edit --editor vim`
- Automatically detects and uses appropriate editors based on platform:
  - First tries the EDITOR environment variable
  - On macOS: nano (preferred), vim, vi, or TextEdit (last resort)
  - On Windows: notepad
  - On Linux: nano, vim, or vi
- Handles editor sessions with a 5-minute timeout to prevent hanging
- Preserves text formatting and whitespace from the editor
- Added error handling and cleanup for temporary files

### API Key Security Enhancement (2025-05-13)
- Fixed Google API key handling to use environment variables
- Removed hardcoded API keys from the codebase
- Added GOOGLE_API_KEY to environment variables list