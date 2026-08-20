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
});
