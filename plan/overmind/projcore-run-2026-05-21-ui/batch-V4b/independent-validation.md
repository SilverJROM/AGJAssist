# Batch V4b Independent Validation

## Requirement
RU6: Make the bottom nav user-customizable with reorder via move buttons, delete/hide, add picker including Workflows, per-device localStorage persistence, and sensible defaults.

## Validation
- Bottom nav is config-driven from `getBottomNavTabs(bottomNavTabIds)`.
- Default tab ids preserve the current set: Home, Tasks, Notes, Terminal, Chat, Settings.
- Workflows is defined in the available tab registry and can be added through the picker.
- Edit mode is reachable from the mini-app home pencil button and from Settings.
- Reordering uses explicit up/down buttons; no drag behavior was added.
- Removal is guarded so the user cannot hide every tab.
- Config is persisted through localStorage key `agj_bottom_nav_tabs_v1`.

## Gate Result
PASS. RU6 is satisfied with local UI/helper changes and targeted/build verification.
