# B12g Test Report

## Commands

```bash
npm test -- --run tests/overmind-routes.test.ts
npm run build
npm test -- --run tests/overmind-agent-pane.test.ts
```

## Results

- `tests/overmind-routes.test.ts`: PASS, 49 tests.
- `npm run build`: PASS.
- `tests/overmind-agent-pane.test.ts`: PASS, 4 tests.

## Notes

- Targeted route tests cover attach parent `ok`, `bare-bash`, `no-session`, and detector throw fallback.
- Agent-pane parity tests were rerun because the helper now returns `unknown` for missing tmux executable errors.

