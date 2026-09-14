import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const fixture = "/e2e/fixtures/dataframe/";

test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});

test("CSV matches the previous grid's output byte for byte", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(fixture);
  await expect(page.getByLabel("Visible rows")).toHaveText("6");
  await page.getByRole("button", { name: /Copy CSV/ }).click();
  await expect(page.getByRole("button", { name: /Copied/ })).toBeVisible();
  const expected = await readFile(
    new URL("./fixtures/dataframe/expected.csv", import.meta.url),
    "utf8"
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expected
  );
});

test("columns can be pinned by dragging to the edge and unpinned by dragging back", async ({
  page,
}) => {
  await page.goto(fixture);
  const grid = page.getByRole("grid", { name: "Scanner results" });
  const value = page.getByRole("columnheader", { name: "value", exact: true });
  await value
    .getByRole("button", { name: "value", exact: true })
    .dragTo(grid, { targetPosition: { x: 20, y: 16 } });
  await expect(page.getByRole("columnheader").nth(1)).toHaveAttribute(
    "aria-label",
    "value"
  );
  await grid.evaluate((element) => {
    element.scrollLeft = 400;
  });
  await expect
    .poll(() =>
      value.evaluate((element) => element.getBoundingClientRect().left)
    )
    .toBe(60);
  await grid.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await value
    .getByRole("button", { name: "value", exact: true })
    .dragTo(
      page.getByRole("columnheader", { name: "explanation", exact: true })
    );
  await grid.evaluate((element) => {
    element.scrollLeft = 400;
  });
  expect(
    await value.evaluate((element) => getComputedStyle(element).position)
  ).not.toBe("sticky");
});

test("wrapped large data stays navigable after filtering and scrolling", async ({
  page,
}) => {
  await page.goto(`${fixture}?rows=5000`);
  await page.getByRole("button", { name: "Wrap Text", exact: true }).click();
  await page.getByRole("button", { name: "Filter value", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Filter value", exact: true })
    .first()
    .fill("2");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByLabel("Visible rows")).toHaveText("1667");
  await page.getByRole("grid", { name: "Scanner results" }).focus();
  await page.keyboard.press("Control+ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-4999");
  await expect(
    page.getByRole("gridcell", { name: "transcript-4999", exact: true })
  ).toBeVisible();
  expect(await page.getByRole("row").count()).toBeLessThan(100);
  await page.getByRole("button", { name: "Toggle grid", exact: true }).click();
  await page.getByRole("button", { name: "Toggle grid", exact: true }).click();
  await expect(
    page.getByRole("gridcell", { name: "transcript-4999", exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("inspect-scout-storage"))
    )
    .toContain('"selectedResultRow":1666');
  await page.reload();
  await expect(page.getByLabel("Visible rows")).toHaveText("1667");
  await expect(
    page.getByRole("gridcell", { name: "transcript-4999", exact: true })
  ).toBeVisible();
});

test("filter controls, sorting, copy and download use the same displayed rows and columns", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(fixture);
  await page.getByRole("button", { name: "Filter value", exact: true }).click();
  await page.getByLabel("Filter operator").first().selectOption(">");
  await page
    .getByRole("spinbutton", { name: "Filter value", exact: true })
    .first()
    .fill("2");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByLabel("Visible rows")).toHaveText("2");
  await page
    .getByRole("columnheader", { name: "value", exact: true })
    .getByText("value", { exact: true })
    .click();
  await page
    .getByRole("columnheader", { name: "value", exact: true })
    .getByText("value", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle columns", exact: true })
    .click();
  await page.getByRole("button", { name: /Copy CSV/ }).click();
  await expect(page.getByRole("button", { name: /Copied/ })).toBeVisible();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  expect(csv).toContain(
    '"transcript_id","value","explanation"\r\n"transcript-0005","100",'
  );
  expect(csv).toContain(
    '"transcript-0000","10","Alpha, quoted ""text""\nnext line"'
  );
  expect(csv).not.toContain("transcript-0001");
  expect(csv).not.toContain('"metadata"');
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download CSV/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(
    /^regression_scanner_\d{8}T\d{6}\.csv$/
  );
  const path = await download.path();
  if (!path) throw new Error("Download has no local file");
  expect(await readFile(path, "utf8")).toBe(`\ufeff${csv}`);
});

test("new filters and widths survive unmounting and persisted reload; clear preserves sorting", async ({
  page,
}) => {
  await page.goto(fixture);
  await page
    .getByRole("button", { name: "Filter explanation", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Filter value", exact: true })
    .first()
    .fill("alpha");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByLabel("Visible rows")).toHaveText("2");
  const header = page.getByRole("columnheader", { name: "value", exact: true });
  await header.getByText("value", { exact: true }).click();
  const resize = page.getByRole("slider", { name: "Resize value" });
  await resize.focus();
  await page.keyboard.press("ArrowRight");
  const width = await header.evaluate(
    (element) => element.getBoundingClientRect().width
  );
  await page.getByRole("button", { name: "Toggle grid", exact: true }).click();
  await expect(page.getByRole("grid")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle grid", exact: true }).click();
  await expect(page.getByLabel("Visible rows")).toHaveText("2");
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await expect
    .poll(() =>
      header.evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBe(width);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("inspect-scout-storage"))
    )
    .toContain('"contains"');
  await page.reload();
  await expect(page.getByLabel("Visible rows")).toHaveText("2");
  await expect(header).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("button", { name: /Clear Filters/ }).click();
  await expect(page.getByLabel("Visible rows")).toHaveText("6");
  await expect(header).toHaveAttribute("aria-sort", "ascending");
});

test("columns reorder and resize, while row numbers stay pinned and activate sorted rows", async ({
  page,
}) => {
  await page.goto(fixture);
  const name = page.getByRole("columnheader", {
    name: "transcript_id",
    exact: true,
  });
  const value = page.getByRole("columnheader", { name: "value", exact: true });
  await name
    .getByRole("button", { name: "transcript_id", exact: true })
    .dragTo(value);
  await expect(page.getByRole("columnheader").nth(1)).toHaveAttribute(
    "aria-label",
    "value"
  );
  const resizer = page.getByRole("slider", { name: "Resize value" });
  const before = await value.boundingBox();
  const handle = await resizer.boundingBox();
  if (!handle || !before) throw new Error("Missing column bounds");
  await page.mouse.move(handle.x + 2, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x + 102, handle.y + 5, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      value.evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeGreaterThan(before.width + 90);
  await resizer.dblclick();
  await expect
    .poll(() =>
      value.evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeLessThan(before.width + 90);
  await resizer.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("");
  await value.getByText("value", { exact: true }).click();
  await page.getByRole("grid").evaluate((element) => {
    element.scrollLeft = 400;
  });
  const rowNumber = page.getByRole("gridcell", { name: "1", exact: true });
  await expect(rowNumber).toBeVisible();
  expect((await rowNumber.boundingBox())?.x).toBeLessThan(65);
  await rowNumber.click();
  await expect(page.getByLabel("Opened result")).toHaveText("result-2");
});

test("an empty table reports zero rows and leaves keyboard navigation inert", async ({
  page,
}) => {
  await page.goto(`${fixture}?rows=0`);
  await expect(
    page.getByText("No Rows To Show", { exact: true })
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Visible rows")).toHaveText("0");
  await expect(page.getByLabel("Opened result")).toHaveText("");
});

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
  await page.getByRole("button", { name: /Clear Filters/ }).click();
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
  await header.getByText("value", { exact: true }).click();
  await page.keyboard.press("Control+ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-2");
  await header.getByText("value", { exact: true }).click();
  await page.keyboard.press("Control+ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Opened result")).toHaveText("result-5");
  await header.getByText("value", { exact: true }).click();
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
