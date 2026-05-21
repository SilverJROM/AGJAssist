import crypto from "node:crypto";
import { WebSocket } from "ws";
import { LlmProvider, ChatMessage } from "./base-provider.js";

interface PendingRequest {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LocalRelayProvider implements LlmProvider {
  readonly name = "local";
  private pending = new Map<string, PendingRequest>();

  constructor(
    private readonly ws: WebSocket,
    private readonly timeoutMs = 120_000
  ) {}

  async chat(messages: ChatMessage[], maxTokens?: number): Promise<string> {
    if (this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Browser relay connection is closed");
    }

    const id = crypto.randomUUID();

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Local LLM inference timed out (120s)"));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.ws.send(JSON.stringify({
        type: "inference_request",
        id,
        messages,
        maxTokens: maxTokens || 1800
      }));
    });
  }

  handleMessage(raw: string): boolean {
    let msg: { type?: string; id?: string; content?: string; error?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return false;
    }

    if (msg.type === "inference_response" && msg.id) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        pending.resolve(msg.content || "");
      }
      return true;
    }

    if (msg.type === "inference_error" && msg.id) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        pending.reject(new Error(msg.error || "Local LLM error"));
      }
      return true;
    }

    return false;
  }

  close(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Browser relay connection closed"));
      this.pending.delete(id);
    }
  }
}
