import clsx from "clsx";
import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

import { ToolButton } from "@tsmono/react/components";

import styles from "./NavbarButton.module.css";

interface NavbarButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  label: string | ReactNode;
  className?: string | string[];
  icon?: string;
  latched?: boolean;
}

export const NavbarButton = forwardRef<HTMLButtonElement, NavbarButtonProps>(
  ({ label, className, icon, latched, ...rest }, ref) => {
    return (
      <ToolButton
        ref={ref}
        label={label}
        className={clsx(className, styles.navbarButton)}
        icon={icon}
        latched={latched}
        {...rest}
      />
    );
  }
);

NavbarButton.displayName = "NavbarButton";
