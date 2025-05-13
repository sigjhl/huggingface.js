import type { InferenceProvider } from "@huggingface/inference";
import type { ChatCompletionInputMessageTool } from "./McpClient";
import { McpClient } from "./McpClient";
import type { ChatCompletionInputMessage, ChatCompletionStreamOutput } from "@huggingface/tasks";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio";
export declare class Agent extends McpClient {
    private readonly servers;
    protected messages: ChatCompletionInputMessage[];
    constructor({ provider, endpointUrl, model, apiKey, servers, prompt, }: ({
        provider: InferenceProvider;
        endpointUrl?: undefined;
    } | {
        endpointUrl: string;
        provider?: undefined;
    }) & {
        model: string;
        apiKey: string;
        servers: StdioServerParameters[];
        prompt?: string;
    });
    loadTools(): Promise<void>;
    run(input: string, opts?: {
        abortSignal?: AbortSignal;
    }): AsyncGenerator<ChatCompletionStreamOutput | ChatCompletionInputMessageTool>;
}
//# sourceMappingURL=Agent.d.ts.map