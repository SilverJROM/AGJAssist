import { LlmProvider, ChatMessage } from "../llm/base-provider.js";
import { ToolRegistry, ToolAction } from "../tools/tool-registry.js";

function parseAction(text: string): ToolAction | null {
  // Try closed tag first, then unclosed, then just JSON after <ACTION>
  const match =
    text.match(/<ACTION>\s*([\s\S]*?)\s*<\/ACTION>/) ||
    text.match(/<ACTION>\s*(\{[\s\S]*\})\s*$/) ||
    text.match(/<ACTION>\s*(\{[\s\S]*\})/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as {
      tool?: string;
      params?: Record<string, unknown>;
      description?: string;
    };

    if (!parsed.tool) return null;
    return {
      tool: parsed.tool,
      params: parsed.params || {},
      description: parsed.description
    };
  } catch {
    return null;
  }
}

export class ToolAgent {
  constructor(
    private readonly llm: LlmProvider,
    private readonly tools: ToolRegistry,
    private readonly maxIterations: number
  ) {}

  async run(userRequest: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "You are AGJAssist orchestrator.",
          "Use tools when needed to inspect tmux jobs, logs, and run safe commands.",
          "When a tool is needed, include exactly one block:",
          "<ACTION>{\"tool\":\"name\",\"params\":{},\"description\":\"what and why\"}</ACTION>",
          "After tool results are provided, continue reasoning and either ask for another tool or give final answer.",
          "Keep final output concise and actionable.",
          "Available tools:",
          this.tools.listToolDescriptions()
        ].join("\n")
      },
      { role: "user", content: userRequest }
    ];

    for (let i = 0; i < this.maxIterations; i += 1) {
      const response = await this.llm.chat(messages, 1800);
      const action = parseAction(response);

      if (!action) {
        return response;
      }

      let toolResult: string;
      try {
        toolResult = await this.tools.execute(action);
      } catch (error) {
        toolResult = `Tool execution error: ${error instanceof Error ? error.message : String(error)}`;
      }

      messages.push({ role: "assistant", content: response });
      messages.push({ role: "user", content: `[Tool Result for ${action.tool}]\n${toolResult}` });
    }

    return "Tool iteration limit reached before final answer.";
  }
}
