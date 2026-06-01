# Batch B12b Test Report

## Commands

| Check | Command | Result |
| --- | --- | --- |
| Bash syntax | `bash -n /home/agjrom/.claude/agents/lib/overmind.sh` | PASS |
| Bash source smoke | `bash -lc 'source /home/agjrom/.claude/agents/lib/overmind.sh; is_agent_pane agj-b12b-definitely-missing'` | PASS, output `no-session` |
| Targeted parity tests | `npx vitest run tests/overmind-agent-pane.test.ts` | PASS, 4 tests |
| TypeScript build | `npm run build` | PASS |
| CLI dispatch smoke | `bash /home/agjrom/.claude/agents/lib/overmind.sh --help` | PASS |

## Fixture Coverage

- Seeded claude fixtures: `Claude Code v[0-9]`, `bypass permissions on`, `for agents`, `↓ to manage`, `claude --dangerously-skip-permissions`, `claude --model`.
- Seeded codex fixtures: `OpenAI Codex`, `codex --dangerously-bypass`, `gpt-5`, `▌`.
- Seeded bare-bash fixture: `^[a-z]+@[a-z-]+:` PS1.
- Seeded precedence fixture: codex marker plus PS1 returns `codex`.
- Seeded unknown fixture: content with no agent or PS1 markers returns `unknown`.
- Missing tmux session returns `no-session`.

## Live Pane Spot Check

Both Bash and TypeScript returned:

- `AGJ-51`: `claude`
- `AGJ-codex`: `codex`
- `rsp-rrc`: `bare-bash`
- `spark-agj-watch-driver`: `unknown`
