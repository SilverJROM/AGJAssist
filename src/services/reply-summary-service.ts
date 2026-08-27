import { DatabaseService } from "../db/database.js";
import { SummaryEndpointService } from "./summary-endpoint-service.js";

export interface SummarizeOptions {
  endpointId?: number;
}

/**
 * ReplySummaryService
 * Captures a post-solicit pane reply, summarizes it via a selected
 * OpenAI-compatible /v1/chat/completions endpoint, and persists an
 * endpoint-attributed short summary. LLM failures degrade gracefully
 * without undoing the solicit.
 */
export class ReplySummaryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly endpointService: SummaryEndpointService
  ) {}

  async summarize(agentName: string, replyText: string, options: SummarizeOptions = {}): Promise<string | null> {
    if (!agentName || !replyText) return null;

    const endpoint = options.endpointId
      ? this.endpointService.getById(options.endpointId)
      : this.endpointService.getDefault();

    if (!endpoint) return null;

    try {
      const payload = {
        model: endpoint.model,
        messages: [
          {
            role: "system",
            content:
              "You are a summarizer for agent replies. Produce a short, endpoint-attributed summary of the agent's reply. Keep it concise and factual."
          },
          { role: "user", content: replyText }
        ],
        temperature: 0.2,
        max_tokens: 256
      };

      const res = await fetch(`${endpoint.base_url.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        // Degrade gracefully on non-2xx
        return null;
      }

      const data = (await res.json()) as any;
      const summaryText = data?.choices?.[0]?.message?.content?.trim();
      if (!summaryText) return null;

      this.db.prepare(
        `INSERT INTO agent_summaries (agent_name, endpoint_id, summary_text, provenance)
         VALUES (?, ?, ?, ?)`
      ).run(agentName, endpoint.id, summaryText, "system");

      return summaryText;
    } catch {
      // LLM failure degrades without undoing solicit
      return null;
    }
  }
}
