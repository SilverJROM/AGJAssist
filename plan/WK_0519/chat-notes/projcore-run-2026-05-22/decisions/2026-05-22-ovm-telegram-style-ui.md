---
date: 2026-05-22
project: AGJAssist
type: style-correction
trigger: JROM reviewed deployed D2.1 OVM chat, said "i dont like this i want to simulate this how telegram is functioning on messaging" (+ Telegram screenshot tmp/chat.png)
source: projcore
---

**JROM decided:** the OVM web chat should look/feel like Telegram messaging.
**Action:** frontend-only restyle of OvmConsole + style.css to Telegram pattern — soft green patterned chat bg; OVM=white left bubble w/ bottom-left tail; user=light-green (#effdde) right bubble w/ bottom-right tail; in-bubble bottom-right timestamps + ✓✓ on outgoing; 3-dot typing bubble for "thinking"; centered grey pills for system/error; rounded "Write a message…" bar w/ green send button. D2.1 send→reply→poll→thinking logic untouched.
**Trust-defaults rule applied:** UI/visual implementation inside already-agreed scope (NS-9 anchors OVM chat on the Telegram relay model) = ALWAYS-OK; no escalation needed.
**Default projcore would have made:** keep the prior clean-but-generic bubble styling.
**Note:** during this revision the Anthropic API hit transient 529 overloads; no session advanced until it cleared, then the work resumed (no false BLOCKED notice was sent since the API recovered).
