FINDING 1 of 3
WHAT FAILED: The focused edit test at `e2e/command-center-endpoints.spec.ts:104` is not discriminating. It assigns `patchBody` from the intercepted request but never asserts `patchBody.name`, `patchBody.base_url`, or `patchBody.model`; the only final assertion is that some PATCH request existed. A UI implementation could send stale values or wrong field names and this test would still pass.
THE FIX: In the edit test, intercept `**/api/summary-endpoints/**`, capture the PATCH body for `/api/summary-endpoints/2`, and assert literal values after Save: `name === 'test-ep-edited'`, `base_url === 'https://api.edited/v1'`, and `model === 'gpt-4-edited'`. Make the follow-up GET return the edited row and assert the row text contains `test-ep-edited` so the public UI refresh path is covered.
WHY THE LAST ATTEMPT MISSED IT: It added `patchBody` but replaced payload assertions with a request-existence check.

FINDING 2 of 3
WHAT FAILED: The focused delete test at `e2e/command-center-endpoints.spec.ts:158` is not discriminating. The route fixture returns the same two endpoints after DELETE, and the test removed the row-count assertion with a comment saying UI update is verified via request. It would pass even if the UI never refreshed or never removed the deleted endpoint from the displayed list.
THE FIX: Make the delete route fixture stateful: before DELETE return endpoints `140` and `test-ep`; after DELETE `/api/summary-endpoints/2`, return only the `140` endpoint from the follow-up GET. Assert `page.locator('[data-testid="endpoint-row"]')` has count `1` and that the sheet does not contain `test-ep`.
WHY THE LAST ATTEMPT MISSED IT: It treated observing the DELETE request as equivalent to verifying the visible remove behavior.

FINDING 3 of 3
WHAT FAILED: The focused default-radio test at `e2e/command-center-endpoints.spec.ts:195` is not discriminating. It does not wait for or assert POST `/api/summary-endpoints/2/default`, does not assert the selected id, and can pass from the browser's native radio checked state before the API/default-refresh mechanism is proven.
THE FIX: In the default test, wrap the radio click in `Promise.all` with `page.waitForRequest(req => req.url().endsWith('/api/summary-endpoints/2/default') && req.method() === 'POST')`, assert the captured id is the literal string `'2'`, make the next GET return endpoint 2 as `is_default: true`, and only then assert the second radio is checked and the first is unchecked.
WHY THE LAST ATTEMPT MISSED IT: It asserted the DOM radio state without tying that state to the default endpoint API call and refreshed fixture.
