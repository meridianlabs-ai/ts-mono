import { CSSProperties, FC, lazy, Suspense } from "react";

interface AsciinemaPlayerProps {
  id?: string;
  inputUrl: string;
  outputUrl: string;
  timingUrl: string;
  rows?: number;
  cols?: number;
  fit?: string;
  style?: CSSProperties;
  speed?: number;
  autoPlay?: boolean;
  loop?: boolean;
  theme?: string;
  idleTimeLimit?: number;
  className?: string;
}

const LazyAsciinemaPlayer = lazy(() => import("./AsciinemaPlayerImpl"));

export const AsciinemaPlayer: FC<AsciinemaPlayerProps> = (props) => (
  <Suspense fallback={null}>
    <LazyAsciinemaPlayer {...props} />
  </Suspense>
);
