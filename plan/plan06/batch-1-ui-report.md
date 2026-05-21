# Batch 1 UI Report

Date: 2026-04-06
Validator: `$tester`
Scope: read-only validation and artifact writing only

## Result

Batch 1 is `PARTIALLY VALIDATED`.

- Code-level validation: `PASS`
- Localhost runtime reachability: `PASS`
- Authenticated interactive UI validation: `BLOCKED`

## What Was Checked

Files reviewed:
- `plan/plan06/og-requirements.md`
- `plan/plan06/validation-plan.md`
- `plan/plan06/batch-1-checklist.md`
- `src/web/public/app.js`
- `src/web/public/style.css`
- `src/api/routes/tmux-routes.ts`
- `src/tmux/tmux-service.ts`
- `src/tmux/tmux-stream-manager.ts`

Commands run:
- `curl -s -i http://127.0.0.1:3101/`
- `curl -s -i http://127.0.0.1:3101/app.js`
- `curl -s -i http://127.0.0.1:3101/api/auth/me`
- `curl -s -i http://127.0.0.1:3101/api/tmux/sessions`
- `tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index}|#{pane_current_command}|#{pane_title}'`

## Verified

1. Friendly terminal-chat mode exists and is the default in Telegram via `const [friendlyMode, setFriendlyMode] = useState(isTgMiniApp)` in [`src/web/public/app.js`](/home/agjrom/TGBOTS/AGJAssist/src/web/public/app.js#L598).
2. The UI exposes the expected Batch 1 controls: `Friendly`, `Raw`, `Full Screen`, pane selector, transcript area, bottom composer, and disconnect action in [`src/web/public/app.js`](/home/agjrom/TGBOTS/AGJAssist/src/web/public/app.js#L667).
3. Composer input is wired to the real backend path, not a fake local-only handler: `POST /api/tmux/panes/:target/send` in [`src/web/public/app.js`](/home/agjrom/TGBOTS/AGJAssist/src/web/public/app.js#L957) backed by [`src/api/routes/tmux-routes.ts`](/home/agjrom/TGBOTS/AGJAssist/src/api/routes/tmux-routes.ts#L171) and [`src/tmux/tmux-service.ts`](/home/agjrom/TGBOTS/AGJAssist/src/tmux/tmux-service.ts#L72).
4. Transcript output is sourced from real tmux pane snapshots through `GET /api/tmux/panes/:target/output` in [`src/web/public/app.js`](/home/agjrom/TGBOTS/AGJAssist/src/web/public/app.js#L828) backed by [`src/api/routes/tmux-routes.ts`](/home/agjrom/TGBOTS/AGJAssist/src/api/routes/tmux-routes.ts#L128).
5. Full-screen focused mode and Telegram back-button integration are implemented in [`src/web/public/app.js`](/home/agjrom/TGBOTS/AGJAssist/src/web/public/app.js#L610) and styled in [`src/web/public/style.css`](/home/agjrom/TGBOTS/AGJAssist/src/web/public/style.css#L272).
6. The AGJAssist shell is reachable at `http://127.0.0.1:3101/` and serves the updated static assets. The `3100` host is not this app and should not be used as validation evidence.
7. Real tmux panes exist on the machine, so the terminal backend is present. Read-only inventory showed panes such as `agj-7:0.0|node|⠇ AGJAssist`.

## Checklist Status

- Open Mini App and navigate to `Terminals`: `NOT RUN`
- Confirm `Friendly` default in Telegram: `PASS (code-path validation)`
- Select active pane: `NOT RUN`
- Transcript scrollable: `PASS (structure/CSS validation)`
- Bottom composer accepts text: `PASS (code-path validation)`
- Send `pwd`: `BLOCKED`
- Command appears as user entry and output as terminal entry: `PASS (code-path validation), NOT RUN live`
- Send second command and keep transcript scrollable: `BLOCKED`
- Enter full-screen mode: `PASS (code-path validation), NOT RUN live`
- Full-screen owns visible screen and hides tab bar: `PASS (code-path validation)`
- In-app back exits full-screen: `PASS (code-path validation), NOT RUN live`
- Telegram back exits full-screen: `PASS (code-path validation), NOT RUN live`
- Switch to `Raw` mode: `PASS (code-path validation), NOT RUN live`
- Existing pane selection still available: `PASS (code-path validation)`
- Disconnect clears active target: `PASS (code-path validation)`
- New session modal opens: `PASS (code-path validation)`

## Blocking Limit

Interactive validation against tmux was blocked because the running app requires authentication and the allowed scope was read-only. Creating a fresh authenticated session would write session state, so I did not do that.

Evidence:
- `GET /api/auth/me` on `3101` returned `401 Missing or invalid authorization header`
- `GET /api/tmux/sessions` on `3101` returned `401 Missing or invalid authorization header`

## Findings

No Batch 1 implementation defect was proven in the reviewed code.

Residual risk remains in two places because live interaction was not exercised:
- command/result diffing may mis-group or over-append output for noisy panes
- full-screen/back behavior in actual Telegram WebView may still have edge cases despite the implemented wiring

## Recommendation

Accept Batch 1 as code-complete for this slice, but do one authenticated Mini App smoke pass before calling it fully validated:
- select a pane
- run `pwd`
- run `ls`
- enter and exit full-screen with both in-app back and Telegram back
- switch between `Friendly` and `Raw`
