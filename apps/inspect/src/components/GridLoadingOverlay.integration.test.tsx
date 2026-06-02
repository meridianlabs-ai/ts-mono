import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GridLoadingOverlay } from "@tsmono/react/components";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

ModuleRegistry.registerModules([AllCommunityModule]);

interface TestRow {
  name: string;
}

describe("GridLoadingOverlay integration with AG Grid", () => {
  it("renders the custom loading overlay when loading=true", async () => {
    const { container } = render(
      <div style={{ width: "400px", height: "300px" }}>
        <AgGridReact<TestRow>
          rowData={[]}
          columnDefs={[{ field: "name" }]}
          loading={true}
          loadingOverlayComponent={GridLoadingOverlay}
        />
      </div>
    );

    await waitFor(() => {
      const statusEl = container.querySelector("[role='status']");
      expect(statusEl).not.toBeNull();
    });
  });

  it("does not render the loading overlay when loading=false", async () => {
    const { container } = render(
      <div style={{ width: "400px", height: "300px" }}>
        <AgGridReact<TestRow>
          rowData={[]}
          columnDefs={[{ field: "name" }]}
          loading={false}
          loadingOverlayComponent={GridLoadingOverlay}
        />
      </div>
    );

    // Give AG Grid time to initialize
    await new Promise((r) => setTimeout(r, 100));

    const statusEl = container.querySelector("[role='status']");
    expect(statusEl).toBeNull();
  });
});
