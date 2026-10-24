import { create, DataSource } from "asciinema-player";

import "asciinema-player/dist/bundle/asciinema-player.css";

import { CSSProperties, FC, useEffect, useRef } from "react";

interface AsciinemaPlayerBaseProps {
  id?: string;
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

// A session recorded as a `script -m advanced` input/output/timing triple.
interface AsciinemaTimingProps extends AsciinemaPlayerBaseProps {
  input: string;
  output: string;
  timing: string;
  cast?: never;
}

// A session recorded as a single asciicast v2 document.
interface AsciinemaCastProps extends AsciinemaPlayerBaseProps {
  cast: string;
  input?: never;
  output?: never;
  timing?: never;
}

type AsciinemaPlayerProps = AsciinemaTimingProps | AsciinemaCastProps;

const AsciinemaPlayerImpl: FC<AsciinemaPlayerProps> = ({
  id,
  rows,
  cols,
  input,
  output,
  timing,
  cast,
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

    // In-memory Responses, not Blob URLs the player would fetch: the
    // viewer's CSP allows no blob: connections. Fresh per load, since a
    // Response body reads once.
    const source: DataSource =
      cast !== undefined
        ? {
            data: () => new Response(cast),
            parser: "asciicast",
          }
        : {
            data: () => [
              new Response(timing),
              new Response(output),
              new Response(input),
            ],
            parser: "typescript",
          };

    const player = create(source, playerContainerRef.current, {
      rows,
      cols,
      autoPlay,
      loop,
      theme,
      speed,
      idleTimeLimit,
      fit,
    });

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    player.play();

    return () => {
      player.dispose();
    };
  }, [
    timing,
    output,
    input,
    cast,
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
