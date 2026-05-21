# Batch V4a Independent Validation

## Requirement
RU5: Add a Workflows/Overmind card on the home screen that navigates to `#/overmind` and show a tiny live summary if cheap.

## Validation
- Web home dashboard already routed the Workflows card to `/overmind`; it now fetches `/api/overmind/workflows` and renders total plus active counts.
- Telegram mini-app home dashboard does the same for the existing Workflows card.
- Active count uses the same `isActiveStatus` definition as the Overmind dashboard Active tab.

## Gate Result
PASS. RU5 is satisfied with local UI-only changes and targeted/build verification.
