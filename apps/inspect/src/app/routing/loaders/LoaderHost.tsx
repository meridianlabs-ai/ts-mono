import { FC, ReactNode } from "react";

import { DirectoryLoaderHost } from "./DirectoryLoaderHost";
import { SingleFileLoaderHost } from "./SingleFileLoaderHost";

/**
 * Loader host: picks the loader arm for the given mode and renders `children`
 * under it. Single-file mode runs the legacy URL-param bootstrap
 * (<SingleFileLoaderHost>); directory mode resolves the server log root and owns
 * replication (<DirectoryLoaderHost>).
 */
export const LoaderHost: FC<{
  isSingleFileMode: boolean;
  children: ReactNode;
}> = ({ isSingleFileMode, children }) => {
  const Host = isSingleFileMode ? SingleFileLoaderHost : DirectoryLoaderHost;
  return <Host>{children}</Host>;
};
