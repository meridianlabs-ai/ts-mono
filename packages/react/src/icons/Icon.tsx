import clsx from "clsx";
import { ComponentPropsWithoutRef, FC } from "react";

import { iconClasses, IconName } from "./icons";

export interface IconProps extends Omit<
  ComponentPropsWithoutRef<"i">,
  "children"
> {
  name: IconName;
}

/** Decorative by default; pass `aria-hidden={false}` with an `aria-label` when the icon carries meaning on its own. */
export const Icon: FC<IconProps> = ({ name, className, ...rest }) => (
  <i
    aria-hidden="true"
    {...rest}
    className={clsx(iconClasses[name], className)}
  />
);
