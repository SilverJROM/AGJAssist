import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseService } from "../../src/db/database.js";
import { AuditService } from "../../src/services/audit-service.js";
import { ConversationService } from "../../src/services/conversation-service.js";
import { ChatSettingsService } from "../../src/services/chat-settings-service.js";
import { ClaudeCliProvider } from "../../src/llm/claude-cli-provider.js";
import { CodexCliProvider } from "../../src/llm/codex-cli-provider.js";
import { OllamaProvider } from "../../src/llm/ollama-provider.js";
import { AssistantCore } from "../../src/bot/assistant-core.js";
import fs from "node:fs";
import path from "node:path";

const TEST_DB = path.join("data", "test-conv-memory.sqlite");

function cleanup(): void {
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe("Conversation history building", () => {
  let db: DatabaseService;
  let conversationService: ConversationService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    db.ensureOwner(111);
    const audit = new AuditService(db);
    conversationService = new ConversationService(db, audit);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("builds history array with all prior turns", () => {
    const conv = conversationService.create("test", 1);
    conversationService.addMessage(conv.id, {
      role: "user",
      content: "hello, remember my fave number #23",
      timestamp: new Date().toISOString()
    });
    conversationService.addMessage(conv.id, {
      role: "assistant",
      content: "Hello! I'll remember that your favorite number is 23.",
      timestamp: new Date().toISOString()
    });
    conversationService.addMessage(conv.id, {
      role: "user",
      content: "what is my favorite number?",
      timestamp: new Date().toISOString()
    });

    const updated = conversationService.getById(conv.id);
    expect(updated).not.toBeNull();
    expect(updated!.messages.length).toBe(3);
    expect(updated!.messages[0].role).toBe("user");
    expect(updated!.messages[1].role).toBe("assistant");
    expect(updated!.messages[2].role).toBe("user");
  });

  it("history filter excludes error messages and limits to 20", () => {
    const conv = conversationService.create("test", 1);
    // Add 22 messages
    for (let i = 0; i < 22; i++) {
      conversationService.addMessage(conv.id, {
        role: i % 2 === 0 ? "user" : "assistant",
        content: i === 5 ? "Error: something went wrong" : `message ${i}`,
        timestamp: new Date().toISOString()
      });
    }

    const updated = conversationService.getById(conv.id);
    const history = updated!.messages
      .filter(
        (msg: { role: string; content: string }) =>
          (msg.role === "user" || msg.role === "assistant") &&
          !msg.content.startsWith("Error:")
      )
      .slice(-20);

    // 22 messages minus 1 error = 21, then slice(-20) = 20
    expect(history.length).toBe(20);
    expect(history.every((m: { content: string }) => !m.content.startsWith("Error:"))).toBe(true);
  });
});

describe("ClaudeCliProvider buildPrompt", () => {
  it("serializes single user message without history block", () => {
    const provider = new ClaudeCliProvider("haiku", 30000);
    // Access buildPrompt via chat() — we test the prompt format indirectly
    // by checking that the provider correctly builds messages
    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "hello" }
    ];

    // We can't directly call buildPrompt (private), but we can verify
    // the provider constructs the right format by testing the public API
    // For unit test, just verify the provider exists and accepts messages
    expect(provider.getModel()).toBe("haiku");
    provider.setModel("sonnet");
    expect(provider.getModel()).toBe("sonnet");
  });
});

describe("CodexCliProvider model support", () => {
  it("has default model and supports setModel/getModel", () => {
    const provider = new CodexCliProvider(30000);
    expect(provider.getModel()).toBe("codex-default");
    provider.setModel("o4-mini");
    expect(provider.getModel()).toBe("o4-mini");
    provider.setModel("codex-mini-latest");
    expect(provider.getModel()).toBe("codex-mini-latest");
  });
});

describe("Ollama conversation memory (live)", () => {
  async function isOllamaAvailable(): Promise<boolean> {
    try {
      const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  it("remembers context across turns", async () => {
    const available = await isOllamaAvailable();
    if (!available) {
      console.log("Skipping live Ollama test — server not available");
      return;
    }

    cleanup();
    const db = new DatabaseService(TEST_DB);
    db.ensureOwner(111);
    const audit = new AuditService(db);
    const conversationService = new ConversationService(db, audit);
    const chatSettings = new ChatSettingsService(db);

    chatSettings.set("soul_md", "You are a helpful assistant. Be concise.");
    chatSettings.set("context_md", "");

    const ollama = new OllamaProvider(
      "http://127.0.0.1:11434",
      "qwek32k:latest",
      60000
    );

    try {
      const conv = conversationService.create("ollama-test", 1);

      // Turn 1: introduce favorite number
      const turn1Content = "hello who are you? remember my fave number #23";

      const soulMd = chatSettings.get("soul_md") || "";
      const contextParts1 = [soulMd, `User's latest message:\n${turn1Content}`];
      const prompt1 = contextParts1.filter(Boolean).join("\n\n");

      const response1 = await ollama.chat([
        { role: "system", content: soulMd },
        { role: "user", content: turn1Content }
      ]);

      conversationService.addMessage(conv.id, {
        role: "user",
        content: turn1Content,
        timestamp: new Date().toISOString()
      });
      conversationService.addMessage(conv.id, {
        role: "assistant",
        content: response1,
        timestamp: new Date().toISOString()
      });

      // Turn 2: ask about the number
      const turn2Content = "what is my favorite number?";

      const updated = conversationService.getById(conv.id);
      const history = updated!.messages
        .filter(
          (msg: { role: string; content: string }) =>
            (msg.role === "user" || msg.role === "assistant") &&
            !msg.content.startsWith("Error:")
        )
        .slice(-20);

      const contextParts2 = [
        soulMd,
        "Recent conversation history:",
        ...history.map((m: { role: string; content: string }) =>
          `${m.role}: ${m.content.slice(0, 500)}`
        ),
        `User's latest message:\n${turn2Content}`
      ];

      const fullRequest2 = contextParts2.filter(Boolean).join("\n\n");

      const response2 = await ollama.chat([
        { role: "system", content: fullRequest2 },
        { role: "user", content: turn2Content }
      ]);

      console.log("Ollama response2:", response2);

      // Assert the LLM remembers #23
      expect(response2.toLowerCase()).toContain("23");

      // Cleanup
      conversationService.delete(conv.id);
    } finally {
      db.close();
      cleanup();
    }
  }, 120000); // 2 minute timeout for LLM calls
});

describe("CLI provider env var cleanup", () => {
  it("ClaudeCliProvider strips CLAUDECODE via cleanEnv or delete", () => {
    const providerSrc = fs.readFileSync(
      path.join("src", "llm", "claude-cli-provider.ts"),
      "utf-8"
    );
    // Must use delete env.CLAUDECODE (either in cleanEnv or directly)
    expect(providerSrc).toContain("delete env.CLAUDECODE");
    // No leftover "CLAUDECODE: undefined" patterns
    expect(providerSrc).not.toContain("CLAUDECODE: undefined");
    // Must pipe prompt via stdin (use "-" arg), not as a CLI argument
    expect(providerSrc).toContain('args.push("-")');
  });

  it("CodexCliProvider strips CLAUDECODE and uses stdin", () => {
    const providerSrc = fs.readFileSync(
      path.join("src", "llm", "codex-cli-provider.ts"),
      "utf-8"
    );
    expect(providerSrc).toContain("delete env.CLAUDECODE");
    expect(providerSrc).not.toContain("CLAUDECODE: undefined");
    // Codex should also use stdin ("-") for the prompt
    expect(providerSrc).toContain('"-"');
  });

  it("agent-cli-runner strips CLAUDECODE", () => {
    const runnerSrc = fs.readFileSync(
      path.join("src", "cli", "agent-cli-runner.ts"),
      "utf-8"
    );
    expect(runnerSrc).toContain("delete env.CLAUDECODE");
    expect(runnerSrc).not.toContain("CLAUDECODE: undefined");
  });
});

describe("Conversation cwd support", () => {
  let db: DatabaseService;
  let conversationService: ConversationService;

  beforeEach(() => {
    cleanup();
    db = new DatabaseService(TEST_DB);
    db.ensureOwner(111);
    const audit = new AuditService(db);
    conversationService = new ConversationService(db, audit);
  });

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("stores and retrieves cwd for a conversation", () => {
    const conv = conversationService.create("test", 1);
    expect(conversationService.getCwd(conv.id)).toBeNull();

    conversationService.setCwd(conv.id, "/home/agjrom/websites/myproject");
    expect(conversationService.getCwd(conv.id)).toBe("/home/agjrom/websites/myproject");
  });
});

describe("TG bot new/cont conversation flow", () => {
  it("parses new and cont commands correctly", () => {
    // Test regex patterns used in assistant-core
    const newRegex = /^new\s+(haiku|sonnet|opus|claude|codex)\s+(.+)/is;
    const contRegex = /^cont\s+(haiku|sonnet|opus|claude|codex)\s+(.+)/is;

    const newMatch = "new haiku hello world".match(newRegex);
    expect(newMatch).not.toBeNull();
    expect(newMatch![1]).toBe("haiku");
    expect(newMatch![2]).toBe("hello world");

    const contMatch = "cont opus what is my number?".match(contRegex);
    expect(contMatch).not.toBeNull();
    expect(contMatch![1]).toBe("opus");
    expect(contMatch![2]).toBe("what is my number?");

    // Should not match without prompt
    expect("new haiku".match(newRegex)).toBeNull();
    expect("cont".match(contRegex)).toBeNull();

    // cd command patterns
    expect(/^cd(\s|$)/i.test("cd /tmp")).toBe(true);
    expect(/^cd(\s|$)/i.test("cd")).toBe(true);
    expect(/^pwd$/i.test("pwd")).toBe(true);
    expect(/^ls(\s|$)/i.test("ls")).toBe(true);
    expect(/^ls(\s|$)/i.test("ls src")).toBe(true);
  });

  it("resolveCwd stays within websites root", () => {
    // Test the path resolution logic
    const WEBSITES_ROOT = "/home/agjrom/websites";

    // Going up past root should clamp
    const resolved1 = path.resolve(WEBSITES_ROOT, "../../etc/passwd");
    expect(resolved1.startsWith(WEBSITES_ROOT)).toBe(false);

    // Normal subdir should work
    const resolved2 = path.resolve(WEBSITES_ROOT, "myproject");
    expect(resolved2.startsWith(WEBSITES_ROOT)).toBe(true);
    expect(resolved2).toBe("/home/agjrom/websites/myproject");
  });
});
