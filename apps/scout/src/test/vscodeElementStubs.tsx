import { type FC, type PropsWithChildren } from "react";

// Plain-HTML stand-ins for the vscode-elements web components. The real Lit
// elements need ResizeObserver and ElementInternals (setFormValue,
// setValidity), which jsdom doesn't provide, so component tests swap them in
// via `vi.mock("@vscode-elements/react-elements", ...)` and drive the
// surrounding React code through native form controls. Handlers receive the
// native event, matching what the Lit wrappers deliver.

type NativeHandler = (e: Event) => void;

interface ButtonProps extends PropsWithChildren {
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  secondary?: boolean;
}

export const VscodeButton: FC<ButtonProps> = ({
  children,
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={(e) => onClick?.(e.nativeEvent)}
    disabled={disabled}
  >
    {children}
  </button>
);

interface SingleSelectProps extends PropsWithChildren {
  id?: string;
  value?: string;
  onChange?: NativeHandler;
  disabled?: boolean;
  className?: string;
  position?: string;
}

export const VscodeSingleSelect: FC<SingleSelectProps> = ({
  id,
  value,
  onChange,
  disabled,
  className,
  children,
}) => (
  <select
    id={id}
    value={value ?? ""}
    onChange={(e) => onChange?.(e.nativeEvent)}
    disabled={disabled}
    className={className}
  >
    {children}
  </select>
);

interface OptionProps extends PropsWithChildren {
  value?: string;
}

export const VscodeOption: FC<OptionProps> = ({ value, children }) => (
  <option value={value}>{children}</option>
);

interface TextfieldProps {
  id?: string;
  value?: string;
  onInput?: NativeHandler;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const VscodeTextfield: FC<TextfieldProps> = ({
  id,
  value,
  onInput,
  placeholder,
  disabled,
  className,
}) => (
  <input
    id={id}
    type="text"
    value={value ?? ""}
    onInput={(e) => onInput?.(e.nativeEvent)}
    onChange={() => {}}
    placeholder={placeholder}
    disabled={disabled}
    className={className}
  />
);

interface RadioGroupProps extends PropsWithChildren {
  onChange?: NativeHandler;
}

// React's synthetic change event bubbles from the radio to this div, so the
// group handler sees the checked radio as `e.target` just like the real
// <vscode-radio-group>.
export const VscodeRadioGroup: FC<RadioGroupProps> = ({
  onChange,
  children,
}) => (
  <div role="radiogroup" onChange={(e) => onChange?.(e.nativeEvent)}>
    {children}
  </div>
);

interface RadioProps {
  name?: string;
  label?: string;
  value?: string;
  checked?: boolean;
}

export const VscodeRadio: FC<RadioProps> = ({
  name,
  label,
  value,
  checked,
}) => (
  <label>
    <input
      type="radio"
      name={name}
      value={value}
      checked={checked ?? false}
      onChange={() => {}}
    />
    {label}
  </label>
);

export const VscodeDivider: FC = () => <hr />;

interface LabelProps extends PropsWithChildren {
  htmlFor?: string;
  required?: boolean;
}

export const VscodeLabel: FC<LabelProps> = ({ htmlFor, children }) => (
  <label htmlFor={htmlFor}>{children}</label>
);

export const VscodeFormHelper: FC<PropsWithChildren> = ({ children }) => (
  <p>{children}</p>
);
