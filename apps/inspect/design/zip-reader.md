# ZIP reader resource bounds

Remote and in-memory archives share `openRemoteZipFile`'s ZIP/ZIP64 validation.
The directory controls entry sizes; local headers must agree, except for the
placeholders permitted with data descriptors. Every range must fit the archive
and every response must have the requested length.

The 2 GiB limit applies to each materialized entry or central directory, not the
total archive. Deflate and zstd count actual output and reject size mismatches
instead of allocating the declared output size up front.

## Zstd

`createZstdDecoder` is deliberately self-contained. Both the main thread and the
Blob worker use it; the worker embeds its compiled function via `toString()`.
Keep runtime dependencies inside the factory or pass them explicitly. Browser
tests exercise the generated worker, while corpus tests execute it in Node
worker threads.

The metadata scan runs before decoder allocation and enforces:

- A 32 MiB history window per frame, including single-segment frames.
- A 32 GiB estimate of window allocation and per-block history copying per entry.
- At most 1,000,000 frames and blocks combined per entry, including empty blocks
  and skippable frames. This bounds parser/decoder overhead when the history
  window and output are zero. Ordinary full-sized blocks need about 16,384 blocks
  for a 2 GiB entry, leaving substantial room for fragmented valid data.

Compressed bytes, expected output, or estimated work of at least 1 MiB select a
worker. Frame/block overhead contributes 1 KiB per operation to this dispatch
estimate; it is not an allocation allowance.

After validation, a second scan feeds each frame to a fresh streaming decoder.
fzstd recursively processes frame boundaries within a single push, so passing an
entire concatenated entry can overflow the call stack. Output is packed into
64 KiB pages as it arrives; empty blocks retain no output objects, and tiny blocks
cannot create an object list proportional to block count. A final contiguous
result still requires a second output-sized allocation.

These limits can reject previously readable zstd entries. The old window check
compared a signed bitwise magic value with an unsigned constant, so it was
ineffective for ordinary frames as well as bypassed for single-segment frames.
Large archives remain supported, but oversized windows and unusually fragmented
or expensive entries require recompression. There is no cross-entry memory budget.

## Large-log compatibility verification

On 2026-09-17, Chromium's real ZIP reader and workers were checked against Python's
independent zstandard and zipfile decoders. SHA-256 hashes of every 8 MiB of output
were compared, rather than checking output length alone. Files were served by a
local HTTP range server, exercising the remote reader and parallel fetches.

| Archive                         |                         Entries verified | Uncompressed bytes verified |
| ------------------------------- | ---------------------------------------: | --------------------------: |
| MirrorCode, original            |                                    All 6 |               1,154,538,915 |
| MirrorCode, chunked             |                                  All 616 |               1,017,280,605 |
| osworld-small                   |                                    All 6 |                  17,836,272 |
| Four SWE-bench deflate archives | Header and three largest entries in each |                 380,470,418 |

All bytes matched. The original MirrorCode sample alone expands to 1,154,525,388
bytes; it remains below the resource limits. This verifies ZIP transport and
decompression, not rendering the entire transcript in the viewer.
