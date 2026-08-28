standard-tier red-team pass for B3

commit under test: c288020a4b865c8b5227525991cc3413157ed6b9
scope authority: A2 has no requirement text; B3 scope text is the authority.

Lens 1 - service deletion: PASS. The fixed commit removes the literal service-layer targets:
src/services/overmind-service.ts, src/services/overmind-watcher.ts,
src/services/overmind-brain.ts, src/services/overmind-notifications.ts, and
src/services/overmind/.

Lens 2 - test discrimination: PASS. tests/overmind-removal-services.test.ts uses a literal
path specimen list and filesystem existence checks. Reintroducing any listed service file or
directory makes the focused test fail.

Lens 3 - scope bleed/deferred cleanup: PASS. Residual OVM imports outside the service layer are
owned by adjacent rows: B2 removes API registration, B4 removes bootstrap wiring, and G1 removes
dead residual source/tests/tools. They are not treated as B3 product-code replacement.

Lens 4 - guardian dependency: PASS. buildGuardianEscalationNotification is not present in src.
