// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createAppConfig } from "../../test/objectFactories";
import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import { button, inputByPlaceholder } from "../../test/webComponents";
import type { ProjectConfig } from "../../types/api-types";

import { ProjectPanel } from "./ProjectPanel";

const tagsPlaceholder = "tag1, tag2, tag3";

// A stand-in for scout.yaml behind the config endpoints: PUT checks If-Match
// against the current etag, like the real server, and can be held open.
const installConfigServer = (initialTags: string[]) => {
  const state = { config: configWithTags(initialTags), version: 1 };
  const putBodies: unknown[] = [];
  let holdPut: Promise<void> | undefined;
  const etag = () => `"v${state.version}"`;

  server.use(
    http.get("/api/v2/project/config", () =>
      HttpResponse.json<ProjectConfig>(state.config, {
        headers: { ETag: etag() },
      })
    ),
    http.put("/api/v2/project/config", async ({ request }) => {
      if (request.headers.get("If-Match") !== etag()) {
        return HttpResponse.json(
          { detail: "Precondition Failed" },
          {
            status: 412,
          }
        );
      }
      const body: unknown = await request.json();
      putBodies.push(body);
      await holdPut;
      state.config = configWithTags(tagsOf(body));
      state.version += 1;
      return HttpResponse.json<ProjectConfig>(state.config, {
        headers: { ETag: etag() },
      });
    })
  );

  return {
    putBodies,
    holdNextPut: () => {
      let release = () => {};
      holdPut = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
    changeExternally: (tags: string[]) => {
      state.config = configWithTags(tags);
      state.version += 1;
    },
  };
};

const configWithTags = (tags: string[]): ProjectConfig => ({
  filter: [],
  tags,
});

const tagsOf = (body: unknown): string[] =>
  typeof body === "object" &&
  body !== null &&
  "tags" in body &&
  Array.isArray(body.tags)
    ? body.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

const renderPanel = async () => {
  const router = createMemoryRouter([
    { path: "/", element: <ProjectPanel config={createAppConfig()} /> },
  ]);
  render(<RouterProvider router={router} />, {
    wrapper: createTestWrapper(),
  });
  const tags = await waitFor(() => inputByPlaceholder(tagsPlaceholder));
  return {
    tags,
    type: (text: string) => fireEvent.input(tags, { target: { value: text } }),
  };
};

const isDisabled = (label: string): boolean => {
  const host = button(label).closest("vscode-button");
  return host instanceof HTMLElement && host.hasAttribute("disabled");
};

// The textfield binds its inner input's value as a Lit property, so a
// value React sets lands a render later.
const settled = () => new Promise((r) => setTimeout(r, 0));

describe("ProjectPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("leaves typed tags as typed instead of reformatting them", async () => {
    installConfigServer(["alpha"]);
    const { tags, type } = await renderPanel();
    await waitFor(() => expect(tags.value).toBe("alpha"));

    type("alpha,beta");
    await settled();

    expect(tags.value).toBe("alpha,beta");
  });

  it("keeps edits typed while a save is in flight", async () => {
    const configServer = installConfigServer(["alpha"]);
    const { tags, type } = await renderPanel();
    await waitFor(() => expect(tags.value).toBe("alpha"));

    const release = configServer.holdNextPut();
    type("alpha, beta");
    fireEvent.click(button("Save Changes"));
    await waitFor(() => expect(configServer.putBodies).toHaveLength(1));
    await waitFor(() => button("Saving..."));
    type("alpha, beta, gamma");
    release();

    await waitFor(() => button("Save Changes"));
    await settled();
    expect(tagsOf(configServer.putBodies[0])).toEqual(["alpha", "beta"]);
    expect(tags.value).toBe("alpha, beta, gamma");
    expect(isDisabled("Save Changes")).toBe(false);
  });

  it("loads the server's config when the user discards after a conflict", async () => {
    const configServer = installConfigServer(["alpha"]);
    const { tags, type } = await renderPanel();
    await waitFor(() => expect(tags.value).toBe("alpha"));

    configServer.changeExternally(["external"]);
    type("alpha, beta");
    fireEvent.click(button("Save Changes"));
    fireEvent.click(await waitFor(() => button("Discard My Changes")));

    await waitFor(() =>
      expect(inputByPlaceholder(tagsPlaceholder).value).toBe("external")
    );
    expect(isDisabled("Save Changes")).toBe(true);
  });
});
