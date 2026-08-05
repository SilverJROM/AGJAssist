import { describe, expect, it, vi } from "vitest";
import {
  backupDirFor,
  backupDist,
  parseCliArgs,
  rollback,
  runCutover,
  runPreflight,
  type CutoverDeps
} from "../src/cli/release-cutover.js";

interface FakeOptions {
  distExists?: boolean;
  /** Consumed in call order; the last value repeats once exhausted. */
  healthSequence?: boolean[];
}

type FakeDeps = CutoverDeps & {
  restart: ReturnType<typeof vi.fn>;
  copyDir: ReturnType<typeof vi.fn>;
  pathExists: ReturnType<typeof vi.fn>;
  fetchHealth: ReturnType<typeof vi.fn>;
};

function fakeDeps(opts: FakeOptions = {}): FakeDeps {
  const dirs = new Set<string>(opts.distExists === false ? [] : ["dist"]);
  const healthSequence = opts.healthSequence ?? [true];
  let healthCallIndex = 0;

  const restart = vi.fn(async () => {});
  const copyDir = vi.fn(async (from: string, to: string) => {
    if (!dirs.has(from)) throw new Error(`missing dir: ${from}`);
    dirs.add(to);
  });
  const pathExists = vi.fn(async (p: string) => dirs.has(p));
  const fetchHealth = vi.fn(async () => {
    const value = healthSequence[Math.min(healthCallIndex, healthSequence.length - 1)];
    healthCallIndex += 1;
    return value;
  });

  return {
    distDir: "dist",
    backupRoot: "backups",
    healthUrl: "http://127.0.0.1:3101/api/health",
    pm2ProcessName: "agjassist",
    now: () => "2026-08-05T12-00-00-000Z",
    pathExists,
    copyDir,
    restart,
    fetchHealth
  };
}

describe("release-cutover preflight", () => {
  it("fails when dist has not been built", async () => {
    const deps = fakeDeps({ distExists: false });
    const result = await runPreflight(deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/dist directory not found/);
  });

  it("fails when the pre-cutover baseline is already unhealthy", async () => {
    const deps = fakeDeps({ healthSequence: [false] });
    const result = await runPreflight(deps);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/pre-cutover health check failed/);
  });

  it("passes when dist exists and the baseline is healthy", async () => {
    const deps = fakeDeps();
    const result = await runPreflight(deps);
    expect(result).toEqual({ ok: true });
  });
});

describe("release-cutover backup + rollback", () => {
  it("copies dist into a timestamped backup dir and refuses to clobber an existing one", async () => {
    const deps = fakeDeps();
    const backupPath = await backupDist(deps);
    expect(backupPath).toBe(backupDirFor(deps));
    expect(deps.copyDir).toHaveBeenCalledWith("dist", backupPath);

    await expect(backupDist(deps)).rejects.toThrow(/already exists/);
  });

  it("restores dist from the backup and restarts on rollback", async () => {
    const deps = fakeDeps();
    const backupPath = await backupDist(deps);
    deps.copyDir.mockClear();

    await rollback(deps, backupPath);

    expect(deps.copyDir).toHaveBeenCalledWith(backupPath, deps.distDir);
    expect(deps.restart).toHaveBeenCalledWith(deps.pm2ProcessName);
  });
});

describe("runCutover", () => {
  it("backs up, restarts, and reports success when the post-restart health check passes", async () => {
    const deps = fakeDeps({ healthSequence: [true, true] });
    const result = await runCutover(deps);

    expect(result.ok).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(deps.restart).toHaveBeenCalledTimes(1);
    expect(deps.copyDir).toHaveBeenCalledTimes(1);
  });

  it("never backs up or restarts when preflight fails", async () => {
    const deps = fakeDeps({ distExists: false });
    const result = await runCutover(deps);

    expect(result.ok).toBe(false);
    expect(deps.restart).not.toHaveBeenCalled();
    expect(deps.copyDir).not.toHaveBeenCalled();
  });

  it("rolls back automatically when the post-restart health check fails", async () => {
    const deps = fakeDeps({ healthSequence: [true, false] });
    const result = await runCutover(deps);

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toMatch(/post-cutover health check failed/);
    expect(deps.restart).toHaveBeenCalledTimes(2);
    expect(deps.copyDir).toHaveBeenCalledTimes(2);
    expect(deps.copyDir).toHaveBeenLastCalledWith(result.backupPath, deps.distDir);
  });
});

describe("CLI arg parsing", () => {
  it("defaults to dry-run (no --execute)", () => {
    expect(parseCliArgs([])).toEqual({ execute: false });
  });

  it("only executes the live path when --execute is explicitly passed", () => {
    expect(parseCliArgs(["--execute"])).toEqual({ execute: true });
  });
});
