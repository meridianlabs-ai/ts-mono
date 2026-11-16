// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SelectDropdown } from "./SelectDropdown";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

const Harness = ({
  initial = "b",
  onChange = () => {},
  disabled = false,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) => {
  const [value, setValue] = useState(initial);
  return (
    <SelectDropdown
      value={value}
      options={options}
      disabled={disabled}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
    />
  );
};

const activeLabel = (combobox: HTMLElement) => {
  const id = combobox.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : undefined;
};

beforeAll(() => {
  // jsdom doesn't implement it.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

describe("SelectDropdown", () => {
  it("opens on ArrowDown at the selected option, and Enter picks the active one", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combobox = screen.getByRole("combobox");

    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(combobox.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeDefined();
    expect(activeLabel(combobox)).toBe("Beta");

    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(activeLabel(combobox)).toBe("Gamma");

    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(combobox.textContent).toBe("Gamma");
  });

  it("keeps the list open on Space and doesn't report an unchanged value", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const combobox = screen.getByRole("combobox");

    fireEvent.keyDown(combobox, { key: " " });
    fireEvent.keyDown(combobox, { key: "ArrowUp" });
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    fireEvent.keyDown(combobox, { key: " " });
    expect(screen.getByRole("listbox")).toBeDefined();

    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks the selected option and picks an option on click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.getByRole("option", { selected: true }).textContent).toBe(
      "Beta"
    );
    fireEvent.click(screen.getByRole("option", { name: "Alpha" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("a");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("doesn't open while disabled", () => {
    render(<Harness disabled />);
    const combobox = screen.getByRole("combobox");
    fireEvent.click(combobox);
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
