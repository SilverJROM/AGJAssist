# Batch 1 Validation Checklist

## Scope
- Friendly terminal-chat foundation
- Full-screen terminal-chat entry and return behavior

## UI Validation

1. Open the Telegram Mini App and navigate to `Terminals`.
2. Confirm the route defaults to `Friendly` mode in Telegram.
3. Select an active pane.
4. Verify the transcript area is scrollable.
5. Verify the bottom composer accepts text input comfortably.
6. Send a simple command such as `pwd`.
7. Confirm the command appears as a user entry and the resulting terminal output appears as a terminal entry.
8. Send a second command such as `ls`.
9. Confirm the transcript grows and remains scrollable.
10. Enter full-screen mode.
11. Confirm the focused terminal-chat UI owns the visible screen and the bottom tab bar is hidden.
12. Use the in-app back control to leave full-screen mode.
13. Confirm the app returns safely and the transcript is still available.
14. If Telegram back integration is available, re-enter full-screen mode and confirm the Telegram back button exits correctly.
15. Switch to `Raw` mode and confirm raw terminal remains reachable.

## Regression Checks

1. Confirm the existing terminal route still allows selecting a pane.
2. Confirm disconnect still clears the active target.
3. Confirm new session modal still opens.

## Expected Result

- Friendly mode feels easier to read and use than raw terminal on Telegram.
- Commands are processed by the real terminal backend.
- Full-screen mode is immersive and reversible.
