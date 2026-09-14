import { http, passthrough } from "msw";
import { ZstdCodec } from "zstd-codec";

import { server } from "./setup-msw";

// zstd-codec ships no type declarations; describe just the slice tests use.
interface ZstdSimple {
  compress(data: Uint8Array): Uint8Array;
}
interface ZstdModule {
  Simple: new () => ZstdSimple;
}

/**
 * Initialize a zstd compressor for building `.json.zst` test fixtures
 * (fzstd, used by production code, is decompress-only). Call from
 * `beforeAll`.
 */
export const setupZstdCompress = async (): Promise<
  (data: unknown) => Uint8Array
> => {
  // zstd-codec loads WASM via a data URL that MSW intercepts. Passthrough
  // prevents MSW from erroring on this unhandled request.
  server.use(http.get(/octet-stream;base64,/, () => passthrough()));

  const zstdCodec = ZstdCodec as {
    run(cb: (zstd: ZstdModule) => void): void;
  };

  return new Promise((resolve) => {
    zstdCodec.run((zstd) => {
      const simple = new zstd.Simple();
      resolve((data: unknown) =>
        simple.compress(new TextEncoder().encode(JSON.stringify(data)))
      );
    });
  });
};
