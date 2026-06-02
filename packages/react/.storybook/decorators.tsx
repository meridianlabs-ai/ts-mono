import { Decorator } from "@storybook/react";

import { ComponentIconProvider } from "../src/components/ComponentIconContext";
import { testIcons } from "../src/components/__testing__/icons";

export const withIcons: Decorator = (Story) => (
  <ComponentIconProvider icons={testIcons}>
    <Story />
  </ComponentIconProvider>
);
