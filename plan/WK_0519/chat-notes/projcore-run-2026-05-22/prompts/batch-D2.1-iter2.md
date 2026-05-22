Batch-D2.1 iter2: restyle OVM web chat to look/feel like TELEGRAM messaging

Branch: feat/chat-decommission-notes-ios · Req: R10 · North-star: NS-9
This is a FRONTEND-ONLY visual/interaction restyle. The D2.1 send→reply→thinking→poll LOGIC stays exactly as-is — only markup/CSS changes.

User report (verbatim): "i dont like this i want to simulate this how telegram is functioning on messaging" (reference screenshot at /home/agjrom/TGBOTS/AGJAssist/tmp/chat.png — VIEW IT).

Telegram visual spec to replicate (from the screenshot) in OvmConsole (src/web/public/app.js ~511-742) + style.css:
1. Chat surface: a soft green Telegram-style background (subtle gradient is fine; a faint doodle pattern optional) — distinct from the app's dark panels. The transcript scrolls; newest at bottom; auto-scroll on new message.
2. Bubbles:
   - OVM (incoming): WHITE bubble, LEFT-aligned, rounded ~14px with a small tail on the bottom-left, dark text. Max-width ~78%.
   - User (outgoing): LIGHT-GREEN bubble (Telegram outgoing, ~#effdde), RIGHT-aligned, rounded ~14px with tail bottom-right, dark text.
   - Timestamp: small grey, INSIDE the bubble at bottom-right (e.g. "10:23 PM"). On outgoing bubbles add a Telegram-style "✓✓" after the time.
   - Comfortable vertical gap between bubbles; consecutive same-sender bubbles can be tighter.
3. "OVM is thinking…": render as an incoming (white, left) bubble with an animated typing indicator (three pulsing dots) — Telegram typing style.
4. Input bar (docked bottom): a rounded white "Write a message…" field with a send button on the right (a paperclip/emoji icon is optional cosmetic; the SEND must work). Enter sends; Shift+Enter newline. Keep it usable on mobile (Telegram mini-app) widths.
5. System/error lines: small centered grey pills (like Telegram's date separators) rather than bubbles.

Keep:
- All D2.1 behavior: POST /api/overmind/ovm/send, poll GET /api/overmind/ovm/reply while pending, the thinking state, open/restart/close + status controls.
- Do NOT reintroduce the terminal stream, line picker, or raw pane output.

Scope/DON'T: frontend only (app.js OvmConsole + style.css). Do NOT touch backend, the relay, Notes, the watcher, or other components. Do not restyle the Terminal tab or other tabs — only the OVM chat.

Verification: `npx tsc` clean; `npm run build` ok; describe the bubble layout you produced (left/right, colors, timestamp position) and confirm send/thinking/reply still wired. Commit `[D2.1] OVM chat: Telegram-style messaging UI (green bg, L/R bubbles, timestamps, typing dots, message bar)`. End with STATUS marker.
