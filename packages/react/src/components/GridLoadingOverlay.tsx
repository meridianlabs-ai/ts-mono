import { FC } from "react";

import { PulsingDots } from "./PulsingDots";

export const GridLoadingOverlay: FC = () => {
  return <PulsingDots size="medium" text="Loading..." />;
};
