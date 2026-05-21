import { describe, it, expect } from "vitest";
import { AssistantCore } from "../../src/bot/assistant-core.js";
import { ToolAgent } from "../../src/orchestration/tool-agent.js";
import { LlmProvider, ChatMessage } from "../../src/llm/base-provider.js";
import { AppConfig } from "../../src/config/config.js";
import { OllamaProvider } from "../../src/llm/ollama-provider.js";
import { AgentCliRunner } from "../../src/cli/agent-cli-runner.js";

class FakeLlm implements LlmProvider {
  readonly name = "fake";

  constructor(private readonly responses: string[]) {}

  async chat(_messages: ChatMessage[]): Promise<string> {
    const next = this.responses.shift();
    if (!next) throw new Error("No fake response configured");
    return next;
  }
}

class FakeToolRegistry {
  calls: string[] = [];

  listToolDescriptions(): string {
    return "tmux_list_jobs()\\ntmux_send({target,command,enter?})";
  }

  async execute(action: { tool: string; params?: Record<string, unknown> }): Promise<string> {
    this.calls.push(action.tool);
    if (action.tool === "tmux_list_jobs") {
      return "- build:0.0 | cmd=node | title=runner";
    }
    if (action.tool === "tmux_send") {
      return `Sent command to ${String(action.params?.target || "unknown")}`;
    }
    return "unknown";
  }
}

class FakeTmuxService {
  async listJobsSummary(): Promise<string> {
    return "- build:0.0 | cmd=node | title=runner";
  }

  async peekPane(target: string, lines = 200): Promise<string> {
    return `peek ${target} ${lines}`;
  }

  async sendCommand(target: string, command: string, pressEnter = true): Promise<{ message: string; blocked: boolean }> {
    return { message: `sent ${command} -> ${target} (enter=${pressEnter})`, blocked: false };
  }
}

class FakeOllamaProvider extends OllamaProvider {
  private readonly responses: string[];

  constructor(initialModel: string, responses: string[]) {
    super("http://localhost:11434", initialModel, 1000);
    this.responses = responses;
  }

  override async chat(_messages: ChatMessage[]): Promise<string> {
    const next = this.responses.shift();
    if (!next) throw new Error("No fake ollama response configured");
    return next;
  }
}

const config: AppConfig = {
  telegram: {
    botToken: "test",
    authorizedUserId: 123,
    testMode: true
  },
  llm: {
    ollamaBaseUrl: "http://localhost:11434",
    ollamaModel: "llama3",
    ollamaTimeoutMs: 1000,
    openrouterApiKey: "key",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    openrouterModel: "z-ai/glm-4.5-air:free",
    openrouterTimeoutMs: 1000
  },
  runtime: {
    workspaceRoot: "/home/agjrom",
    allowedCommandPrefixes: ["tmux", "ls"],
    maxToolIterations: 4,
    defaultTimeoutMinutes: 60
  }
};

class FakeAgentCliRunner implements AgentCliRunner {
  calls: Array<{ provider: string; prompt: string; model?: string; timeoutMs: number }> = [];

  async runClaude(prompt: string, options: { model?: "opus" | "sonnet" | "haiku"; timeoutMs: number }): Promise<string> {
    this.calls.push({ provider: "claude", prompt, model: options.model, timeoutMs: options.timeoutMs });
    return `claude:${options.model || "default"}:${prompt}`;
  }

  async runCodex(prompt: string, options: { timeoutMs: number }): Promise<string> {
    this.calls.push({ provider: "codex", prompt, timeoutMs: options.timeoutMs });
    return `codex:${prompt}`;
  }
}

describe("AssistantCore e2e", () => {
  it("routes OP prefix to tool-enabled OpenRouter flow", async () => {
    const openRouter = new FakeLlm([
      'I will inspect tmux now.\n<ACTION>{"tool":"tmux_list_jobs","params":{},"description":"Inspect jobs"}</ACTION>',
      "I found one active pane: build:0.0 running node."
    ]);

    const tools = new FakeToolRegistry();
    const openRouterAgent = new ToolAgent(openRouter, tools as any, 4);
    const ollamaTools = new FakeToolRegistry();
    const ollamaToolAgent = new ToolAgent(new FakeLlm(["unused"]), ollamaTools as any, 4);

    const ollamaProvider = new FakeOllamaProvider("qwek32k:latest", ["local fallback"]);
    const core = new AssistantCore(
      config,
      openRouterAgent,
      ollamaToolAgent,
      ollamaProvider,
      new FakeTmuxService() as any,
      new FakeAgentCliRunner()
    );

    const result = await core.handleText("op check current tmux status");

    expect(result).toContain("active pane");
    expect(tools.calls).toEqual(["tmux_list_jobs"]);
  });

  it("supports manual tmux command path", async () => {
    const openRouterAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaToolAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaProvider = new FakeOllamaProvider("qwek32k:latest", ["local"]);
    const core = new AssistantCore(
      config,
      openRouterAgent,
      ollamaToolAgent,
      ollamaProvider,
      new FakeTmuxService() as any,
      new FakeAgentCliRunner()
    );

    const result = await core.handleCommand("/jobs");
    expect(result).toContain("build:0.0");
  });

  it("routes OM prefix to tool-enabled Ollama flow and allows model switching", async () => {
    const openRouterAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaToolLlm = new FakeLlm([
      'Using local tools.\n<ACTION>{"tool":"tmux_list_jobs","params":{},"description":"Inspect jobs"}</ACTION>',
      "Local assessment: one active pane in tmux."
    ]);
    const ollamaTools = new FakeToolRegistry();
    const ollamaToolAgent = new ToolAgent(ollamaToolLlm, ollamaTools as any, 4);
    const ollamaProvider = new FakeOllamaProvider("qwek32k:latest", ["local fallback"]);
    const core = new AssistantCore(
      config,
      openRouterAgent,
      ollamaToolAgent,
      ollamaProvider,
      new FakeTmuxService() as any,
      new FakeAgentCliRunner()
    );

    const switched = await core.handleCommand("/ommodel granite4:64k");
    expect(switched).toContain("granite4:64k");

    const result = await core.handleText("om check tmux and summarize");
    expect(result).toContain("Local assessment");
    expect(ollamaTools.calls).toEqual(["tmux_list_jobs"]);
  });

  it("supports manual tmux_send command path", async () => {
    const openRouterAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaToolAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaProvider = new FakeOllamaProvider("qwek32k:latest", ["local"]);
    const core = new AssistantCore(
      config,
      openRouterAgent,
      ollamaToolAgent,
      ollamaProvider,
      new FakeTmuxService() as any,
      new FakeAgentCliRunner()
    );

    const result = await core.handleCommand("/tmux_send build:0.0 npm run test");
    expect(result).toContain("sent npm run test");
  });

  it("allows OP tool flow to send command to tmux", async () => {
    const openRouter = new FakeLlm([
      'Dispatching command now.\\n<ACTION>{"tool":"tmux_send","params":{"target":"build:0.0","command":"npm run lint"},"description":"Send lint command"}</ACTION>',
      "Command dispatched successfully."
    ]);
    const openRouterTools = new FakeToolRegistry();
    const openRouterAgent = new ToolAgent(openRouter, openRouterTools as any, 4);
    const ollamaToolAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaProvider = new FakeOllamaProvider("qwek32k:latest", ["local"]);
    const core = new AssistantCore(
      config,
      openRouterAgent,
      ollamaToolAgent,
      ollamaProvider,
      new FakeTmuxService() as any,
      new FakeAgentCliRunner()
    );

    const result = await core.handleText("op send npm run lint to build:0.0");
    expect(result).toContain("dispatched");
    expect(openRouterTools.calls).toEqual(["tmux_send"]);
  });

  it("routes claude-family and codex prefixes through headless cli runner", async () => {
    const openRouterAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaToolAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaProvider = new FakeOllamaProvider("qwek32k:latest", ["local"]);
    const cliRunner = new FakeAgentCliRunner();
    const core = new AssistantCore(
      config,
      openRouterAgent,
      ollamaToolAgent,
      ollamaProvider,
      new FakeTmuxService() as any,
      cliRunner
    );

    await core.handleText("claude plan this");
    await core.handleText("opus deep plan");
    await core.handleText("sonnet review code");
    await core.handleText("haiku quick status");
    await core.handleText("codex implement this");

    expect(cliRunner.calls).toEqual([
      { provider: "claude", prompt: "plan this", model: undefined, timeoutMs: 3600000 },
      { provider: "claude", prompt: "deep plan", model: "opus", timeoutMs: 3600000 },
      { provider: "claude", prompt: "review code", model: "sonnet", timeoutMs: 3600000 },
      { provider: "claude", prompt: "quick status", model: "haiku", timeoutMs: 3600000 },
      { provider: "codex", prompt: "implement this", timeoutMs: 3600000 }
    ]);
  });

  it("allows timeout changes via /timeout command", async () => {
    const openRouterAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaToolAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry() as any, 2);
    const ollamaProvider = new FakeOllamaProvider("qwek32k:latest", ["local"]);
    const cliRunner = new FakeAgentCliRunner();
    const core = new AssistantCore(
      config,
      openRouterAgent,
      ollamaToolAgent,
      ollamaProvider,
      new FakeTmuxService() as any,
      cliRunner
    );

    const updateResponse = await core.handleCommand("/timeout 120");
    expect(updateResponse).toContain("120");

    await core.handleText("codex follow up");
    expect(cliRunner.calls[0]).toEqual({
      provider: "codex",
      prompt: "follow up",
      timeoutMs: 7200000
    });
  });
});
