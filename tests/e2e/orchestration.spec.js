import { describe, it, expect } from "vitest";
import { AssistantCore } from "../../src/bot/assistant-core.js";
import { ToolAgent } from "../../src/orchestration/tool-agent.js";
class FakeLlm {
    responses;
    name = "fake";
    constructor(responses) {
        this.responses = responses;
    }
    async chat(_messages) {
        const next = this.responses.shift();
        if (!next)
            throw new Error("No fake response configured");
        return next;
    }
}
class FakeToolRegistry {
    calls = [];
    listToolDescriptions() {
        return "tmux_list_jobs()";
    }
    async execute(action) {
        this.calls.push(action.tool);
        if (action.tool === "tmux_list_jobs") {
            return "- build:0.0 | cmd=node | title=runner";
        }
        return "unknown";
    }
}
class FakeTmuxService {
    async listJobsSummary() {
        return "- build:0.0 | cmd=node | title=runner";
    }
    async peekPane(target, lines = 200) {
        return `peek ${target} ${lines}`;
    }
}
const config = {
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
        maxToolIterations: 4
    }
};
describe("AssistantCore e2e", () => {
    it("routes OP prefix to tool-enabled OpenRouter flow", async () => {
        const openRouter = new FakeLlm([
            'I will inspect tmux now.\n<ACTION>{"tool":"tmux_list_jobs","params":{},"description":"Inspect jobs"}</ACTION>',
            "I found one active pane: build:0.0 running node."
        ]);
        const tools = new FakeToolRegistry();
        const openRouterAgent = new ToolAgent(openRouter, tools, 4);
        const localLlm = new FakeLlm(["local fallback"]);
        const core = new AssistantCore(config, openRouterAgent, localLlm, new FakeTmuxService());
        const result = await core.handleText("op check current tmux status");
        expect(result).toContain("active pane");
        expect(tools.calls).toEqual(["tmux_list_jobs"]);
    });
    it("supports manual tmux command path", async () => {
        const openRouterAgent = new ToolAgent(new FakeLlm(["unused"]), new FakeToolRegistry(), 2);
        const localLlm = new FakeLlm(["local"]);
        const core = new AssistantCore(config, openRouterAgent, localLlm, new FakeTmuxService());
        const result = await core.handleCommand("/jobs");
        expect(result).toContain("build:0.0");
    });
});
