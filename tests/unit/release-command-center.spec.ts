import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts/release-command-center.mjs");
const liveDb = path.join(root, "data/agjassist.db");

function fingerprint(filePath: string): string | null {
  return fs.existsSync(filePath) ? crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex") : null;
}

describe("release command center execute guard", () => {
  it("refuses --execute in a tiller environment before DB writes or pm2 spawn", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-release-guard-"));
    const pm2Probe = path.join(tempDir, "pm2-spawned");
    const fakePm2 = path.join(tempDir, "pm2");
    fs.writeFileSync(fakePm2, `#!/bin/sh\nprintf spawned > ${JSON.stringify(pm2Probe)}\n`);
    fs.chmodSync(fakePm2, 0o755);
    const before = fingerprint(liveDb);

    try {
      const result = spawnSync(process.execPath, [script, "--execute"], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          TILLER_SLICE: "G2",
          PATH: `${tempDir}${path.delimiter}${process.env.PATH || ""}`
        }
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("refused from a tiller or agent environment");
      expect(fingerprint(liveDb)).toBe(before);
      expect(fs.existsSync(pm2Probe)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
