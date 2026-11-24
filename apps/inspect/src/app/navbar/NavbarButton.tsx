import clsx from "clsx";
import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";

import { ToolButton } from "@tsmono/react/components";
import { Icon, IconName } from "@tsmono/react/icons";

import styles from "./NavbarButton.module.css";

interface NavbarButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  label: string | ReactNode;
  className?: string | string[];
  icon?: IconName;
  latched?: boolean;
  subtle?: boolean;
  /**
   * When true, renders a trailing chevron to indicate the button opens a
   * dropdown / popover. Use instead of inlining the chevron in `label` so
   * every dropdown-style navbar button looks consistent.
   */
  dropdown?: boolean;
}

export const NavbarButton = forwardRef<HTMLButtonElement, NavbarButtonProps>(
  ({ label, className, icon, latched, subtle, dropdown, ...rest }, ref) => {
    const resolvedLabel = dropdown ? (
      <>
        {label}
        <Icon name="chevronDown" className={styles.dropdownChevron} />
      </>
    ) : (
      label
    );

    return (
      <ToolButton
        ref={ref}
        label={resolvedLabel}
        className={clsx(className, styles.navbarButton)}
        icon={icon}
        latched={latched}
        subtle={subtle}
        {...rest}
      />
    );
  }
);

NavbarButton.displayName = "NavbarButton";
