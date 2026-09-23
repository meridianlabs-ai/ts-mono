# ZIP decoder performance comparison

Measured on 2026-09-18: pre-PR `3501fbb8` versus `f633fa5a`.

## Method

- Chromium 153 through Playwright on an Apple M5 Pro with 64 GiB RAM.
- Both implementations ran in the same browser build with the same dependency versions and Vite transformations.
- Each case used a fresh page. One first-call run per implementation was recorded separately, followed by five measured runs per implementation, alternating order each round.
- Compressed inputs were loaded before measurement and copied before each call so both implementations received a fresh transferable buffer.
- Timings cover `decompressData`, including worker initialization when needed, worker messaging, decoding, output checks and output assembly. HTTP fetch, ZIP parsing, input preparation, SHA-256 verification, JSON parsing and transcript rendering are excluded.
- Every output in every run was checked against independently generated Python zstandard/zipfile SHA-256 hashes, in 8 MiB pieces. All matched.
- The 616-entry case reads entries sequentially; its time is the sum of decoder calls. Concurrent loading and peak memory were not measured.

## Results

All times are milliseconds. Warm values are medians of five runs.

| Case                                 | Expanded bytes |  Before |   After |    Change |    Before range |     After range |
| ------------------------------------ | -------------: | ------: | ------: | --------: | --------------: | --------------: |
| MirrorCode original sample           |  1,154,525,388 | 2,050.6 | 2,155.8 |     +5.1% | 2,024.4–2,087.8 | 2,123.9–2,202.2 |
| MirrorCode largest event chunk       |     12,122,054 |    24.0 |    25.1 |     +4.6% |       23.0–30.4 |       24.8–28.4 |
| MirrorCode large attachment          |     10,912,021 |    26.9 |    28.2 |     +4.8% |       26.8–30.3 |       27.5–31.5 |
| OSWorld sample                       |     17,821,189 |    81.7 |    83.8 |     +2.6% |       79.8–83.0 |       82.2–88.8 |
| SWE-bench largest sample             |     38,606,523 |   104.1 |   134.5 |    +29.2% |     103.3–109.0 |     131.4–140.9 |
| SWE-bench reductions                 |     65,673,895 |   221.3 |   314.7 |    +42.2% |     217.1–225.2 |     310.9–340.7 |
| MirrorCode all 616 chunked entries   |  1,017,280,605 | 1,935.1 | 2,017.9 |     +4.3% | 1,915.6–1,989.5 | 2,003.4–2,065.4 |
| Synthetic 32 MiB single-segment zstd |     33,554,432 |     1.8 |   190.2 | +10466.7% |         1.7–1.9 |     188.7–193.6 |

| Case                                 | Before first call | After first call |
| ------------------------------------ | ----------------: | ---------------: |
| MirrorCode original sample           |           2,169.7 |          2,264.2 |
| MirrorCode largest event chunk       |              30.3 |             36.0 |
| MirrorCode large attachment          |              38.3 |             38.9 |
| OSWorld sample                       |              89.9 |             95.8 |
| SWE-bench largest sample             |             115.4 |            135.1 |
| SWE-bench reductions                 |             222.0 |            320.1 |
| MirrorCode all 616 chunked entries   |           1,978.3 |          2,071.4 |
| Synthetic 32 MiB single-segment zstd |               2.2 |            198.5 |

## Interpretation

The real zstd cases were approximately 3–5% slower. The original 1.15 GB MirrorCode sample increased by 105 ms; all 616 chunked entries increased by 83 ms. These measurements do not show a large regression on the sampled real zstd logs.

The deflate cost is more noticeable: 30 ms extra for the 38.6 MB sample and 93 ms extra for the 65.7 MB reductions entry. The old one-shot operation used two outgoing worker messages including initialization. The new 8 KiB stream used 567 and 1,660 outgoing messages respectively. Backpressure bounds output expansion between checks but adds round trips. Both versions create a new fflate worker per entry.

The synthetic case is a valid 32 MiB single-segment frame with 256 RLE blocks, only 1,033 bytes compressed. The old decoder could fill its final buffer directly. The streaming decoder shifts its 32 MiB history after each block, about 8 GiB of copying, which dominates the new 190 ms result. This is a real edge-case slowdown, even though the absolute time is below a quarter second on this machine. This frame shape should be included in future decoder optimization or replacement work.

## Worker behavior and responsiveness

The zstd worker is cached and reused in both implementations. Each worker-routed entry transfers its compressed ArrayBuffer once, then transfers the decoded ArrayBuffer back once. The current decoder streams internally in the worker; individual zstd blocks do not cross the bridge.

Previously zstd chose the worker only at 1 MiB compressed. It now also considers expected output and estimated history/frame/block work. For the chunked MirrorCode archive, worker-routed entries increased from 8 to all 616. The sum of synchronous time inside decoder calls dropped from 1,700 ms to 1.3 ms; the largest old synchronous call was about 24 ms, versus about 0.1 ms now. The 1,700 ms was spread across entries, not a single continuous freeze. These numbers exclude message-handler and hash-verification work and are not a complete frame-rate measurement.

Worker messages use structured cloning for their small envelopes, with explicit transfer lists for large byte buffers. Transferring an ArrayBuffer moves ownership and detaches it in the sender; it avoids cloning the payload bytes. Zstd already used these transfers before the PR. The old fflate one-shot input used cloning, while its result was transferred. The new deflate path copies each input slice locally, transfers it, and receives transferred output chunks, which the main thread concatenates.

The result supports a modest zstd throughput tradeoff for better main-thread responsiveness on these logs. Deflate throughput and known-size single-segment zstd remain the performance areas to watch. The safety limits should not be relaxed solely to regain speed.
