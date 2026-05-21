import { ChatMessage, LlmProvider } from "./base-provider.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  error?: string;
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  private model: string;

  constructor(
    private readonly baseUrl: string,
    model: string,
    private readonly timeoutMs: number
  ) {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setModel(model: string): void {
    this.model = model;
  }

  async chat(messages: ChatMessage[], maxTokens?: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          options: {
            num_predict: maxTokens ?? 800
          },
          messages
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`);
      }

      const data = (await response.json()) as OllamaChatResponse;
      const content = data.message?.content?.trim();
      if (!content) {
        throw new Error("Ollama returned empty content");
      }

      return content;
    } catch (error) {
      if (
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof Error && /aborted/i.test(error.message))
      ) {
        throw new Error(`Ollama request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
