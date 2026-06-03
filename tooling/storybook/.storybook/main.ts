import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: [
    {
      directory: "../../../packages/react/src",
      files: "**/*.stories.@(ts|tsx)",
    },
    {
      directory: "../../../apps/inspect/src",
      files: "**/*.stories.@(ts|tsx)",
      titlePrefix: "Inspect",
    },
  ],
  framework: "@storybook/react-vite",
  async viteFinal(config) {
    return {
      ...config,
      define: {
        ...config.define,
        __DEV_WATCH__: false,
        __LOGGING_FILTER__: '"*"',
        __VIEW_SERVER_API_URL__: '"/api"',
        __VIEWER_VERSION__: '"storybook"',
        __VIEWER_COMMIT__: '"dev"',
      },
      resolve: {
        ...config.resolve,
        dedupe: [
          "react",
          "react-dom",
          "@codemirror/state",
          "@codemirror/view",
          "@codemirror/language",
        ],
      },
    };
  },
};

export default config;
