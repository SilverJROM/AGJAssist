import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SPINNER_GLYPHS, hashPane, isPaneChromeLine } from "../src/services/pane-utils.js";

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
    expect(undeclaredModuleConstants(app)).toEqual([]);
    expect(undeclaredModuleConstants(app.replace("const MCP_OAUTH_RETURN_KEY", "const REMOVED_OAUTH_RETURN_KEY")))
      .toContain("MCP_OAUTH_RETURN_KEY");
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

  it("keeps the complete neutral spinner filter used by pane ingestion", () => {
    expect([...SPINNER_GLYPHS]).toHaveLength(26);
    expect(isPaneChromeLine("  ⠧ Working (12s)")).toBe(true);
    expect(hashPane("same body\n⠧ Working (12s)")).toBe("8f6372a8b1509601faa57ff3a292cfcccb95aa2325c18b8e50b0c035ea1648fe");
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

function undeclaredModuleConstants(source: string): string[] {
  const importedNames = new Set(
    [...source.matchAll(/^import\s+\{([^}]*)\}\s+from/gm)]
      .flatMap((match) => match[1].split(",").map((name) => name.trim().split(/\s+as\s+/).pop()!.trim()))
  );
  const declaredNames = new Set(
    [...source.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\b/g)].map((match) => match[1])
  );
  const allowlist = new Set(["DAY_YYMMDD_DT", "DAY_YYMMDD_WT"]);
  const identifiers = [...new Set(source.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]*\b/g) ?? [])];
  return identifiers.filter((id) => !declaredNames.has(id) && !importedNames.has(id) && !allowlist.has(id));
}
