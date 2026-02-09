import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test.describe("Electron App", () => {
  test("should launch and display main window", async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, "..")],
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const title = await window.title();
    expect(title).toBe("Holophyte");

    await electronApp.close();
  });

  test("should increment counter when button clicked", async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, "..")],
    });

    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const button = window.getByRole("button");
    await expect(button).toContainText("0");

    await button.click();
    await expect(button).toContainText("1");

    await electronApp.close();
  });
});
