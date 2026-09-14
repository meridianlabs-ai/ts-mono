// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  testEvalSpec,
  testModelConfig,
  testModelUsage,
} from "@tsmono/inspect-common/testing";
import { modelRoleNames } from "@tsmono/inspect-common/utils";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks } from "@tsmono/react/testing";

import { buildArgsByRole, buildConfigsByRole } from "./configsForUsage";
import { UsagePanel } from "./UsagePanel";

afterEach(cleanup);

describe("UsagePanel role names", () => {
  it.each(Object.getOwnPropertyNames(Object.prototype))(
    "renders the config, arguments and alias of a role named %s",
    (role) => {
      const spec = testEvalSpec({
        model_roles: {
          [role]: testModelConfig({
            model: "mockllm/special",
            config: { temperature: 0.5 },
            args: { seed: 7 },
          }),
          grader: testModelConfig({ model: "mockllm/grader" }),
        },
      });
      render(
        <ComponentStateProvider hooks={makeStateHooks()}>
          <UsagePanel
            configs_by_role={buildConfigsByRole(spec)}
            args_by_role={buildArgsByRole(spec)}
            role_aliases={modelRoleNames(spec.model_roles)}
          />
        </ComponentStateProvider>
      );

      expect(screen.getByText(role)).toBeTruthy();
      expect(screen.getByText("mockllm/special")).toBeTruthy();
      expect(screen.getByText("mockllm/grader")).toBeTruthy();
      expect(screen.getByText("temperature")).toBeTruthy();
      expect(screen.getByText("0.5")).toBeTruthy();
      expect(screen.getByText("seed")).toBeTruthy();
      expect(screen.getByText("7")).toBeTruthy();
    }
  );

  it("renders usage for a role without an alias", () => {
    render(
      <ComponentStateProvider hooks={makeStateHooks()}>
        <UsagePanel
          role_usage={{ ["__proto__"]: testModelUsage() }}
          role_aliases={modelRoleNames({
            grader: testModelConfig({ model: "mockllm/grader" }),
          })}
        />
      </ComponentStateProvider>
    );

    expect(screen.getByText("__proto__")).toBeTruthy();
    expect(screen.getByText("mockllm/grader")).toBeTruthy();
  });
});
