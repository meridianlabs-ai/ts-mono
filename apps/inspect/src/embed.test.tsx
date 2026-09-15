import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { InspectDataProvider } from "./embed";

vi.mock("./app_config", () => ({
  AppConfigGate: ({ children }: { readonly children: ReactNode }) => (
    <div data-testid="config-gate">{children}</div>
  ),
  useAppConfigAsync: vi.fn(),
}));

vi.mock("./log_data/FetchEngineController", () => ({
  FetchEngineController: () => <div data-testid="fetch-engine" />,
}));

it("boots the fetch engine behind resolved config for no-App data hooks", () => {
  render(
    <InspectDataProvider>
      <div>Hook consumer</div>
    </InspectDataProvider>
  );

  expect(screen.getByTestId("config-gate")).toContainElement(
    screen.getByTestId("fetch-engine")
  );
  expect(screen.getByTestId("config-gate")).toHaveTextContent("Hook consumer");
});
