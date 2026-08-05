import { FC } from "react";

import { NextPreviousNav } from "@tsmono/react/components";

import { IdentifierInfo, resultIdentifier } from "../utils/results";

import { useScannerResultPrevNext } from "./useScannerResultPrevNext";

export const ScannerResultNav: FC = () => {
  const { result, hasPrevious, hasNext, onPrevious, onNext } =
    useScannerResultPrevNext();

  return (
    <NextPreviousNav
      onPrevious={onPrevious}
      onNext={onNext}
      hasPrevious={hasPrevious}
      hasNext={hasNext}
      previousTitle="Previous result"
      nextTitle="Next result"
    >
      <span className="text-size-smallest">
        {result
          ? printIdentifier(resultIdentifier(result), result?.label)
          : undefined}
      </span>
    </NextPreviousNav>
  );
};

const printIdentifier = (
  identifier: IdentifierInfo,
  label?: string
): string => {
  let val = identifier.epoch
    ? `${identifier.id} epoch ${identifier.epoch}`
    : String(identifier.id);

  if (label && label.length > 0) {
    val += ` (${label})`;
  }
  return val;
};
