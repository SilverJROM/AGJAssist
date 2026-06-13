import { ProviderResolverService, ProviderLaunchSpec } from "./provider-resolver-service.js";
import { TmuxService } from "../tmux/tmux-service.js";

export interface ProviderDispatchRequest {
  provider: string;
  model: string;
  agent: string;
  effort?: string | null;
  composedPrompt: string;
  sessionName: string;
  cwd?: string;
  statusFilePath?: string;
  marker?: string;
}

export interface ProviderDispatchResult {
  sessionTarget: string;
  launchSpec: ProviderLaunchSpec;
  promptSubmitted: boolean;
  markerVerified: boolean;
}

export class ProviderDispatchService {
  constructor(
    private readonly resolver: ProviderResolverService,
    private readonly tmuxService: TmuxService
  ) {}

  async dispatchToProvider(request: ProviderDispatchRequest): Promise<ProviderDispatchResult> {
    const launchSpec = this.resolver.resolveAgentLaunchSpec({
      provider: request.provider,
      model: request.model,
      effort: request.effort,
      agent: request.agent,
      mode: "tui"
    });

    enforceProviderContract(request, launchSpec);

    const sessionTarget = await this.ensureSession(request.sessionName, request.cwd);
    await this.tmuxService.sendCommand(sessionTarget, launchSpec.launch_cmd, true, true);

    const marker = request.marker ?? `AGJ-DISPATCH-${request.provider}-${request.model}`;
    const prompt = withDispatchMarker(request.composedPrompt, marker);
    const promptSubmitted = await this.tmuxService.sendAndSubmit(sessionTarget, prompt);
    const markerVerified = await this.verifyMarker(sessionTarget, marker);

    return {
      sessionTarget,
      launchSpec,
      promptSubmitted,
      markerVerified
    };
  }

  private async ensureSession(sessionName: string, cwd?: string): Promise<string> {
    const exists = await this.tmuxService.sessionExists(sessionName);
    if (exists) return sessionName;
    return this.tmuxService.createSession(sessionName, cwd);
  }

  private async verifyMarker(target: string, marker: string): Promise<boolean> {
    const pane = await this.tmuxService.capturePane(target, 500);
    return pane.includes(marker);
  }
}

export async function dispatchToProvider(
  request: ProviderDispatchRequest,
  resolver = new ProviderResolverService(),
  tmuxService = new TmuxService()
): Promise<ProviderDispatchResult> {
  return new ProviderDispatchService(resolver, tmuxService).dispatchToProvider(request);
}

function enforceProviderContract(request: ProviderDispatchRequest, launchSpec: ProviderLaunchSpec): void {
  if (request.provider !== "grok") return;

  if (launchSpec.callback_mechanism !== "status-file") {
    throw new Error("grok dispatch requires status-file callback mechanism");
  }
  if (!request.statusFilePath) {
    throw new Error("grok dispatch requires a statusFilePath");
  }
  if (!/(^|\s)--agent\s+\S+/.test(launchSpec.launch_cmd)) {
    throw new Error("grok dispatch requires --agent in launch_cmd");
  }
  if (!/(^|\s)--effort\s+(low|medium|high|xhigh|max)(\s|$)/.test(launchSpec.launch_cmd)) {
    throw new Error("grok dispatch requires launch-time --effort in launch_cmd");
  }
}

function withDispatchMarker(composedPrompt: string, marker: string): string {
  const trimmed = composedPrompt.trim();
  if (trimmed.includes(marker)) return trimmed;
  return `${trimmed}\n\nDispatch marker: ${marker}`;
}
