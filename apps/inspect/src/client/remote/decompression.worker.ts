import { Decompress } from "fzstd";

import { inflateBounded } from "./inflate";
import { createZstdDecoder } from "./zstd-decoder";

const zstd = createZstdDecoder(Decompress);

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (typeof message !== "object" || message === null) return;
  if ("type" in message && message.type === "init") {
    self.postMessage({ type: "init_complete", success: true });
    return;
  }
  if (
    !("type" in message) ||
    message.type !== "decompress" ||
    !("requestId" in message) ||
    typeof message.requestId !== "number"
  ) {
    return;
  }
  const { requestId } = message;
  try {
    if (
      !("data" in message) ||
      !(message.data instanceof Uint8Array) ||
      !("expectedSize" in message) ||
      typeof message.expectedSize !== "number" ||
      !("method" in message) ||
      (message.method !== "zstd" && message.method !== "deflate")
    ) {
      throw new Error("Malformed decompression request");
    }
    const result =
      message.method === "deflate"
        ? inflateBounded(message.data, message.expectedSize)
        : zstd.decompress(message.data, message.expectedSize);
    self.postMessage(
      { requestId, success: true, data: result },
      { transfer: [result.buffer] }
    );
  } catch (err) {
    self.postMessage({
      requestId,
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});
