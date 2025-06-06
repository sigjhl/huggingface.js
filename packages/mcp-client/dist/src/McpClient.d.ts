import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InferenceClient } from "@huggingface/inference";
import type { InferenceProviderOrPolicy } from "@huggingface/inference";
import type { ChatCompletionInputMessage, ChatCompletionInputTool, ChatCompletionStreamOutput } from "@huggingface/tasks/src/tasks/chat-completion/inference";
export interface ChatCompletionInputMessageTool extends ChatCompletionInputMessage {
    role: "tool";
    tool_call_id: string;
    content: string;
    name?: string;
}
export declare class McpClient {
    protected client: InferenceClient;
    protected provider: InferenceProviderOrPolicy | undefined;
    private readonly clientEndpointUrl?;
    protected model: string;
    private clients;
    readonly availableTools: ChatCompletionInputTool[];
    constructor({ provider, endpointUrl, model, apiKey, }: ({
        provider: InferenceProviderOrPolicy;
        endpointUrl?: undefined;
    } | {
        endpointUrl: string;
        provider?: undefined;
    }) & {
        model: string;
        apiKey: string;
    });
    addMcpServers(servers: StdioServerParameters[]): Promise<void>;
    addMcpServer(server: StdioServerParameters): Promise<void>;
    processSingleTurnWithTools(messages: ChatCompletionInputMessage[], opts?: {
        exitLoopTools?: ChatCompletionInputTool[];
        exitIfFirstChunkNoTool?: boolean;
        abortSignal?: AbortSignal;
    }): AsyncGenerator<ChatCompletionStreamOutput | ChatCompletionInputMessageTool>;
    cleanup(): Promise<void>;
    [Symbol.dispose](): Promise<void>;
}
//# sourceMappingURL=McpClient.d.ts.map