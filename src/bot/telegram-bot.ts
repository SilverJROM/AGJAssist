import TelegramBot from "node-telegram-bot-api";
import { AssistantCore } from "./assistant-core.js";

function splitMessage(text: string, maxLen = 3900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

export class TelegramAssistant {
  private readonly bot: TelegramBot;

  constructor(botToken: string, private readonly core: AssistantCore) {
    this.bot = new TelegramBot(botToken, { polling: true });
  }

  async start(): Promise<void> {
    await this.bot.setMyCommands([
      { command: "start", description: "Show help" },
      { command: "help", description: "Show help" },
      { command: "weblogin", description: "Get a web app login code" },
      { command: "projects", description: "List all projects" },
      { command: "note", description: "Quick note: /note <project> <text>" },
      { command: "notes", description: "List notes: /notes <project>" },
      { command: "jobs", description: "List tmux jobs" },
      { command: "peek", description: "Peek tmux pane output" },
      { command: "tmux_send", description: "Send command to tmux pane" },
      { command: "tmux_create", description: "Create tmux session" },
      { command: "tmux_kill", description: "Kill tmux session" },
      { command: "llm", description: "Show LLM status" },
      { command: "timeout", description: "Show/set timeout minutes" },
      { command: "ommodel", description: "Show/set OM Ollama model" },
      { command: "app", description: "Open the web app" }
    ]);

    // Set menu button to show commands list (not web app)
    await this.bot.setChatMenuButton({ menu_button: { type: "commands" } });

    // Handle callback queries for weblogin duration buttons
    this.bot.on("callback_query", async (query) => {
      if (!query.data?.startsWith("weblogin:")) return;
      if (!this.core.isAuthorized(query.from.id)) {
        await this.bot.answerCallbackQuery(query.id, { text: "Unauthorized" });
        return;
      }

      const hours = query.data.split(":")[1];
      const response = await this.core.handleCommand(`/weblogin ${hours}`);
      await this.bot.answerCallbackQuery(query.id);
      await this.bot.sendMessage(query.from.id, response);
    });

    this.bot.on("message", async (message) => {
      const chatId = message.chat.id;
      const text = message.text?.trim();

      if (!text) return;

      if (!this.core.isAuthorized(message.from?.id)) {
        await this.bot.sendMessage(chatId, "Unauthorized access.");
        return;
      }

      // Show duration picker for /weblogin without args
      if (text === "/weblogin") {
        await this.bot.sendMessage(chatId, "Choose session duration:", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "2 hours", callback_data: "weblogin:2" },
                { text: "4 hours", callback_data: "weblogin:4" },
                { text: "8 hours", callback_data: "weblogin:8" },
                { text: "16 hours", callback_data: "weblogin:16" }
              ]
            ]
          }
        });
        return;
      }

      try {
        const response = text.startsWith("/")
          ? await this.core.handleCommand(text)
          : await this.core.handleText(text, message.from?.id);

        for (const chunk of splitMessage(response)) {
          await this.bot.sendMessage(chatId, chunk);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Telegram handler error:", error);
        await this.bot.sendMessage(chatId, `Error: ${msg}`);
      }
    });
  }
}
