import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: [
    "../../../**/*.stories.@(ts|tsx)",
  ],
  addons: ['@storybook/addon-docs'],
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
