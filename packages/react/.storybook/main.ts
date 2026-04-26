import type { StorybookConfig } from "@storybook/react-vite";

import { cssModulesDts } from "../../../tooling/css-modules-dts/index.js";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: "@storybook/react-vite",
  viteFinal: (config) => {
    config.plugins = [...(config.plugins ?? []), cssModulesDts()];
    return config;
  },
};

export default config;
