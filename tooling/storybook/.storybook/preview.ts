import "bootstrap/dist/css/bootstrap.css";
import "bootstrap-icons/font/bootstrap-icons.css";

import { initialize, mswLoader } from "msw-storybook-addon";
import type { Preview } from "@storybook/react";

import { defaultHandlers } from "../../../apps/inspect/src/mocks/handlers";

initialize({ onUnhandledRequest: "bypass" });

const preview: Preview = {
  tags: ['autodocs'],
  loaders: [mswLoader],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    msw: {
      handlers: defaultHandlers,
    },
  },
};

export default preview;
