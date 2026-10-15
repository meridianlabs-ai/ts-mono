import { create } from "asciinema-player";

import "asciinema-player/dist/bundle/asciinema-player.css";

import { CSSProperties, FC, useEffect, useRef } from "react";

interface AsciinemaPlayerProps {
  id?: string;
  input: string;
  output: string;
  timing: string;
  rows?: number;
  cols?: number;
  fit?: "width" | "height" | "both" | "none" | false;
  style?: CSSProperties;
  speed?: number;
  autoPlay?: boolean;
  loop?: boolean;
  theme?: string;
  idleTimeLimit?: number;
  className?: string;
}

const AsciinemaPlayerImpl: FC<AsciinemaPlayerProps> = ({
  id,
  rows,
  cols,
  input,
  output,
  timing,
  fit,
  speed,
  autoPlay,
  loop,
  theme,
  idleTimeLimit = 2,
  style,
}) => {
  const playerContainerRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (!playerContainerRef.current) return;

    const player = create(
      {
        // In-memory Responses, not Blob URLs the player would fetch: the
        // viewer's CSP allows no blob: connections. Fresh per load, since a
        // Response body reads once.
        data: () => [
          new Response(timing),
          new Response(output),
          new Response(input),
        ],
        parser: "typescript",
      },
      playerContainerRef.current,
      {
        rows,
        cols,
        autoPlay,
        loop,
        theme,
        speed,
        idleTimeLimit,
        fit,
      }
    );

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    player.play();

    return () => {
      player.dispose();
    };
  }, [
    timing,
    output,
    input,
    rows,
    cols,
    autoPlay,
    loop,
    theme,
    speed,
    idleTimeLimit,
    fit,
  ]);

  return (
    <div
      id={`asciinema-player-${id || "default"}`}
      ref={playerContainerRef}
      style={{ ...style }}
    />
  );
};

export default AsciinemaPlayerImpl;
export type { AsciinemaPlayerProps };
