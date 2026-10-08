export interface BombadilOptions {
  origin: string;
  specification: string;
  fixture?: string;
  output: string;
  debuggerPort: number;
}

export function runBombadil(options: BombadilOptions): Promise<{
  code: number | null;
  log: string;
}>;
