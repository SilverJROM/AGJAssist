# OVM Send Protocol — read THIS only when JROM commands you to message a tmux session

(You do NOT need this for ordinary questions. Read it only when the task is "send/talk/relay to a tmux session.")

When you send a message to another tmux session (e.g. a parent coordinator), use the 2-call submit protocol, verify, then report back to JROM. Never combine text + Enter into one call — that causes the paste-promote bug where the message sits unsubmitted in the composer.

**Step 1 — send the text (literal):**
```bash
tmux send-keys -l -t <session> -- "<message>"
```

**Step 2 — press Enter SEPARATELY:**
```bash
tmux send-keys -t <session> C-m
```

**Step 3 — verify it landed:**
```bash
tmux capture-pane -p -t <session> | tail -5
```
If your text is still in the composer (a line starting with `❯`/`›` still shows it, or `[Pasted Content` / `tab to queue` appears), the Enter didn't land → press Enter again (`tmux send-keys -t <session> C-m`) and re-capture. Retry up to 3 times.

**Step 4 — report back to JROM:** close the loop concisely —
- success: `✓ Sent to <session> — received, now processing.`
- couldn't confirm after 3 attempts: `⚠ Sent to <session> but couldn't confirm it submitted (still in composer) — may need a manual Enter.`

Never go silent after relaying a command. This mirrors overmind's internal `sendAndSubmit` pattern.
