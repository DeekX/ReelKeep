# Performance budget

Target: smooth with **10,000 items**. Measured with `scripts/benchmark.mjs`
(headless Chrome, real app, seeded 10k mixed-type library):

| Metric | Budget | Measured (2026-11-24, Windows, Node 22, headless Chrome) |
| --- | --- | --- |
| Boot to first cards | ≤ 6000 ms | **598 ms** |
| Search to filtered render | ≤ 400 ms | **90 ms** (104 hits) |

Run it yourself:

```sh
node scripts/benchmark.mjs          # BENCH_N / BENCH_BOOT_MS / BENCH_SEARCH_MS override
```

CI runs the benchmark on ubuntu-latest (Node 22) as a budget gate.

## How the scale is achieved

- **Indexed search**: precomputed lowercase haystack per item (`js/library.mjs`
  `indexItem`/`rebuildIndex`); filtering is substring checks over the index.
- **Offscreen culling**: `content-visibility: auto` + `contain-intrinsic-size`
  on cards — the browser skips layout/paint for offscreen cards (native
  windowing, no virtual-scroll rewrite; unsupported browsers render normally).
- **Chunked DOM**: 60 cards per page with "Load more", so first paint never
  builds 10k nodes.
- **Lazy, off-thread-decoded covers**: `loading="lazy" decoding="async"`.
- **Targeted saves**: debounced whole-library writes (300 ms) flushed on tab
  hide; metadata patches re-render once, not per keystroke.
