import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts", "tests/**/*.test.ts"],
    environment: "node",
    // OOM guardrails (2026-07-16, after the Jul-16 00:31 box-wide OOM: two runaway
    // agent-launched vitest processes exhausted the 61GB host and the kernel killed the
    // whole user session — tmux, pm2, guardian). Bound parallelism and per-worker heap so
    // a pathological run degrades instead of detonating. Pair with the process-level cage:
    // ~/.config/agent-protocols/lib/capped-test.sh (systemd-run MemoryMax scope).
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: 4,
        execArgv: ["--max-old-space-size=3072"]
      }
    }
  }
});
