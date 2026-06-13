# PROVIDERS Registry

Derived from `src/config/providers.ts`, which is the single source of truth for provider launch behavior.
Regenerate this document from the typed registry when the registry changes; resolver behavior does not parse this file.

## grok

- Launch mode: tui
- tui launch: `grok --always-approve --agent <agent>`
- headless launch: `grok -p <prompt> -m <model>`
- Bypass flag: `--always-approve`
- Effort: --effort
- Effort flag: `--effort <effort>`
- Effort values: low, medium, high, xhigh, max
- Callback: status-file
- Worktree: supported (-w)
- Session suffix: grok

| Model | Band | Eligible roles | Session suffix |
| --- | --- | --- | --- |
| grok-build | frontier | implementer, validator, deliberation, red-team | grok |
| grok-compose-2.5-fast | cheap-fast | routine-implementer, panelist | grok |

## codex

- Launch mode: tui
- tui launch: `codex -m <model> --dangerously-bypass-approvals-and-sandbox`
- Bypass flag: `--dangerously-bypass-approvals-and-sandbox`
- Effort: -m / /model
- Effort flag: `-m <model>`
- Callback: callbacks.md + emit-status
- Worktree: not supported
- Session suffix: codex

| Model | Band | Eligible roles | Session suffix |
| --- | --- | --- | --- |
| gpt-5.5 | auditor | validator, coordinator, deliberation | codex55 |
| gpt-5.4 | mid | implementer, validator, deliberation | codex |
| gpt-5.3-codex-spark | cheap-fast | implementer, panelist | codex |

## claude

- Launch mode: skill
- skill launch: `/<skill>`
- Bypass flag: none
- Effort: thinking markers
- Effort flag: `thinking:<effort>`
- Callback: callbacks.md + emit-status
- Worktree: not supported
- Session suffix: claude

| Model | Band | Eligible roles | Session suffix |
| --- | --- | --- | --- |
| claude-opus-4-8 | auditor | coordinator, validator | opus |
| claude-sonnet-4-6 | mid | implementer | sonnet |
| claude-haiku-4-5 | cheap-fast | panelist | haiku |
