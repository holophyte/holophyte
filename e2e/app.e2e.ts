import { expect, test } from "@playwright/test";

test("app loads and shows sidebar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("text=Holophyte")).toBeVisible();
  await expect(page.locator("text=All Tasks")).toBeVisible();
});

test("sidebar shows repos section", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("text=Repos")).toBeVisible();
});

test("kanban columns are visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("text=Backlog")).toBeVisible();
  await expect(page.locator("text=To Do")).toBeVisible();
  await expect(page.locator("text=In Progress")).toBeVisible();
  await expect(page.locator("text=Review")).toBeVisible();
  await expect(page.locator("text=Done")).toBeVisible();
});

test("new task button is disabled without repo selected", async ({ page }) => {
  await page.goto("/");
  const button = page.locator("button", { hasText: "New Task" });
  await expect(button).toBeDisabled();
});

test("add repo dialog opens", async ({ page }) => {
  await page.goto("/");
  // Click the + button next to "Repos"
  const addButton = page
    .locator("button")
    .filter({ has: page.locator("svg") })
    .nth(1);
  await addButton.click();
  await expect(page.locator("text=Add Repository")).toBeVisible();
});
