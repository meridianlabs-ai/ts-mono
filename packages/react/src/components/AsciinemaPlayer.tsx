import { FC } from "react";

import { onDemandModule, useOnDemandModule } from "../hooks/onDemandModule";

import type { AsciinemaPlayerProps } from "./AsciinemaPlayerImpl";
import {
  UntrustedContentPlaceholder,
  useIsContentTrusted,
} from "./ContentTrust";

// Loaded on first trusted use, so the player never loads for untrusted content.
const player = onDemandModule(() => import("./AsciinemaPlayerImpl"));

export const AsciinemaPlayer: FC<AsciinemaPlayerProps> = (props) =>
  useIsContentTrusted() ? (
    <TrustedAsciinemaPlayer {...props} />
  ) : (
    <UntrustedContentPlaceholder kind="terminal session" />
  );

const TrustedAsciinemaPlayer: FC<AsciinemaPlayerProps> = (props) => {
  const loaded = useOnDemandModule(player);
  return loaded ? <loaded.default {...props} /> : null;
};
