# OG Requirements

Source: user conversation for the Telegram Mini App terminal upgrade on 2026-04-06.

Status: confirmed by user on 2026-04-06

1. The terminal experience in the Telegram Mini App must become more user-friendly than the current raw terminal view.
2. The default Telegram experience should feel closer to a chat interface than to a traditional terminal canvas.
3. The user must be able to scroll up and down through terminal history easily.
4. The user must be able to type input in an easy bottom input/composer style control.
5. The entered input must be processed by the real terminal in the background, not by a fake local-only UI.
6. Terminal details and results should be presented in a more readable transcript-style format rather than only as raw dense terminal paint.
7. The system should preserve access to the real terminal backend so commands still execute against the actual tmux-backed shell.
8. In Telegram, the friendly terminal-chat experience should be the primary/default mode.
9. A raw terminal mode should remain available as an advanced fallback for cases where the friendly mode is insufficient.
10. The user must be able to enter a full-screen terminal-chat mode inside the Mini App where the interface owns the visible screen.
11. In full-screen mode, the user should mainly see the terminal-chat UI rather than surrounding app chrome.
12. Full-screen mode must provide a clear way to go back to the previous screen.
13. If Telegram back-button integration is available, it should be used along with an in-app back control.
14. The upgraded experience should continue to work within the existing app and Mini App structure rather than requiring a full platform rewrite first.
15. The delivery should be orchestrated by `$jromhead2` with the team supporting execution and validation.
16. The user wants milestone updates and completion updates sent on Telegram during execution, if supported by the existing project mechanisms.

## Confirmed Scope Note

1. Telegram milestone/completion updates are in scope and should use the existing project notification path where available.
