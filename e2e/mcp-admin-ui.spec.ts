import { expect, test } from "@playwright/test";

const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || "http://localhost:3210";

test.describe("MCP Access admin UI (B20)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("agj_token", "owner-token");
      localStorage.setItem(
        "agj_user",
        JSON.stringify({ id: 1, username: "e2e", displayName: "e2e", role: "owner" })
      );
    });

    let pool = ["NORTH"];
    let grants = [
      {
        id: 1,
        client_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        client_id_suffix: "aaaaaaaa",
        client_name: "grok",
        scope_type: "sessions",
        scope_ref: JSON.stringify(["NORTH"]),
        permissions: [
          "list_sessions",
          "read_session",
          "send_message",
          "send_keys",
          "upload_image",
          "read_image"
        ],
        lifetime: false,
        token_ttl_days: 7,
        status: "active",
        granted_at: "2026-08-20T08:00:00Z",
        last_used_at: "2026-08-20T09:00:00Z",
        access_expires_at: "2026-08-27T08:00:00Z"
      },
      {
        id: 2,
        client_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        client_id_suffix: "bbbbbbbb",
        client_name: "claude",
        scope_type: "sessions",
        scope_ref: JSON.stringify(["OTHER"]),
        permissions: ["list_sessions", "read_session"],
        lifetime: false,
        token_ttl_days: 7,
        status: "active",
        granted_at: "2026-08-20T08:05:00Z",
        last_used_at: null,
        access_expires_at: "2026-08-27T08:05:00Z"
      }
    ];
    const auditPage1 = Array.from({ length: 20 }, (_, i) => ({
      timestamp: `2026-08-20T10:${String(19 - i).padStart(2, "0")}:00Z`,
      agent_name: i === 1 ? "grok" : "grok",
      action_type: i === 1 ? "mcp_send_message" : "mcp_list_sessions",
      tmux_target: i === 1 ? "NORTH:0.0" : null,
      details: i === 1 ? JSON.stringify({ blocked: true }) : "{}",
      surface: "mcp"
    }));
    const auditPage2 = [
      {
        timestamp: "2026-08-20T09:50:00Z",
        agent_name: "claude",
        action_type: "mcp_pool_updated",
        tmux_target: null,
        details: "{}",
        surface: "mcp"
      }
    ];

    await page.route(/\/api\/auth\/me(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: 1, username: "e2e", display_name: "e2e", role: "owner", totp_enabled: false })
      });
    });
    await page.route(/\/api\/mcp\/pool(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { sessions?: string[] };
        pool = Array.isArray(body.sessions) ? body.sessions : pool;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: pool })
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: pool })
      });
    });
    await page.route(/\/api\/terminal\/groups(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          groups: [{ id: "g-north", name: "North", sessions: ["NORTH"] }],
          activeGroup: "all"
        })
      });
    });
    await page.route(/\/api\/mcp\/grants\/(\d+)\/scope(?:\?.*)?$/, async (route) => {
      const id = Number(route.request().url().match(/grants\/(\d+)/)?.[1]);
      const grant = grants.find((g) => g.id === id);
      if (!grant) {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not_found"}' });
        return;
      }
      const body = route.request().postDataJSON() as { sessions?: string[]; scope_type?: string; scope_ref?: string };
      if (Array.isArray(body.sessions)) {
        const missing = body.sessions.filter((s) => !pool.includes(s));
        if (missing.length) {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "outside_pool" })
          });
          return;
        }
        grant.scope_type = "sessions";
        grant.scope_ref = JSON.stringify(body.sessions);
      } else {
        grant.scope_type = body.scope_type === "group" ? "group" : "sessions";
        grant.scope_ref = String(body.scope_ref || "");
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: grant.id, scope_type: grant.scope_type, scope_ref: grant.scope_ref })
      });
    });
    await page.route(/\/api\/mcp\/grants\/(\d+)\/permissions(?:\?.*)?$/, async (route) => {
      const id = Number(route.request().url().match(/grants\/(\d+)/)?.[1]);
      const grant = grants.find((g) => g.id === id);
      const body = route.request().postDataJSON() as { permissions?: string[] };
      if (grant) grant.permissions = Array.isArray(body.permissions) ? body.permissions : grant.permissions;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id, permissions: grant?.permissions || [] })
      });
    });
    await page.route(/\/api\/mcp\/grants\/(\d+)\/lifetime(?:\?.*)?$/, async (route) => {
      const id = Number(route.request().url().match(/grants\/(\d+)/)?.[1]);
      const grant = grants.find((g) => g.id === id);
      const body = route.request().postDataJSON() as { lifetime?: boolean; confirm?: string };
      if (body.confirm !== "LIFETIME") {
        await route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"confirm_required"}' });
        return;
      }
      if (grant) grant.lifetime = body.lifetime === true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id, lifetime: grant?.lifetime === true })
      });
    });
    await page.route(/\/api\/mcp\/grants\/(\d+)\/revoke(?:\?.*)?$/, async (route) => {
      const id = Number(route.request().url().match(/grants\/(\d+)/)?.[1]);
      grants = grants.filter((g) => g.id !== id);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id, status: "revoked" })
      });
    });
    await page.route(/\/api\/mcp\/grants(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ grants })
      });
    });
    await page.route(/\/api\/mcp\/audit(?:\?.*)?$/, async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") || "0");
      const entries = offset === 0 ? auditPage1 : auditPage2;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries, limit: 20, offset })
      });
    });
    await page.route(/\/api\/(?!mcp\/|terminal\/groups|auth\/me).*/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
  });

  test("AC-22/AC-19: pool manager and audit operate at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${APP_ORIGIN}/index.html#/mcp-access`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid="mcp-access-page"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="mcp-nav-access"]')).toBeVisible();
    await expect(page.locator('[data-testid="mcp-pool-manager"]')).toBeVisible();
    await expect(page.locator('[data-testid="mcp-pool-chip"]')).toContainText("NORTH");
    await expect(page.locator('[data-testid="mcp-server-groups"]')).toContainText("North");
    await expect(page.locator('[data-testid="mcp-connected-agents"]')).toBeVisible();

    await page.locator('[data-testid="mcp-pool-add-input"]').fill("OTHER");
    await page.locator('[data-testid="mcp-pool-add"]').click();
    await expect(page.locator('[data-testid="mcp-pool-chip"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="mcp-pool-chip"][data-session="OTHER"]')).toBeVisible();

    await page.locator('[data-testid="mcp-pool-chip"][data-session="NORTH"] [data-testid="mcp-pool-remove"]').click();
    await expect(page.locator('[data-testid="mcp-pool-chip"][data-session="NORTH"]')).toHaveCount(0);

    await expect(page.locator('[data-testid="mcp-audit"]')).toBeVisible();
    await expect(page.locator('[data-testid="mcp-audit-row"]')).toHaveCount(20);
    await expect(page.locator('[data-testid="mcp-audit-row"]').first()).toContainText("mcp_list_sessions");
    await expect(page.locator('[data-testid="mcp-audit-row"]').nth(1)).toContainText("blocked");
    await expect(page.locator('[data-testid="mcp-audit-load-more"]')).toBeVisible();
    await page.locator('[data-testid="mcp-audit-load-more"]').click();
    await expect(page.locator('[data-testid="mcp-audit-row"]')).toHaveCount(21);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 390);
    expect(overflow).toBe(false);
  });

  test("AC-22: grant-row controls render at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${APP_ORIGIN}/index.html#/mcp-access`, { waitUntil: "domcontentloaded" });
    const grok = page.locator('[data-testid="mcp-grant-row"][data-grant-id="1"]');
    await expect(grok).toBeVisible({ timeout: 15_000 });
    await expect(grok.locator('[data-testid="mcp-grant-name"]')).toHaveText("grok");
    await expect(grok.locator('[data-testid="mcp-grant-id"]')).toContainText("aaaaaaaa");
    await expect(grok.locator('[data-testid="mcp-scope-picker"]')).toBeVisible();
    await expect(grok.locator('[data-testid="mcp-scope-option"]')).toHaveCount(1);
    await expect(grok.locator('[data-testid="mcp-perm-toggle"]')).toHaveCount(6);
    await expect(grok.locator('[data-testid="mcp-lifetime-toggle"]')).not.toBeChecked();
    await expect(grok.locator('[data-testid="mcp-grant-expiry-badge"]')).toBeVisible();
    await expect(grok.locator('[data-testid="mcp-revoke"]')).toBeVisible();
    await expect(page.locator('[data-testid="mcp-grant-row"][data-grant-id="2"]')).toBeVisible();
  });

  test("AC-25/AC-28/AC-30: live scope and perm edits stay isolated per grant", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${APP_ORIGIN}/index.html#/mcp-access`, { waitUntil: "domcontentloaded" });
    const grok = page.locator('[data-testid="mcp-grant-row"][data-grant-id="1"]');
    const claude = page.locator('[data-testid="mcp-grant-row"][data-grant-id="2"]');
    await expect(grok).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="mcp-pool-add-input"]').fill("OTHER");
    await page.locator('[data-testid="mcp-pool-add"]').click();
    await expect(grok.locator('[data-testid="mcp-scope-option"][data-session="OTHER"]')).toBeVisible();
    await grok.locator('[data-testid="mcp-scope-option"][data-session="OTHER"] input').check();
    await expect(grok.locator('[data-testid="mcp-scope-option"][data-session="NORTH"] input')).toBeChecked();
    await expect(grok.locator('[data-testid="mcp-scope-option"][data-session="OTHER"] input')).toBeChecked();
    await expect(claude.locator('[data-testid="mcp-scope-option"][data-session="OTHER"] input')).toBeChecked();
    await expect(claude.locator('[data-testid="mcp-scope-option"][data-session="NORTH"] input')).not.toBeChecked();

    await grok.locator('[data-testid="mcp-perm-toggle"][data-perm="send_message"] input').uncheck();
    await expect(grok.locator('[data-testid="mcp-perm-toggle"][data-perm="send_message"] input')).not.toBeChecked();
    await expect(claude.locator('[data-testid="mcp-perm-toggle"][data-perm="send_message"] input')).not.toBeChecked();

    await grok.locator('[data-testid="mcp-lifetime-toggle"]').click();
    await grok.locator('[data-testid="mcp-lifetime-confirm-input"]').fill("LIFETIME");
    await grok.locator('[data-testid="mcp-lifetime-confirm-btn"]').click();
    await expect(grok.locator('[data-testid="mcp-grant-lifetime-badge"]')).toBeVisible();
    await expect(claude.locator('[data-testid="mcp-grant-expiry-badge"]')).toBeVisible();

    await grok.locator('[data-testid="mcp-revoke"]').click();
    await grok.locator('[data-testid="mcp-revoke-confirm-btn"]').click();
    await expect(page.locator('[data-testid="mcp-grant-row"][data-grant-id="1"]')).toHaveCount(0);
    await expect(claude).toBeVisible();
  });
});
