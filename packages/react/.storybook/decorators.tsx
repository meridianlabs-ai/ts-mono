import { Decorator } from "@storybook/react";

import { IconsWrapper } from "../src/components/__testing__/providers";

export const withIcons: Decorator = (Story) => (
  <IconsWrapper>
    <Story />
  </IconsWrapper>
);
