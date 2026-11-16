import clsx from "clsx";
import { FC, KeyboardEvent, useId, useState } from "react";

import { AnchoredPopover } from "@tsmono/react/components";
import { Icon } from "@tsmono/react/icons";

import styles from "./SelectDropdown.module.css";

export interface SelectDropdownOption {
  value: string;
  label: string;
}

interface SelectDropdownProps {
  value: string;
  options: SelectDropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * A select-only combobox whose list opens in an anchored popover. Focus stays
 * on the trigger and the active option is tracked with
 * `aria-activedescendant`, matching the keyboard model of the
 * `VscodeSingleSelect` it replaces. Escape and outside clicks are the
 * popover's light dismiss.
 */
export const SelectDropdown: FC<SelectDropdownProps> = ({
  value,
  options,
  onChange,
  disabled = false,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [trigger, setTrigger] = useState<HTMLDivElement | null>(null);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];

  const show = () => {
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    setOpen(false);
    if (option && option.value !== value) onChange(option.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const key = e.key;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      const next =
        key === "ArrowDown"
          ? Math.min(active + 1, options.length - 1)
          : Math.max(active - 1, 0);
      setActive(next);
      scrollIntoView(document.getElementById(optionId(next)));
    } else if (key === "Enter") {
      choose(active);
    } else if (key !== " ") {
      return;
    }
    e.preventDefault();
  };

  return (
    <>
      <div
        ref={setTrigger}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        className={clsx(styles.trigger, className)}
        onClick={() => {
          if (disabled) return;
          if (open) setOpen(false);
          else show();
        }}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.label}>{selected?.label ?? ""}</span>
        <Icon name="chevronDown" className={styles.chevron} />
      </div>
      <AnchoredPopover
        open={open}
        onClose={() => setOpen(false)}
        anchor={trigger}
        placement="bottom-start"
        offset={0}
        id={listId}
        role="listbox"
        className={styles.list}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={index === selectedIndex ? scrollIntoView : undefined}
            id={optionId(index)}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={index === selectedIndex}
            className={clsx(styles.option, index === active && styles.active)}
            onMouseMove={() => {
              if (index !== active) setActive(index);
            }}
            onClick={() => choose(index)}
          >
            {option.label}
          </button>
        ))}
      </AnchoredPopover>
    </>
  );
};

const scrollIntoView = (option: HTMLElement | null) => {
  option?.scrollIntoView({ block: "nearest" });
};
