declare module "asciinema-player" {
  interface AsciinemaPlayerOptions {
    cols?: number;
    rows?: number;
    autoPlay?: boolean;
    preload?: boolean;
    loop?: boolean | number;
    startAt?: number | string;
    speed?: number;
    idleTimeLimit?: number;
    theme?: string;
    poster?: string;
    fit?: string | false;
    controls?: boolean | "auto";
    pauseOnMarkers?: boolean;
    markers?: Array<[number, string]>;
    terminalFontSize?: string;
    terminalFontFamily?: string;
    terminalLineHeight?: number;
    logger?: unknown;
  }

  interface AsciinemaPlayer {
    el: HTMLElement;
    dispose: () => void;
    getCurrentTime: () => Promise<number>;
    getDuration: () => Promise<number>;
    play: () => Promise<void>;
    pause: () => Promise<void>;
    seek: (pos: number | string) => Promise<void>;
    addEventListener: (
      name: string,
      callback: (...args: unknown[]) => void
    ) => void;
  }

  export function create(
    src: string | { url: string | string[]; parser?: string },
    elem: HTMLElement,
    opts?: AsciinemaPlayerOptions
  ): AsciinemaPlayer;
}
