import { FC } from "react";

import { PulsingEllipsis } from "./PulsingEllipsis";

export const GridLoadingOverlay: FC = () => {
  return <PulsingEllipsis text="Loading" />;
};
