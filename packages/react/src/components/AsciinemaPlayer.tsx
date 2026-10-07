import { FC } from "react";

import { onDemandModule, useOnDemandModule } from "../hooks/onDemandModule";

import type { AsciinemaPlayerProps } from "./AsciinemaPlayerImpl";
import { UntrustedContentPlaceholder } from "./ContentTrust";
import { useContentPolicy } from "./ContentTrustContext";

// Loaded on first trusted use, so the player never loads for untrusted content.
const player = onDemandModule(() => import("./AsciinemaPlayerImpl"));

export const AsciinemaPlayer: FC<AsciinemaPlayerProps> = (props) => {
  const policy = useContentPolicy();
  return policy.media && policy.ansi ? (
    <TrustedAsciinemaPlayer {...props} />
  ) : (
    <UntrustedContentPlaceholder kind="terminal session" />
  );
};

const TrustedAsciinemaPlayer: FC<AsciinemaPlayerProps> = (props) => {
  const loaded = useOnDemandModule(player);
  return loaded ? <loaded.default {...props} /> : null;
};
