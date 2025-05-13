import type { InferenceProvider } from "@huggingface/inference";
import type { ChatCompletionInputMessageTool } from "./McpClient";
import { McpClient } from "./McpClient";
import type { ChatCompletionInputMessage, ChatCompletionStreamOutput } from "@huggingface/tasks";
import type { ChatCompletionInputTool } from "@huggingface/tasks/src/tasks/chat-completion/inference";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio";
import { debug } from "./utils";

// Original DEFAULT_SYSTEM_PROMPT is removed as it's now dynamic

/**
 * Max number of tool calling + chat completion steps in response to a single user query.
 */
const MAX_NUM_TURNS = 10;

// These tools are no longer used by default as exitLoopTools is empty
// const taskCompletionTool: ChatCompletionInputTool = { /* ... */ };
// const askQuestionTool: ChatCompletionInputTool = { /* ... */ };

const exitLoopTools: ChatCompletionInputTool[] = []; // Changed as per diff

export class Agent extends McpClient {
	private readonly servers: StdioServerParameters[];
	protected messages: ChatCompletionInputMessage[];
	private readonly toolsOff: boolean;

	constructor({
		provider,
		endpointUrl,
		model,
		apiKey,
		servers,
		prompt,
		toolsOff, // Added
	}: (
		| {
				provider: InferenceProvider;
				endpointUrl?: undefined;
		  }
		| {
				endpointUrl: string;
				provider?: undefined;
		  }
	) & {
		model: string;
		apiKey: string;
		servers: StdioServerParameters[];
		prompt?: string;
		toolsOff?: boolean; // Added
	}) {
		super(provider ? { provider, endpointUrl, model, apiKey } : { provider, endpointUrl, model, apiKey });
		this.servers = servers;
		this.toolsOff = toolsOff ?? false; // Default to tools ON

		let actualSystemPrompt: string;
		if (prompt) {
			actualSystemPrompt = prompt;
		} else {
			let systemPromptCore: string;
			if (this.toolsOff) {
				systemPromptCore = `You are a helpful assistant.`;
			} else {
				// For Qwen, a general prompt is often best, letting the endpoint handle tool formatting.
				// If your endpoint doesn't auto-inject Qwen's tool instructions, you might need to be more explicit here.
				systemPromptCore = `You are a helpful assistant. 
You must keep using tools, sequentially, until you arrive at an answer. 
Do not be lazy. Use additional tool calls eagerly. 
`;
			}

			const currentDate = new Date();
			const formattedDate = currentDate.toLocaleDateString('en-US', { // Or your preferred locale
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric',
			});
			
			actualSystemPrompt = systemPromptCore.trim();
			actualSystemPrompt += `\n\nToday's date is ${formattedDate}. Please use this information if the user's query is time-sensitive or implies current knowledge.`;
			actualSystemPrompt = actualSystemPrompt.trim();
		}
		
		this.messages = [
			{
				role: "system",
				content: actualSystemPrompt,
			},
		];
	}

	async loadTools(): Promise<void> {
		// If this.servers is empty (due to toolsOff), this will correctly result in no tools loaded.
		return this.addMcpServers(this.servers);
	}

	async *run(
		input: string,
		opts: { abortSignal?: AbortSignal } = {}
	): AsyncGenerator<ChatCompletionStreamOutput | ChatCompletionInputMessageTool> {
		this.messages.push({
			role: "user",
			content: input,
		});

		let numOfTurns = 0;
		let nextTurnShouldCallTools = true;
		while (true) {
			try {
				// exitLoopTools is now an empty array, so only this.availableTools will be passed if any
				yield* this.processSingleTurnWithTools(this.messages, {
					exitLoopTools, // This is the empty constant from Agent.ts
					exitIfFirstChunkNoTool: numOfTurns > 0 && nextTurnShouldCallTools,
					abortSignal: opts.abortSignal,
				});
			} catch (err) {
				if (err instanceof Error && err.message === "AbortError") {
					return;
				}
				throw err;
			}
			numOfTurns++;
			const currentLast = this.messages.at(-1)!;
			debug("current role", currentLast.role);
			
			// This condition will likely not be met if exitLoopTools is empty
			if (
				currentLast.role === "tool" &&
				currentLast.name &&
				exitLoopTools.map((t) => t.function.name).includes(currentLast.name)
			) {
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
}