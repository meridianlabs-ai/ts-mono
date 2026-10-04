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
Large archives remain supported, but these are resource-policy limits, not a
guarantee that every valid entry below 2 GiB is readable. There is no cross-entry
memory budget.

## Compatibility of the work budget

The fixed work budget intentionally favors bounded decoder cost over accepting
every valid compression configuration. It is not restricted to malformed or
pathological inputs: ordinary large samples can exceed it. The estimate sums
`windowSize × (1 + blockCount)` over frames, including one window allocation per
frame. With full 128 KiB blocks, the approximate output ceilings are:

| History window | Approximate output ceiling from the 32 GiB work budget |
| -------------- | -----------------------------------------------------: |
| 2 MiB          |                                                  2 GiB |
| 4 MiB          |                                                  1 GiB |
| 8 MiB          |                                                512 MiB |
| 32 MiB         |                                                128 MiB |

Frame allocation overhead makes the exact ceilings slightly lower. Blocks can
also be smaller than 128 KiB, so even the 2 MiB window used by the current Inspect
default writer can exhaust the work budget well before the 2 GiB entry limit.
Higher compression settings can select larger windows; compression level alone
is not a portable mapping to window size.

In the local corpus, all 628 zstd entries passed the metadata limits and used
windows no larger than 2 MiB. The original MirrorCode sample has 6 frames and
13,142 blocks, charging **25.68 GiB (80%)** of the work allowance for its 1.15 GB
output. A larger sample with similar block density could exceed the budget;
default compression does not guarantee acceptance. The largest charge for one
entry in the chunked MirrorCode archive is **0.64 GiB (2%)**.

The budget resets for each ZIP entry, not each zstd frame. Splitting a sample into
separate chunk entries therefore provides substantially more headroom; merely
concatenating smaller frames in the same entry does not. Existing unchunked logs
can still require conversion to chunked entries or recompression with smaller
windows or ZIP deflate. The error reports the budget rather than treating these
files as corrupt.

Keep the ceiling independent of compressed input size: padding or skippable
frames could otherwise increase the allowed decoder work without contributing
useful output. Any future increase should be an explicit change to the supported
resource policy, backed by measurements of the affected files.

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
