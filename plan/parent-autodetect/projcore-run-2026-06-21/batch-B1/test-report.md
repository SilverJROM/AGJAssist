# batch-B1 test report

**Build:** `npx tsc --noEmit` — clean (no errors).  
**Test command:** `npx vitest run tests/overmind-parent-session-resolver.test.ts`  
**Result:** 10 tests passed (0 failures). Duration ~5ms (all fixtures).

All tests are pure (fixtures only passed to `selectParentCandidate`; `listTmuxSessions` / `resolveParentSession` not exercised in unit tests per brief). Every required case + supporting verification included. Outcomes asserted (full `ParentResolution` shape).

## deriveBaseName coverage (directly enables R1 + R3 base extraction)
- `deriveBaseName("agj-4")` → `"agj"`
- `deriveBaseName("hris-23")` → `"hris"`
- `deriveBaseName("agj")` → `"agj"`
- `deriveBaseName("lkvc-grok")` → `"lkvc"`
- `deriveBaseName("helm-codex55-planner")` → `"helm"`

Test: "strips trailing -digits and child-role suffixes (the 5 cases)" — PASS

## selectParentCandidate cases

### 1. exact fast path [R3]
Test: 'exact fast path (stored "agj-4", live "agj-4" → session "agj-4", method exact) [R3]'  
Fixture: `[{ name: "agj-4", group: "agj", attached: true, activity: 100 }]`  
Result asserted:  
`{ session: "agj-4", base: "agj", candidates: ["agj-4"], method: "exact", ambiguous: false }`  
PASS

### 2. base→group pick [R1]
Test: 'base→group pick (stored "agj", live agj-4 group agj → "agj-4", method group) [R1]'  
Fixture: `[{ name: "agj-4", group: "agj", ... }]`  
Result: session="agj-4", method="group"  
PASS

### 3. child exclusion [R2]
Test: 'child exclusion (stored "lkvc", live lkvc-24 group lkvc + lkvc-grok/lkvc-sonnet/lkvc-codex55 group "" → "lkvc-24", children never returned) [R2]'  
Fixture has parent + 3 children.  
Result: session="lkvc-24", method="group", candidates=["lkvc-24"] only; explicitly asserts children absent.  
PASS (proves R2: "Children never selected as parent")

### 4. self-heal [R3]
Test: 'self-heal (stored "hris-19" dead, live hris-23 group hris → "hris-23") [R3]'  
Result: session="hris-23", method="group" (backward compat + heals on suffix change while alive group match works)  
PASS

### 5. prefix fallback
Test: 'prefix fallback (no group set: stored "rsp", live "rsp-0" group "" → "rsp-0" via prefix)'  
Result: session="rsp-0", method="prefix"  
PASS

### 6. none-found
Test: 'none-found (stored "ghost", no match → session null, method none)'  
Result: session=null, method="none", ambiguous=false, candidates=[]  
PASS

### 7. ambiguous flag
Test: 'ambiguous flag (two attached candidates same base → ambiguous true)'  
Fixture: two attached agj-* with group=agj.  
Result: session= top-ranked, method="group", ambiguous=true  
PASS (per spec: >=2 attached → ambiguous)

### Supporting (ensures algorithm per brief)
- ranking prefers attached then activity (attached wins even vs very high activity non-attached)
- exact fast path is skipped for child-role names (stored child name does not take exact even if session exists)

All 10 tests: PASS.

**R mapping summary**  
- R1 (base-name resolution via group): covered by group pick test + derive  
- R2 (children never selected): child exclusion test + isChildRoleNamed in all paths + exact skip  
- R3 (backward + self-healing): exact + self-heal (dead full → live group) + derive on full names  

No failures. Deterministic, fixture-based proof of the pure resolver.
