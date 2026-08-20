import { expect, test, type Page } from "@playwright/test";

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || "http://localhost:3210";
const CHALLENGE = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const REDIRECT = `${APP_ORIGIN}/oauth-callback`;
const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

function authorizeQuery(extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st",
    ...extra
  });
  return params.toString();
}

function consentUrl(): string {
  return `${APP_ORIGIN}/mcp-consent.html?${authorizeQuery()}`;
}

async function mockConsentApis(
  page: Page,
  options: {
    clientName?: string;
    pool?: string[];
    decision?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const clientName = options.clientName ?? "grok";
  const pool = options.pool ?? ["NORTH"];
  await page.route(/\/api\/mcp\/consent\/context(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_name: clientName,
        client_id_suffix: CLIENT_ID.slice(-8),
        redirect_uri: REDIRECT,
        state: "st",
        pool,
        groups: [{ id: "g1", name: "North", sessions: ["NORTH"] }],
        permissions: [
          "list_sessions",
          "read_session",
          "send_message",
          "send_keys",
          "upload_image",
          "read_image"
        ]
      })
    });
  });
  await page.route(/\/api\/mcp\/consent\/decision(?:\?.*)?$/, async (route) => {
    const body = route.request().postDataJSON() as { decision?: string };
    const payload =
      options.decision ??
      (body.decision === "deny"
        ? { error: "access_denied", state: "st", redirect_uri: REDIRECT, iss: "http://localhost:3210" }
        : {
            code: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
            state: "st",
            iss: "http://localhost:3210",
            redirect_uri: REDIRECT
          });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload)
    });
  });
}

test.describe("MCP OAuth consent (B13)", () => {
  test("AC-32: consent shell has no inline script and loads external js/css", async ({ request }) => {
    const res = await request.get(`${APP_ORIGIN}/mcp-consent.html`);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).toContain('src="/mcp-consent.js"');
    expect(html).toContain('href="/mcp-consent.css"');
  });

  test("renders escaped agent name, truncated id, six perms on, lifetime off; approve redirects with code", async ({
    page
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("agj_token", "owner-token");
    });
    await mockConsentApis(page, { clientName: '<img src=x onerror=alert(1)> grok' });
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(consentUrl(), { waitUntil: "domcontentloaded" });
    const name = page.locator('[data-testid="mcp-consent-client-name"]');
    await expect(name).toBeVisible({ timeout: 10_000 });
    await expect(name).toHaveText('<img src=x onerror=alert(1)> grok');
    await expect(page.locator('[data-testid="mcp-consent-client-id"]')).toContainText("55555555");
    await expect(page.locator('[data-testid="mcp-perm-toggle"]')).toHaveCount(6);
    for (const toggle of await page.locator('[data-testid="mcp-perm-toggle"] input').all()) {
      await expect(toggle).toBeChecked();
    }
    await expect(page.locator('[data-testid="mcp-lifetime-toggle"]')).not.toBeChecked();
    await page.locator('[data-testid="mcp-scope-option"][data-session="NORTH"] input').check();
    await page.locator('[data-testid="mcp-consent-approve"]').click();
    await page.waitForURL(/\/oauth-callback\?/, { timeout: 10_000 });
    const landed = new URL(page.url());
    expect(landed.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(landed.searchParams.get("state")).toBe("st");
    expect(landed.searchParams.get("iss")).toBeTruthy();
    expect(landed.searchParams.get("error")).toBeNull();
  });

  test("deny redirects with access_denied and no code", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("agj_token", "owner-token");
    });
    await mockConsentApis(page);
    await page.goto(consentUrl(), { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="mcp-consent-deny"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="mcp-consent-deny"]').click();
    await page.waitForURL(/\/oauth-callback\?/, { timeout: 10_000 });
    const landed = new URL(page.url());
    expect(landed.searchParams.get("error")).toBe("access_denied");
    expect(landed.searchParams.get("code")).toBeNull();
    expect(landed.searchParams.get("state")).toBe("st");
  });

  test("AC-6 login/TOTP then finishWebLogin returns only to same-origin /oauth/authorize", async ({ page }) => {
    await page.route(/\/api\/auth\/2fa\/check(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ requires2FA: true })
      });
    });
    await page.route(/\/api\/auth\/code(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "owner-jwt",
          user: { id: 1, username: "jrom", displayName: "JROM", role: "owner" }
        })
      });
    });
    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate((returnTo) => {
      sessionStorage.setItem("mcp_oauth_return", returnTo);
    }, `/oauth/authorize?${authorizeQuery()}`);
    await page.locator('input[placeholder="Paste your code here..."]').fill("login-code");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator('input[placeholder="000000"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[placeholder="000000"]').fill("123456");
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL(/\/oauth\/authorize\?/, { timeout: 15_000 });
    const landed = new URL(page.url());
    expect(landed.origin).toBe(APP_ORIGIN);
    expect(landed.pathname).toBe("/oauth/authorize");
    expect(landed.searchParams.get("client_id")).toBe(CLIENT_ID);
  });

  test("finishWebLogin ignores an external mcp_oauth_return", async ({ page }) => {
    await page.route(/\/api\/auth\/2fa\/check(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ requires2FA: false })
      });
    });
    await page.route(/\/api\/auth\/code(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "owner-jwt",
          user: { id: 1, username: "jrom", role: "owner" }
        })
      });
    });
    await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 1, username: "jrom", role: "owner", totp_enabled: false })
      });
    });
    await page.route(/\/api\/(?!auth\/).*/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      sessionStorage.setItem("mcp_oauth_return", "https://evil.example/oauth/authorize?x=1");
    });
    await page.locator('input[placeholder="Paste your code here..."]').fill("login-code");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(1500);
    expect(page.url()).toMatch(/localhost:3210/);
    expect(page.url()).not.toContain("evil.example");
  });
});
