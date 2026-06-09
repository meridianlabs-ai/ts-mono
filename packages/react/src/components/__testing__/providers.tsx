import { ComponentIconProvider } from "../ComponentIconContext";
import { testIcons } from "./icons";

export const IconsWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <ComponentIconProvider icons={testIcons}>{children}</ComponentIconProvider>
);
