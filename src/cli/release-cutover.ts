// RELEASE-ATOMIC cutover for the locally pm2-managed AGJAssist deploy on
// 127.0.0.1:3101 (permitted-target allowlist + link-code changes, N2).
//
// Every side effect (filesystem copy, pm2 reload, health check) is injected
// so preflight/backup/rollback can be exercised with fakes -- see
// tests/release-cutover.test.ts. The CLI entrypoint below wires the real,
// live-capable dependencies, but only touches anything when a human passes
// --execute; firing it against the live process is a release-owner decision.
// See plan/02-worker-agent-and-dashboard/findings/release-review/N2.md in
// the lokalAI repo.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

export interface CutoverDeps {
  distDir: string;
  backupRoot: string;
  healthUrl: string;
  pm2ProcessName: string;
  now: () => string;
  pathExists: (p: string) => Promise<boolean>;
  copyDir: (from: string, to: string) => Promise<void>;
  restart: (processName: string) => Promise<void>;
  fetchHealth: (url: string) => Promise<boolean>;
}

export interface PreflightResult {
  ok: boolean;
  reason?: string;
}

export interface CutoverResult {
  ok: boolean;
  backupPath: string;
  rolledBack: boolean;
  reason?: string;
}

export async function runPreflight(deps: CutoverDeps): Promise<PreflightResult> {
  if (!(await deps.pathExists(deps.distDir))) {
    return {
      ok: false,
      reason: `dist directory not found: ${deps.distDir} -- run npm run build first`
    };
  }
  const baselineHealthy = await deps.fetchHealth(deps.healthUrl);
  if (!baselineHealthy) {
    return {
      ok: false,
      reason: `pre-cutover health check failed at ${deps.healthUrl} -- refusing to cut over an already-unhealthy service`
    };
  }
  return { ok: true };
}

export function backupDirFor(deps: CutoverDeps): string {
  return path.join(deps.backupRoot, `dist.bak-cutover-${deps.now()}`);
}

export async function backupDist(deps: CutoverDeps): Promise<string> {
  const target = backupDirFor(deps);
  if (await deps.pathExists(target)) {
    throw new Error(`backup target already exists: ${target}`);
  }
  await deps.copyDir(deps.distDir, target);
  return target;
}

export async function rollback(deps: CutoverDeps, backupPath: string): Promise<void> {
  await deps.copyDir(backupPath, deps.distDir);
  await deps.restart(deps.pm2ProcessName);
}

export async function runCutover(deps: CutoverDeps): Promise<CutoverResult> {
  const preflight = await runPreflight(deps);
  if (!preflight.ok) {
    return { ok: false, backupPath: "", rolledBack: false, reason: preflight.reason };
  }

  const backupPath = await backupDist(deps);

  await deps.restart(deps.pm2ProcessName);

  const postHealthy = await deps.fetchHealth(deps.healthUrl);
  if (!postHealthy) {
    await rollback(deps, backupPath);
    return {
      ok: false,
      backupPath,
      rolledBack: true,
      reason: `post-cutover health check failed at ${deps.healthUrl} -- rolled back to ${backupPath}`
    };
  }

  return { ok: true, backupPath, rolledBack: false };
}

function liveDeps(): CutoverDeps {
  const distDir = path.resolve(process.cwd(), "dist");
  return {
    distDir,
    backupRoot: process.cwd(),
    healthUrl: "http://127.0.0.1:3101/api/health",
    pm2ProcessName: "agjassist",
    now: () => new Date().toISOString().replace(/[:.]/g, "-"),
    pathExists: async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    copyDir: async (from, to) => {
      await fs.cp(from, to, { recursive: true });
    },
    restart: async (processName) => {
      await execFileAsync("pm2", ["reload", processName]);
    },
    fetchHealth: async (url) => {
      try {
        const res = await fetch(url);
        return res.ok;
      } catch {
        return false;
      }
    }
  };
}

export function parseCliArgs(argv: string[]): { execute: boolean } {
  return { execute: argv.includes("--execute") };
}

async function main(): Promise<void> {
  const { execute } = parseCliArgs(process.argv.slice(2));
  const deps = liveDeps();

  if (!execute) {
    console.log("[release-cutover] DRY RUN -- pass --execute to actually reload agjassist.");
    console.log(`[release-cutover] would back up ${deps.distDir} then run: pm2 reload ${deps.pm2ProcessName}`);
    console.log(`[release-cutover] would smoke-test ${deps.healthUrl} before/after and roll back on failure`);
    return;
  }

  console.log(`[release-cutover] executing live cutover of ${deps.pm2ProcessName} -- this is a release-owner action`);
  const result = await runCutover(deps);
  if (!result.ok) {
    console.error(`[release-cutover] FAILED: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[release-cutover] OK -- rollback evidence retained at ${result.backupPath}`);
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error) => {
    console.error("[release-cutover] fatal:", error);
    process.exitCode = 1;
  });
}
