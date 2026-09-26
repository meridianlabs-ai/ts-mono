import { FC, lazy, Suspense } from "react";

import type { AsciinemaPlayerProps } from "./AsciinemaPlayerImpl";
import {
  UntrustedContentPlaceholder,
  useIsContentTrusted,
} from "./ContentTrust";

const LazyAsciinemaPlayer = lazy(() => import("./AsciinemaPlayerImpl"));

export const AsciinemaPlayer: FC<AsciinemaPlayerProps> = (props) =>
  useIsContentTrusted() ? (
    <Suspense fallback={null}>
      <LazyAsciinemaPlayer {...props} />
    </Suspense>
  ) : (
    <UntrustedContentPlaceholder kind="terminal session" />
  );
