import { ChatMessage, LlmProvider } from "./base-provider.js";

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_details?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: { message?: string };
}

export class OpenRouterProvider implements LlmProvider {
  readonly name = "openrouter";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async chat(messages: ChatMessage[], maxTokens?: number): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": "https://agjassist.local",
          "X-Title": "AGJAssist"
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens ?? 1600,
          temperature: 0.2
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`OpenRouter request failed: ${response.status} ${await response.text()}`);
      }

      const data = (await response.json()) as OpenRouterResponse;
      if (data.error?.message) {
        throw new Error(data.error.message);
      }

      const message = data.choices?.[0]?.message;
      const content = message?.content?.trim();
      const reasoning = message?.reasoning?.trim();
      const reasoningDetail = message?.reasoning_details
        ?.map((item) => item?.text?.trim() || "")
        .filter(Boolean)
        .join("\n")
        .trim();

      const finalText = content || reasoning || reasoningDetail;

      if (!finalText) {
        throw new Error("OpenRouter returned empty content");
      }
      return finalText;
    } catch (error) {
      if (
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof Error && /aborted/i.test(error.message))
      ) {
        throw new Error(`OpenRouter request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
