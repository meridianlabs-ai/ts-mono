declare module "asciinema-player" {
  export interface AsciinemaPlayer {
    play(): Promise<void>;
    pause(): void;
    getCurrentTime(): number;
    getDuration(): number | null;
    seek(location: number | string): Promise<void>;
    dispose(): void;
  }
  export const create: (
    src: string | object,
    el: HTMLElement,
    opts: {
      cols?: number;
      rows?: number;
      autoPlay?: boolean;
      preload?: boolean;
      loop?: boolean;
      theme?: string;
      startAt?: number | string;
      speed?: number;
      idleTimeLimit?: number;
      poster?: string;
      fit?: string;
      controls?: boolean;
      markers?: Array<number> | Array<[number, string]>;
      pauseOnMarkers?: boolean;
      terminalFontSize?: string;
      terminalFontFamily?: string;
      terminalLineHeight?: string;
      logger?: object;
    }
  ) => AsciinemaPlayer;
}
