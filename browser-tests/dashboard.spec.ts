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
  await expect(page.locator(".metrics .metric")).toHaveCount(7);
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
  await expect(
    page.locator('[data-metric="rejected_submissions"] strong'),
  ).toHaveText("1");
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

test("seven database metrics filter by source, clear correctly and remove stale ACK selections", async ({
  page,
  request,
}, info) => {
  test.setTimeout(45000);
  const stamp = info.project.name + "-" + Date.now();
  const source1 = "LINE-01-" + stamp;
  const source2 = "LINE-02 &?/#-" + stamp;
  const baseline = (await (await request.get("/api/state")).json()).summary;
  const event = (source_id: string, event_id: string, quantity: number) => ({
    source_id,
    event_id,
    type: "COUNT",
    quantity,
    event_time: new Date().toISOString(),
  });
  const submitted = await request.post("/api/events", {
    data: [
      event(source1, "VALID-450", 450),
      event(source1, "BAD-501", 501),
      event(source2, "VALID-7", 7),
      event(source2, "BAD-501", 501),
      event(source2, "BAD-501-AGAIN", 501),
    ],
  });
  expect(submitted.status()).toBe(200);
  expect((await submitted.json()).results.map((r: any) => r.status)).toEqual([
    "ACCEPTED",
    "REJECTED",
    "ACCEPTED",
    "REJECTED",
    "REJECTED",
  ]);
  await page.goto("/");
  await expect(page.locator(".metrics .metric")).toHaveCount(7);
  const metric = (name: string) =>
    page.locator('[data-metric="' + name + '"] strong');
  async function assertSource(source: string) {
    const expected = (
      await (
        await request.get("/api/state?source_id=" + encodeURIComponent(source))
      ).json()
    ).summary;
    await page.locator("#source").fill(source);
    await page
      .getByRole("button", { name: "Apply filter", exact: true })
      .click();
    await expect(page.getByText("Showing " + source)).toBeVisible();
    for (const [name, value] of Object.entries(expected))
      await expect(metric(name)).toHaveText(
        Number(value).toLocaleString("en-US"),
      );
  }
  await assertSource(source1);
  await expect(metric("net_total")).toHaveText("450");
  await expect(metric("rejected_submissions")).toHaveText("1");
  await expect(page.locator("table")).toContainText("VALID-450");
  await page
    .getByRole("checkbox", { name: "Select VALID-450 from " + source1 })
    .check();
  // Hold the next filter response briefly to inspect loading and stale-data protection.
  await page.route("**/api/state*", async (route) => {
    await new Promise((r) => setTimeout(r, 200));
    await route.continue();
  });
  await page.locator("#source").fill(source2);
  await page.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ACK selected (0)", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Select VALID-450 from " + source1 }),
  ).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  const expected2 = (
    await (
      await request.get("/api/state?source_id=" + encodeURIComponent(source2))
    ).json()
  ).summary;
  for (const [name, value] of Object.entries(expected2))
    await expect(metric(name)).toHaveText(
      Number(value).toLocaleString("en-US"),
    );
  await expect(page.locator("table")).toContainText("VALID-7");
  await expect(
    page.getByRole("checkbox", { name: "Select VALID-7 from " + source2 }),
  ).not.toBeChecked();
  await page.getByRole("tab", { name: "Exceptions (2)", exact: true }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  await expect(page.locator("table")).toContainText(source2);
  await expect(page.locator("table")).not.toContainText(source1);
  await expect(page.locator("table")).toContainText(
    "integer between 1 and 500",
  );
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await expect(page.locator("#source")).toHaveValue("");
  await expect(page.getByText("Showing all sources")).toBeVisible();
  await expect(metric("net_total")).toHaveText(
    Number(baseline.net_total + 457).toLocaleString("en-US"),
  );
  await expect(metric("rejected_submissions")).toHaveText(
    Number(baseline.rejected_submissions + 3).toLocaleString("en-US"),
  );
  for (const name of ["processed_events", "pending_ack"])
    await expect(metric(name)).toHaveText(
      Number(baseline[name] + 2).toLocaleString("en-US"),
    );
  for (const name of ["duplicates", "conflicts", "unresolved"])
    await expect(metric(name)).toHaveText(
      Number(baseline[name]).toLocaleString("en-US"),
    );
  // Manual refresh uses backend counts, including a newly persisted rejection.
  await request.post("/api/events", {
    data: event(source1, "BAD-REFRESH", 501),
  });
  await page
    .getByRole("button", { name: "Refresh state", exact: true })
    .click();
  await expect(metric("rejected_submissions")).toHaveText(
    Number(baseline.rejected_submissions + 4).toLocaleString("en-US"),
  );
  await request.post("/api/events", {
    data: event(source2, "BAD-PERIODIC", 501),
  });
  await expect(metric("rejected_submissions")).toHaveText(
    Number(baseline.rejected_submissions + 5).toLocaleString("en-US"),
    { timeout: 15000 },
  );
  await page.screenshot({
    path: ".local/change-request-" + info.project.name + ".png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await assertSource("EMPTY-" + stamp);
  await expect(page.getByText("No exceptions for this source.")).toBeVisible();
  await page.route("**/api/state*", (route) => route.abort("failed"));
  await page.locator("#source").fill(source1);
  await page.getByRole("button", { name: "Apply filter", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(metric("net_total")).toHaveText("—");
  await expect(page.locator("table tbody tr")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  await page
    .getByRole("button", { name: "Refresh state", exact: true })
    .click();
  await expect(metric("net_total")).toHaveText("450");
  await expect(metric("rejected_submissions")).toHaveText("2");
});
