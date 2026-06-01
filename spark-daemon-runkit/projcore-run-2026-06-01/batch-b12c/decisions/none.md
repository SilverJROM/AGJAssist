# Decisions — B12c

No autonomous product decisions were made.

Implementation notes followed the approved plan:
- Dedicated `/api/overmind/children` was added because `child-add`/`child-rm` previously piggybacked on `/register`, while register intentionally still requires `session`/`label` until later batches.
- The new child lifecycle route is limited to updating child session/role arrays and uses the same lifecycle auth and shared identity resolver.
