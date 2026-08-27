# B1 a2 standard-tier red-team
commit=7068a983050e17a18ed43d257ebd04293a275d4c
verdict=standard-fail

Lens a1-findings-closed: PASS — spec file, cc project, App/TgApp route-effect navigate('/').
Lens redirect-product: PASS — focused test 1 green; probe `#/overmind` → Dashboard, no OVM header/cards.
Lens D-082 redirect test: PASS — specimens `#/overmind|#/overmind-projects|#/conversations|#/overmind-xyz`, expected literal `http://localhost:3210/index.html#/`.
Lens header-test discrimination: FAIL — allTextContents/count at DCL on empty #app; absence asserts are vacuous.
Lens alias overmind-helpers tabs: leftover G1; app.js imports nav-helpers. Not this slice.
Lens FriendlyTerminalView: PASS — still present.
Lens conditional-hooks (useEffect after Login return): logged-in path used by cc; does not fail A1.
