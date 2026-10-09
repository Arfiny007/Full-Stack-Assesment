import { test, expect } from "@playwright/test";
test("dashboard submits mixed JSON, reviews exceptions and ACKs a COUNT", async ({
  page,
}, info) => {
  const source = "browser-" + info.project.name + "-" + Date.now();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Production events", exact: true }),
  ).toBeVisible();
  await page.locator("#source").fill(source);
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page.getByText("Showing " + source)).toBeVisible();
  await page.locator("#payload").fill("not json");
  await page.getByRole("button", { name: "Process events" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter valid JSON");
  await page.locator("#payload").fill(
    JSON.stringify([
      {
        source_id: source,
        event_id: "BROWSER-C",
        type: "COUNT",
        quantity: 23,
        event_time: new Date().toISOString(),
      },
      {
        source_id: source,
        event_id: "BAD",
        type: "COUNT",
        quantity: -1,
        event_time: new Date().toISOString(),
      },
    ]),
  );
  await page.getByRole("button", { name: "Process events" }).click();
  await expect(page.getByRole("status")).toContainText(
    "2 submission result(s) saved",
  );
  await expect(page.locator(".metric.primary strong")).toHaveText("23");
  await expect(page.locator("table")).toContainText("BROWSER-C");
  await page
    .getByRole("checkbox", { name: "Select BROWSER-C from " + source })
    .check();
  await page
    .getByRole("button", { name: "ACK selected (1)", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Acknowledgement results saved",
  );
  await expect(
    page.getByText("No events awaiting acknowledgement."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Exceptions (1)", exact: true }).click();
  await expect(page.locator("table")).toContainText("BAD");
  await expect(page.locator("table")).toContainText("quantity:");
  await page.screenshot({
    path: ".local/dashboard-" + info.project.name + ".png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
