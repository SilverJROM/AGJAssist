import TelegramBot from "node-telegram-bot-api";
import { AssistantCore } from "./assistant-core.js";

type SendMessageOptions = Parameters<TelegramBot["sendMessage"]>[2];
type AnswerCallbackOptions = Partial<TelegramBot.AnswerCallbackQueryOptions>;

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
  private handlersRegistered = false;
  private pollingRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pollingRetryMs = 30_000;

  constructor(botToken: string, private readonly core: AssistantCore) {
    this.bot = new TelegramBot(botToken, { polling: false });
  }

  async start(): Promise<void> {
    await this.configureCommands();
    this.registerHandlers();
    await this.startPollingSafely();
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    await this.bot.sendMessage(chatId, text);
  }

  private async configureCommands(): Promise<void> {
    try {
      await this.bot.setMyCommands([
        { command: "help", description: "Show all commands" },
        { command: "app", description: "Open the web app" },
        { command: "weblogin", description: "Get a web app login code" },
        { command: "overmind", description: "Active Overmind workflows" },
        { command: "om_pause", description: "Pause Overmind checks for a workflow" },
        { command: "om_resume", description: "Resume Overmind checks for a workflow" },
        { command: "ovm_start", description: "Enter OVM chat mode" },
        { command: "ovm_end", description: "Exit OVM chat mode" },
        { command: "jobs", description: "List tmux sessions" },
        { command: "tmux_send", description: "Send command to tmux pane" }
      ]);
    } catch (error) {
      console.error("Telegram setMyCommands failed; continuing without command menu update:", error);
    }

    try {
      await this.bot.setChatMenuButton({ menu_button: { type: "commands" } });
    } catch (error) {
      console.error("Telegram setChatMenuButton failed; continuing without menu button update:", error);
    }
  }

  private registerHandlers(): void {
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;

    this.bot.on("polling_error", (error) => {
      console.error("Telegram polling error (non-fatal):", error);
    });

    this.bot.on("callback_query", async (query) => {
      try {
        if (!query.data?.startsWith("weblogin:")) return;
        if (!this.core.isAuthorized(query.from.id)) {
          await this.answerCallbackQuerySafe(query.id, { text: "Unauthorized" });
          return;
        }

        const hours = query.data.split(":")[1];
        const response = await this.core.handleCommand(`/weblogin ${hours}`);
        await this.answerCallbackQuerySafe(query.id);
        await this.sendMessageSafe(query.from.id, response);
      } catch (error) {
        console.error("Telegram callback handler error:", error);
      }
    });

    this.bot.on("message", async (message) => {
      const chatId = message.chat.id;
      const text = message.text?.trim();

      if (!text) return;

      if (!this.core.isAuthorized(message.from?.id)) {
        await this.sendMessageSafe(chatId, "Unauthorized access.");
        return;
      }

      // Show duration picker for /weblogin without args
      if (text === "/weblogin") {
        await this.sendMessageSafe(chatId, "Choose session duration:", {
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
        const fromId = message.from?.id;
        const isOvmChat = !text.startsWith("/") && fromId !== undefined && this.core.isOvmChatMode(fromId);
        if (isOvmChat) {
          await this.sendMessageSafe(chatId, "⏳ Sent to OVM — processing…");
        }

        const response = text.startsWith("/")
          ? await this.core.handleCommand(text, fromId)
          : await this.core.handleText(text, fromId);

        for (const chunk of splitMessage(response)) {
          await this.sendMessageSafe(chatId, chunk);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Telegram handler error:", error);
        await this.sendMessageSafe(chatId, `Error: ${msg}`);
      }
    });
  }

  private async startPollingSafely(): Promise<void> {
    try {
      await this.bot.startPolling();
    } catch (error) {
      console.error("Telegram startPolling failed; API/dashboard/Overmind remain online:", error);
      this.schedulePollingRetry();
      throw error;
    }
  }

  private schedulePollingRetry(): void {
    if (this.pollingRetryTimer) return;

    this.pollingRetryTimer = setTimeout(() => {
      this.pollingRetryTimer = null;
      void this.startPollingSafely().catch(() => undefined);
    }, this.pollingRetryMs);
    this.pollingRetryTimer.unref?.();
  }

  private async sendMessageSafe(
    chatId: number | string,
    text: string,
    options?: SendMessageOptions
  ): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, text, options);
    } catch (error) {
      console.error("Telegram sendMessage failed:", error);
    }
  }

  private async answerCallbackQuerySafe(
    callbackQueryId: string,
    options?: AnswerCallbackOptions
  ): Promise<void> {
    try {
      await this.bot.answerCallbackQuery(callbackQueryId, options);
    } catch (error) {
      console.error("Telegram answerCallbackQuery failed:", error);
    }
  }
}
