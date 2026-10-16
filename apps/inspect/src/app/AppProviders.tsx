import { FC, ReactNode } from "react";

import {
  ComponentIconProvider,
  ComponentIcons,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";

import { inspectStateHooks } from "../state/componentStateAdapter";

import { ApplicationIcons } from "./appearance/icons";

const componentIcons: ComponentIcons = {
  arrowDown: ApplicationIcons.arrows.down,
  arrowUp: ApplicationIcons.arrows.up,
  chevronDown: ApplicationIcons.chevron.down,
  chevronUp: ApplicationIcons.collapse.up,
  clearText: ApplicationIcons["clear-text"],
  close: ApplicationIcons.close,
  code: ApplicationIcons.code,
  confirm: ApplicationIcons.confirm,
  copy: ApplicationIcons.copy,
  error: ApplicationIcons.error,
  menu: ApplicationIcons.threeDots,
  next: ApplicationIcons.next,
  noSamples: ApplicationIcons.noSamples,
  play: ApplicationIcons.play,
  previous: ApplicationIcons.previous,
  toggleRight: ApplicationIcons["toggle-right"],
};

/**
 * The component-level context every inspect view renders under: icons and
 * component state backed by the store. The app and the test harness
 * (`src/test/testApp.tsx`) both render this, so tests see the same context.
 */
export const AppProviders: FC<{ children: ReactNode }> = ({ children }) => (
  <ComponentIconProvider icons={componentIcons}>
    <ComponentStateProvider hooks={inspectStateHooks}>
      {children}
    </ComponentStateProvider>
  </ComponentIconProvider>
);
