import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("command-center promotion cleanup", () => {
  it("removes the retired OVM implementation, tests, and mockup revisions", () => {
    const removedPaths = [
      "src/api/routes/overmind-routes.ts",
      "src/api/websocket/overmind-stream-manager.ts",
      "src/services/overmind",
      "src/services/ovm-session.ts",
      "src/tools/propose-overmind-projects.ts",
      "src/web/public/overmind-helpers.js",
      "tests/overmind-service.test.ts",
      "tests/ovm-session.test.ts",
      "e2e/command-center-ovm.spec.ts",
      "e2e/command-center-ovm-fence.spec.ts",
      "AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.r1.html",
      "AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.r2.html",
      "AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.r3.html",
      "AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.r4.html",
      "AGJ_Upgrade/command-center-2026-08-26/mockups/final/PROMPT-r2.txt",
      "AGJ_Upgrade/command-center-2026-08-26/mockups/final/grok-run-r2.log"
    ];

    for (const path of removedPaths) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
    expect(existsSync(resolve(root, "AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html"))).toBe(true);
  });

  it("leaves no client route or server registration for the retired screens and API", () => {
    const app = readFileSync(resolve(root, "src/web/public/app.js"), "utf8");
    const server = readFileSync(resolve(root, "src/api/server.ts"), "utf8");

    expect(app).not.toContain("function OvermindWorkflows");
    expect(app).not.toContain("function OvermindProjects");
    expect(app).not.toContain("function OvmConsole");
    expect(app).not.toContain("/api/overmind/");
    expect(server).not.toContain("/api/overmind/");
  });
});
