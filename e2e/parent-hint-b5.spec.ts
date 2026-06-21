import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agj_token', 'b5-e2e-token');
    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'b5-e2e' }));
  });
});

const PATH = '/index.html?b5hint=1#/overmind-projects';

test('B5: Parent Session helper text in Create and Edit modals (real app.js render via static harness + real clicks, no setContent)', async ({ page }) => {
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });

  // Wait for the OVM Projects page (smoke seeds the demo card + b5hint forces load)
  await expect(page.locator('h2:has-text("OVM Projects")')).toBeVisible({ timeout: 15000 });

  // --- Reach EDIT modal via REAL clicks on actually-rendered elements ---
  const card = page.locator('.overmind-project-card').first();
  await expect(card).toBeVisible();
  // real click on summary row (exercises toggleProjectExpanded)
  await card.locator('.overmind-project-summary-row').click();
  // real click ... menu button (exercises toggleProjectMenu)
  await card.locator('button.overmind-project-menu-button').click();
  // real click Edit item (exercises handleProjectMenuEdit + openEdit + conditional render)
  await page.locator('.overmind-project-menu .context-menu-item:has-text("Edit")').click();

  const editModal = page.locator('.modal:has-text("Edit OVM Project")');
  await expect(editModal).toBeVisible();
  const editHint = editModal.getByText(/Base name \(e\.g\. agj\) — auto-resolves to the live session/i);
  await expect(editHint).toBeVisible();

  // Close edit via real UI action (Cancel button)
  await editModal.locator('button:has-text("Cancel")').click();
  await expect(editModal).toBeHidden({ timeout: 5000 });

  // --- Reach CREATE modal via REAL click on rendered button ---
  await page.locator('button:has-text("+ New Project")').click();

  const createModal = page.locator('.modal:has-text("New OVM Project")');
  await expect(createModal).toBeVisible();
  const createHint = createModal.getByText(/auto-resolves to the live session/i);
  await expect(createHint).toBeVisible();

  // Verify placeholder change (R6 part of acceptance)
  await expect(createModal.locator('input[placeholder="agj"]')).toBeVisible();

  // UI-PROOF screenshot of the rendered create form (hint visible in real DOM)
  await createModal.screenshot({ path: 'plan/parent-autodetect/projcore-run-2026-06-21/batch-B5/screenshots/parent-hint.png' });
});
