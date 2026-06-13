import { describe, expect, it, vi } from "vitest";
import { ProviderResolverService } from "../../src/services/provider-resolver-service.js";
import { ProviderDispatchService } from "../../src/services/provider-dispatch-service.js";
import { TmuxService } from "../../src/tmux/tmux-service.js";

function makeTmuxMock() {
  return {
    sessionExists: vi.fn(async () => false),
    createSession: vi.fn(async () => "AGJ-51-grok:0.0"),
    sendCommand: vi.fn(async () => ({ message: "sent", blocked: false })),
    sendAndSubmit: vi.fn(async () => true),
    capturePane: vi.fn(async () => "loaded\nA4-DISPATCH-MARKER\n")
  } as unknown as TmuxService & {
    sessionExists: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    sendAndSubmit: ReturnType<typeof vi.fn>;
    capturePane: ReturnType<typeof vi.fn>;
  };
}

describe("ProviderDispatchService", () => {
  it("resolves grok launch with agent and effort, starts tmux, and feeds the composed prompt", async () => {
    const tmux = makeTmuxMock();
    const service = new ProviderDispatchService(new ProviderResolverService(), tmux);
    const composedPrompt = [
      "CORE prompt",
      "grok overlay",
      "Locked batch brief",
      "Status file: /tmp/a4-status.json"
    ].join("\n");

    const result = await service.dispatchToProvider({
      provider: "grok",
      model: "grok-build",
      agent: "agj-implementer",
      effort: "high",
      composedPrompt,
      sessionName: "AGJ-51-grok",
      cwd: "/repo",
      statusFilePath: "/tmp/a4-status.json",
      marker: "A4-DISPATCH-MARKER"
    });

    expect(tmux.sessionExists).toHaveBeenCalledWith("AGJ-51-grok");
    expect(tmux.createSession).toHaveBeenCalledWith("AGJ-51-grok", "/repo");
    expect(tmux.sendCommand).toHaveBeenCalledWith(
      "AGJ-51-grok:0.0",
      "grok --always-approve --agent agj-implementer --effort high",
      true,
      true
    );
    expect(tmux.sendAndSubmit).toHaveBeenCalledTimes(1);
    expect(tmux.sendAndSubmit.mock.calls[0][0]).toBe("AGJ-51-grok:0.0");
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain(composedPrompt);
    expect(tmux.sendAndSubmit.mock.calls[0][1]).toContain("A4-DISPATCH-MARKER");
    expect(result).toMatchObject({
      sessionTarget: "AGJ-51-grok:0.0",
      promptSubmitted: true,
      markerVerified: true
    });
    expect(result.launchSpec.launch_cmd).toBe(
      "grok --always-approve --agent agj-implementer --effort high"
    );
  });
});
