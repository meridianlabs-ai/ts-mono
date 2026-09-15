import { useSearchParams } from "react-router";

import { useMirrorToStore } from "@tsmono/react/hooks";

import { useStore } from "../state/store";

import { getScannerParam } from "./url";

/**
 * The `?scanner=` query param, mirrored into the store so the last scanner
 * chosen through the URL stays selected after navigating to a route without
 * the param (see `useSelectedScanner`).
 */
export const useScannerParam = (): string | undefined => {
  const [searchParams] = useSearchParams();
  const setSelectedScanner = useStore((state) => state.setSelectedScanner);
  const scanner = getScannerParam(searchParams);

  useMirrorToStore(scanner, setSelectedScanner);

  return scanner;
};
