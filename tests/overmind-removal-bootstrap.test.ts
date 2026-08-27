import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const srcPath = resolve(process.cwd(), "src/index.ts");
const src = readFileSync(srcPath, "utf8");

describe("Overmind bootstrap removal", () => {
  it("src/index.ts does not import OvermindService", () => {
    expect(src).not.toContain("OvermindService");
  });

  it("src/index.ts does not import OvermindWatcher", () => {
    expect(src).not.toContain("OvermindWatcher");
  });

  it("src/index.ts does not import SonnetOvermindBrain", () => {
    expect(src).not.toContain("SonnetOvermindBrain");
  });

  it("src/index.ts does not import OvermindStreamManager", () => {
    expect(src).not.toContain("OvermindStreamManager");
  });

  it("src/index.ts does not construct OvermindService", () => {
    expect(src).not.toContain("new OvermindService");
  });

  it("src/index.ts does not start OvermindWatcher", () => {
    expect(src).not.toContain("overmindWatcher.start()");
  });

  it("src/index.ts does not inject overmind fields into API server", () => {
    expect(src).not.toContain("overmindService,");
    expect(src).not.toContain("overmindNotify,");
    expect(src).not.toContain("overmindStreamManager,");
  });

  it("src/index.ts does not set overmind service on core", () => {
    expect(src).not.toContain("setOvermindService");
  });
});
