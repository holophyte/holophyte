/**
 * E2E smoke test for a Codex session launched through the picker UI.
 *
 * Uses CODEX_FAKE_TRANSPORT=1 (set in playwright.config.ts) so no real
 * `codex` binary is needed. The fake emits a scripted event stream that
 * exercises the full turn/approval pipeline.
 *
 * Provider/model/effort/permission are seeded via localStorage (same
 * technique as permission-picker.spec.ts) rather than clicking the inline
 * ProviderModelPicker whose listbox is clipped by overflow-hidden ancestors
 * on the task page. The session is then launched by typing the prompt and
 * clicking Send.
 */

import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

// ---------------------------------------------------------------------------
// LocalStorage key constants (mirror src/constants.ts)
// ---------------------------------------------------------------------------
const STORAGE_LAST_PROVIDER = 'holophyte.lastProvider';
const STORAGE_LAST_MODEL_PREFIX = 'holophyte.lastModel.';
const STORAGE_LAST_EFFORT_PREFIX = 'holophyte.lastEffort.';
const STORAGE_LAST_PERMISSION_PREFIX = 'holophyte.lastPermission.';

// ---------------------------------------------------------------------------
// Helpers (adapted from session-panel.spec.ts / permission-picker.spec.ts)
// ---------------------------------------------------------------------------

async function selectRepo(page: import('@playwright/test').Page) {
  const repoButton = page
    .locator('aside[aria-label="Navigation"]')
    .locator('button')
    .filter({ hasNotText: /All Tasks|Seed Box|Projects|Add|Command/ })
    .filter({ hasText: /e2e-/ })
    .first();
  await repoButton.click();
  await expect(
    page.getByRole('heading', { name: 'To Do', exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function createTask(
  page: import('@playwright/test').Page,
  title: string,
  prompt?: string,
) {
  const todoColumn = page
    .locator('[role="group"]')
    .filter({ has: page.getByRole('heading', { name: 'To Do', exact: true }) });
  await todoColumn.locator('button', { hasText: 'Add' }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.locator('#task-title').fill(title);
  if (prompt) await page.locator('#task-prompt').fill(prompt);
  await page.locator('button', { hasText: 'Create' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
}

async function openTaskPage(
  page: import('@playwright/test').Page,
  taskTitle: string,
) {
  const card = page.locator('[data-task-id]', { hasText: taskTitle }).first();
  await card.click();
  await page
    .locator(`button[aria-label="Open ${taskTitle} in task page"]`)
    .first()
    .click({ timeout: 5000 });
  await expect(
    page.locator('text=Send a message to start the conversation'),
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Seed localStorage with Codex provider/model/effort/permission settings.
 * Then reload the page so `useLaunchDefaults` picks them up on mount.
 * This avoids clicking the ProviderModelPicker whose listbox is clipped by
 * overflow-hidden ancestors on the task detail page.
 */
async function seedCodexLaunchDefaults(
  page: import('@playwright/test').Page,
  opts: {
    model: string;
    effort: string;
    permissionMode: string;
  },
) {
  await page.evaluate(
    ({ provider, model, effort, permission, keys }) => {
      window.localStorage.setItem(keys.provider, provider);
      window.localStorage.setItem(keys.modelPrefix + provider, model);
      window.localStorage.setItem(keys.effortPrefix + provider, effort);
      window.localStorage.setItem(keys.permissionPrefix + provider, permission);
    },
    {
      provider: 'codex',
      model: opts.model,
      effort: opts.effort,
      permission: opts.permissionMode,
      keys: {
        provider: STORAGE_LAST_PROVIDER,
        modelPrefix: STORAGE_LAST_MODEL_PREFIX,
        effortPrefix: STORAGE_LAST_EFFORT_PREFIX,
        permissionPrefix: STORAGE_LAST_PERMISSION_PREFIX,
      },
    },
  );
  // Reload so useLaunchDefaults picks up the seeded values.
  // Don't use waitForApp — it navigates to '/'. Just wait for the picker.
  await page.reload();
  // Wait for the provider model picker button to show "Codex" text,
  // confirming the seeded values were applied.
  await expect(
    page.locator('button[aria-haspopup="listbox"]').first(),
  ).toContainText('Codex', { timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Codex session smoke test', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);
  });

  test('full Codex session: launch, first turn, approval, providerSessionId', async ({
    page,
  }, testInfo) => {
    // This test covers multiple round-trips (session launch, first turn, approval
    // round-trip, second turn completion) — extend the timeout to 120s.
    testInfo.setTimeout(120000);
    const title = `E2E Codex ${Date.now()}`;
    await createTask(page, title, 'say hello and write a one-line README');
    await openTaskPage(page, title);

    // ── Step 1: configure provider/model/effort/permissionMode via localStorage
    // and reload so useLaunchDefaults reads the seeded values.
    await seedCodexLaunchDefaults(page, {
      model: 'gpt-5.4-mini',
      effort: 'medium',
      permissionMode: 'default',
    });

    // ── Step 2: send a prompt that does NOT trigger an approval ──────────────
    const textarea = page.locator(
      'textarea[placeholder*="What would you like"]',
    );
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill('say hello and write a one-line README');
    await page.locator('button', { hasText: 'Send' }).click();

    // ── Step 3: assert assistant message bubble renders ──────────────────────
    // The fake transport emits "Hello! I have written a one-line README for you."
    await expect(
      page.locator('text=Hello! I have written a one-line README for you.'),
    ).toBeVisible({ timeout: 30000 });

    // Assert at least one fileChange card renders.
    // The fake emits a fileChange item mapped to toolName 'Edit'. The ToolCallUI
    // renders it as a collapsible tool card with header "Edit file" and a
    // "Completed" status badge when the turn finishes.
    await expect(page.locator('text=Edit file').first()).toBeVisible({
      timeout: 30000,
    });

    // Assert NO permanent thinking spinner remains after turn completes.
    // The fake emits turn/completed, which clears codexTurnActive — the
    // ThinkingIndicator (data-testid="thinking-indicator") returns null when
    // isRunning is false, so it should be hidden/absent in the DOM at this
    // point. This catches the regression documented in SessionThread.tsx (lines
    // 67-69) where isThinking stays true between Codex turns if turn boundaries
    // aren't factored in. We assert at this point specifically — after turn 1
    // text and "Edit file" card are visible — but before the follow-up send
    // that starts turn 2, so the assertion is unambiguous about which turn's
    // spinner we're checking.
    await expect(page.getByTestId('thinking-indicator')).toBeHidden({
      timeout: 15000,
    });

    // ── Step 5: assert providerSessionId is non-null after first turn ────────
    // SessionPanel exposes data-provider-session-id on its root div once
    // companionUpdateProviderSessionId writes the fake thread id back to Convex.
    await expect(page.locator('[data-provider-session-id]')).toHaveAttribute(
      'data-provider-session-id',
      /fake-thread-/,
      { timeout: 15000 },
    );

    // ── Step 4: send a follow-up that triggers a file-change approval ────────
    const followUpText = 'update the README with a better title';
    // The active session uses SessionComposer. The submit button shows
    // aria-label="Stop session" when the textarea is empty (session still running),
    // but switches to "Send message" as soon as there is text to send.
    // Fill the textarea first to trigger chatStatus='ready', then click send.
    //
    // We use the SessionComposer's textarea. It has placeholder "Send a follow-up…"
    // or "Type a follow-up…" (differs by session status). If not found immediately,
    // wait — the ActiveSession may still be mounting.
    const sessionComposerTextarea = page
      .locator(
        'textarea[placeholder*="follow-up"], textarea[placeholder*="Follow-up"]',
      )
      .first();
    await expect(sessionComposerTextarea).toBeVisible({ timeout: 15000 });
    await sessionComposerTextarea.fill(followUpText);

    // With text typed, the submit button switches to aria-label="Send message".
    const activeComposer = page.locator('[aria-label="Send message"]');
    await expect(activeComposer).toBeVisible({ timeout: 10000 });
    await activeComposer.click();

    // The fake emits item/fileChange/requestApproval on turn 2.
    // The approval card should show "Write to file?" as the header.
    await expect(page.locator('text=Write to file?')).toBeVisible({
      timeout: 30000,
    });

    // Assert the approval card rendered with the correct copy ("Write to file?")
    // — already done above. Now approve it.
    const approveButton = page
      .locator('button', { hasText: 'Approve' })
      .first();
    await expect(approveButton).toBeVisible({ timeout: 5000 });
    await approveButton.click();

    // After approval, the fake resumes the turn, emits item/completed and
    // turn/completed, then the agent message "Done! Updated README.md."
    await expect(page.locator('text=Done! Updated README.md.')).toBeVisible({
      timeout: 30000,
    });

    // Confirm the approval prompt is gone (card flipped to approved/done state)
    await expect(page.locator('button', { hasText: 'Approve' })).toBeHidden({
      timeout: 5000,
    });
  });
});
