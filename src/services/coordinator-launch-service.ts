import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentAssignmentService } from "./agent-assignment-service.js";
import {
  dispatchToProvider,
  ProviderDispatchRequest,
  ProviderDispatchResult
} from "./provider-dispatch-service.js";

export interface CoordinatorLaunchResult {
  success: true;
  mode: "projcore" | "coord";
  sessionTarget: string;
  provider: string;
  model: string;
  agentName: string;
  promptLength: number;
  statusFilePath?: string;
}

export class CoordinatorLaunchService {
  constructor(
    private readonly agentAssignmentService: AgentAssignmentService,
    private readonly dispatchToProviderFn: (
      req: ProviderDispatchRequest
    ) => Promise<ProviderDispatchResult> = dispatchToProvider
  ) {}

  async launch(projectId: number, mode: "projcore" | "coord"): Promise<CoordinatorLaunchResult> {
    if (mode !== "projcore" && mode !== "coord") {
      throw new Error("mode must be projcore or coord");
    }

    const resolved = this.agentAssignmentService.resolveProjectRole(projectId, mode);
    if (!resolved) {
      throw new Error(`invalid role binding: no agent bound or default for role ${mode} on project ${projectId}`);
    }

    const agent = resolved.agent;

    const promptsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../prompts/agent-os"
    );
    const corePath = path.join(promptsDir, `${mode}.core.md`);
    const overlayPath = path.join(promptsDir, "overlays", `${agent.provider}.md`);

    const core = fs.readFileSync(corePath, "utf8");
    const overlay = fs.readFileSync(overlayPath, "utf8");

    let composedPrompt = `${core.trim()}\n\n--- ${agent.provider} overlay ---\n\n${overlay.trim()}`;

    let statusFilePath: string | undefined;
    if (agent.provider === "grok") {
      statusFilePath = path.resolve("data", `agj-os-${projectId}-${mode}.status.json`);
      composedPrompt += `\n\nStatus file: ${statusFilePath}\nWrite JSON {status, commit, dev_url, notes} here for callbacks.`;
    }

    const sessionName = `agj-os-${projectId}`;

    const dispatchRequest: ProviderDispatchRequest = {
      provider: agent.provider,
      model: agent.model,
      agent: agent.name,
      effort: agent.default_effort,
      composedPrompt,
      sessionName,
      cwd: process.cwd(),
      statusFilePath,
      marker: `DISPATCH-B3-${projectId}-${mode}`
    };

    const dispatchResult = await this.dispatchToProviderFn(dispatchRequest);

    return {
      success: true,
      mode,
      sessionTarget: dispatchResult.sessionTarget,
      provider: agent.provider,
      model: agent.model,
      agentName: agent.name,
      promptLength: composedPrompt.length,
      statusFilePath
    };
  }
}
