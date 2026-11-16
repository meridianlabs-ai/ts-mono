import { FC } from "react";

import { ValidationCase } from "../../../types/api-types";

import { SelectDropdown } from "./SelectDropdown";

type Predicate =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "ne"
  | "contains"
  | "startswith"
  | "endswith"
  | "icontains"
  | "iequals";

const PREDICATES: { value: Predicate; label: string }[] = [
  { value: "eq", label: "Equal (eq)" },
  { value: "ne", label: "Not equal (ne)" },
  { value: "gt", label: "Greater than (gt)" },
  { value: "gte", label: "Greater or equal (gte)" },
  { value: "lt", label: "Less than (lt)" },
  { value: "lte", label: "Less or equal (lte)" },
  { value: "contains", label: "Contains" },
  { value: "startswith", label: "Starts with" },
  { value: "endswith", label: "Ends with" },
  { value: "icontains", label: "Contains (case-insensitive)" },
  { value: "iequals", label: "Equal (case-insensitive)" },
];

interface ValidationCasePredicateSelectorProps {
  value: Predicate | null;
  onChange: (predicate: Predicate) => void;
  disabled?: boolean;
  existingPredicates?: Predicate[];
}

/**
 * Dropdown component for selecting a validation case predicate.
 */
export const ValidationCasePredicateSelector: FC<
  ValidationCasePredicateSelectorProps
> = ({ value, onChange, disabled = false, existingPredicates }) => {
  const defaultValue =
    (existingPredicates?.length === 1 ? existingPredicates[0] : undefined) ??
    "eq";

  const handleChange = (selected: string) => {
    const newValue = PREDICATES.find((p) => p.value === selected)?.value;
    if (newValue) {
      onChange(newValue);
    }
  };

  return (
    <SelectDropdown
      value={value ?? defaultValue}
      options={PREDICATES}
      onChange={handleChange}
      disabled={disabled}
    />
  );
};

/**
 * Extracts unique predicate values from a list of validation cases.
 * Returns sorted array of non-empty split values.
 */
export const extractUniquePredicates = (
  cases: ValidationCase[]
): Predicate[] => {
  const predicateSet = new Set<Predicate>();
  const predicates = PREDICATES.map((p) => p.value);

  for (const c of cases) {
    if (c.predicate && predicates.includes(c.predicate)) {
      predicateSet.add(c.predicate);
    }
  }
  return Array.from(predicateSet).sort();
};
