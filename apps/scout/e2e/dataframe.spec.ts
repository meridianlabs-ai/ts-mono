import { expect, test } from "@playwright/test";

const fixture = "/e2e/fixtures/dataframe/";

test("restores saved compound filters and sort, then clears filters", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "inspect-scout-storage",
      JSON.stringify({
        version: 1,
        state: {
          gridStates: {
            DataframeView: {
              filter: {
                filterModel: {
                  explanation: {
                    filterType: "text",
                    operator: "OR",
                    conditions: [
                      { filterType: "text", type: "contains", filter: "alpha" },
                      { filterType: "text", type: "equals", filter: "beta" },
                    ],
                  },
                  value: {
                    filterType: "number",
                    type: "greaterThan",
                    filter: 0,
                  },
                },
              },
              sort: { sortModel: [{ colId: "value", sort: "asc" }] },
            },
          },
        },
      })
    )
  );
  await page.goto(fixture);
  await expect(page.getByLabel("Visible rows")).toHaveText("2");
  await expect(
    page.getByRole("gridcell", { name: "transcript-0003", exact: true })
  ).toHaveCount(0);
  await page.keyboard.press("Control+ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-1");
  await page
    .getByRole("button", { name: /Clear Filters/ })
    .click();
  await expect(page.getByLabel("Visible rows")).toHaveText("6");
});

test("renders raw values, opens the displayed row, and protects input editing", async ({
  page,
}) => {
  await page.goto(fixture);
  await expect(page.getByLabel("Visible rows")).toHaveText("6");
  await expect(
    page.getByRole("gridcell", { name: "false", exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("gridcell", {
      name: '{"index":0,"tags":["a","b"]}',
      exact: true,
    })
  ).toBeVisible();
  await page
    .getByRole("gridcell", { name: "transcript-0001", exact: true })
    .dblclick();
  await expect(page.getByLabel("Opened result")).toHaveText("result-1");
  await page.getByLabel("Unrelated input").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-1");
  await page.getByLabel("Unrelated input").blur();
  await page.keyboard.press("Control+ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-5");
});

test("numeric sort cycles ascending, descending, and original order", async ({
  page,
}) => {
  await page.goto(fixture);
  const header = page.getByRole("columnheader", { name: "value", exact: true });
  await header.click();
  await page.keyboard.press("Control+ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-2");
  await header.click();
  await page.keyboard.press("Control+ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-5");
  await header.click();
  await page.keyboard.press("Control+ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-0");
});

test("virtualizes a large dataframe and reaches the final row", async ({
  page,
}) => {
  await page.goto(`${fixture}?rows=5000`);
  await expect(page.getByLabel("Visible rows")).toHaveText("5000");
  expect(await page.getByRole("row").count()).toBeLessThan(100);
  await page.keyboard.press("Control+ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-4999");
  await expect(
    page.getByRole("gridcell", { name: "transcript-4999", exact: true })
  ).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`captures ${theme} layout and text wrapping`, async ({
    page,
  }, testInfo) => {
    await page.goto(`${fixture}?theme=${theme}`);
    await expect(page.getByLabel("Visible rows")).toHaveText("6");
    await testInfo.attach(`dataframe-${theme}`, {
      body: await page.screenshot({
        path: testInfo.outputPath(`dataframe-${theme}.png`),
      }),
      contentType: "image/png",
    });
    const cell = page.getByRole("gridcell", {
      name: "transcript-0005",
      exact: true,
    });
    const before = await cell.boundingBox();
    await page.getByRole("button", { name: "Wrap Text", exact: true }).click();
    await expect
      .poll(async () => (await cell.boundingBox())?.height ?? 0)
      .toBeGreaterThan(before?.height ?? 0);
    await testInfo.attach(`dataframe-${theme}-wrapped`, {
      body: await page.screenshot({
        path: testInfo.outputPath(`dataframe-${theme}-wrapped.png`),
      }),
      contentType: "image/png",
    });
  });
}
