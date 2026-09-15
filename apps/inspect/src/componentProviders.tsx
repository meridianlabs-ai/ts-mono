import type { FC, ReactNode } from "react";

import {
  DisplayModeContext,
  type DisplayMode,
} from "@tsmono/inspect-components";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
  ExtendedFindProvider,
  FindTargetProvider,
  type ComponentIcons,
  type ComponentNavigation,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";

import { ApplicationIcons } from "./app/appearance/icons";
import { inspectStateHooks } from "./state/componentStateAdapter";

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

export const InspectStateAndIconProvider: FC<{ children: ReactNode }> = ({
  children,
}) => (
  <ComponentIconProvider icons={componentIcons}>
    <ComponentStateProvider hooks={inspectStateHooks}>
      {children}
    </ComponentStateProvider>
  </ComponentIconProvider>
);

export interface InspectComponentProviderProps {
  children: ReactNode;
  displayMode?: DisplayMode;
  navigate: ComponentNavigation["navigate"];
}

export const InspectComponentProvider: FC<InspectComponentProviderProps> = ({
  children,
  displayMode = "rendered",
  navigate,
}) => (
  <ExtendedFindProvider>
    <FindTargetProvider>
      <InspectStateAndIconProvider>
        <ComponentNavigationProvider navigation={{ navigate }}>
          <DisplayModeContext.Provider value={{ displayMode }}>
            {children}
          </DisplayModeContext.Provider>
        </ComponentNavigationProvider>
      </InspectStateAndIconProvider>
    </FindTargetProvider>
  </ExtendedFindProvider>
);
