import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InferenceClient } from "@huggingface/inference";
import type { InferenceProviderOrPolicy } from "@huggingface/inference";
import type {
	ChatCompletionInputMessage,
	ChatCompletionInputTool,
	ChatCompletionStreamOutput,
	ChatCompletionStreamOutputDeltaToolCall,
	// ChatCompletionStreamParams, // Removed this import
} from "@huggingface/tasks/src/tasks/chat-completion/inference";
import { version as packageVersion } from "../package.json";
import { debug } from "./utils";

type ToolName = string;

export interface ChatCompletionInputMessageTool extends ChatCompletionInputMessage {
	role: "tool";
	tool_call_id: string;
	content: string;
	name?: string;
}

export class McpClient {
	protected client: InferenceClient;
	protected provider: InferenceProviderOrPolicy | undefined;
	private readonly clientEndpointUrl?: string; // Store endpointUrl if provided

	protected model: string;
	private clients: Map<ToolName, Client> = new Map();
	public readonly availableTools: ChatCompletionInputTool[] = [];

	constructor({
		provider,
		endpointUrl,
		model,
		apiKey,
	}: (
		| {
				provider: InferenceProviderOrPolicy;
				endpointUrl?: undefined;
		  }
		| {
				endpointUrl: string;
				provider?: undefined;
		  }
	) & {
		model: string;
		apiKey: string;
	}) {
		this.client = endpointUrl ? new InferenceClient(apiKey, { endpointUrl: endpointUrl }) : new InferenceClient(apiKey);
		this.provider = provider;
		this.clientEndpointUrl = endpointUrl; // Store it here
		this.model = model;
	}

	async addMcpServers(servers: StdioServerParameters[]): Promise<void> {
		await Promise.all(servers.map((s) => this.addMcpServer(s)));
	}

	async addMcpServer(server: StdioServerParameters): Promise<void> {
		const transport = new StdioClientTransport({
			...server,
			env: { ...server.env, PATH: process.env.PATH ?? "" },
		});
		const mcp = new Client({ name: "@huggingface/mcp-client", version: packageVersion });
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
						parameters: tool.inputSchema,
					},
				} satisfies ChatCompletionInputTool;
			})
		);
	}

	async *processSingleTurnWithTools(
		messages: ChatCompletionInputMessage[],
		opts: {
			exitLoopTools?: ChatCompletionInputTool[];
			exitIfFirstChunkNoTool?: boolean;
			abortSignal?: AbortSignal;
		} = {}
	): AsyncGenerator<ChatCompletionStreamOutput | ChatCompletionInputMessageTool> {
		debug("start of single turn");

		// Let TypeScript infer the type of streamParams from the method signature
		const streamParams = {
			model: this.model,
			messages,
			signal: opts.abortSignal,
			// tools and tool_choice will be added conditionally below
		} as any; // Use 'as any' for now, or define a local interface if preferred

		// If InferenceClient was NOT initialized with a specific endpointUrl,
		// then we should pass the provider.
		if (this.provider && !this.clientEndpointUrl) {
			streamParams.provider = this.provider;
		}
		
		const allToolsForLLM: ChatCompletionInputTool[] = [];
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
			content: "",
		} satisfies ChatCompletionInputMessage as ChatCompletionInputMessage & { role: "assistant" | "user" | "system" | "tool" | "unknown" };
		const finalToolCalls: Record<number, ChatCompletionStreamOutputDeltaToolCall> = {};
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
				message.role = delta.role as "assistant" | "user" | "system" | "tool";
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

		messages.push(message as ChatCompletionInputMessage);

		for (const toolCall of Object.values(finalToolCalls)) {
			const toolName = toolCall.function.name ?? "unknown";
			const toolArgsString = toolCall.function.arguments ?? "";
			const toolArgs = toolArgsString === "" ? {} : JSON.parse(toolArgsString);

			const toolMessage: ChatCompletionInputMessageTool = {
				role: "tool",
				tool_call_id: toolCall.id!, // Assuming id will always be present for a tool_call
				content: "",
				name: toolName,
			};

			// Check if this tool is one of the exitLoopTools
			const isExitTool = opts.exitLoopTools?.some(et => et.function.name === toolName);
			if (isExitTool) {
				messages.push(toolMessage); // Add the tool message for context
				yield toolMessage; // Yield it so CLI can see it
				return; // Exit the loop as per original logic if it's an exit tool
			}
			
			const client = this.clients.get(toolName);
			if (client) {
				try {
					const result = await client.callTool({ name: toolName, arguments: toolArgs, signal: opts.abortSignal });
					// Assuming result.content is an array with a text property, adjust if schema is different
					toolMessage.content = (result.content as Array<{ text: string }>)[0]?.text ?? JSON.stringify(result.content);
				} catch (e: any) {
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

	async cleanup(): Promise<void> {
		const clients = new Set(this.clients.values());
		await Promise.all([...clients].map((client) => client.close()));
	}

	async [Symbol.dispose](): Promise<void> {
		return this.cleanup();
	}
}