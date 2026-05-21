export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProvider {
  readonly name: string;
  chat(messages: ChatMessage[], maxTokens?: number): Promise<string>;
}
