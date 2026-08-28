import { existsSync, readdirSync, readFileSync } from "node:fs";
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

  it("has no caller imports for removed modules or undeclared module constants", () => {
    const removedModules = [
      "overmind-helpers",
      "overmind-routes",
      "overmind-stream-manager",
      "ovm-session",
      "app-settings-service",
      "nudge-state-service",
      "overmind/pane-utils"
    ];
    const sourceFiles = ["src", "tests", "e2e"].flatMap(listFiles).filter((file) => /\.(?:[cm]?[jt]s|html)$/.test(file));

    for (const moduleName of removedModules) {
      const importPattern = new RegExp(`(?:import|from)[^\\n]*${escapeRegExp(moduleName)}`);
      const callers = sourceFiles.filter((file) => importPattern.test(readFileSync(file, "utf8")));
      expect(callers, moduleName).toEqual([]);
    }

    const app = readFileSync(resolve(root, "src/web/public/app.js"), "utf8");
    const identifiers = [...new Set(app.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? [])];
    for (const identifier of identifiers) {
      const declaration = new RegExp(`(?:^|\\n)\\s*(?:const|let|var)\\s+${identifier}\\b|import[\\s\\S]*?\\b${identifier}\\b`, "m");
      expect(declaration.test(app), identifier).toBe(true);
    }
  });

  it("keeps only terminal-chat OVM compatibility selectors", () => {
    const css = readFileSync(resolve(root, "src/web/public/style.css"), "utf8");
    const selectors = [...new Set(css.match(/\.(?:overmind|ovm)[A-Za-z0-9_-]*/g) ?? [])].sort();
    expect(selectors).toEqual([
      ".ovm-chat-bubble",
      ".ovm-chat-bubble-ovm",
      ".ovm-chat-bubble-user",
      ".ovm-chat-pill",
      ".ovm-chat-row",
      ".ovm-chat-row-ovm",
      ".ovm-chat-row-system",
      ".ovm-chat-row-user",
      ".ovm-chat-text"
    ]);
  });
});

function listFiles(directory: string): string[] {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
