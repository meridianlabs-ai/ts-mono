/**
 * zstd-codec ships no type declarations. Declare the slice this repo uses so
 * callers get a real type instead of asserting one over the module's `any`.
 */
declare module "zstd-codec" {
  interface ZstdSimple {
    compress(data: Uint8Array): Uint8Array;
    decompress(data: Uint8Array): Uint8Array;
  }

  interface ZstdModule {
    Simple: new () => ZstdSimple;
  }

  export const ZstdCodec: {
    run(callback: (zstd: ZstdModule) => void): void;
  };
}
