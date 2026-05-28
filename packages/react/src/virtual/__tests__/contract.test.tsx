import { liveVirtualListAdapter } from "./adapters/live-virtual-list-adapter";
import { virtualListAdapter } from "./adapters/virtual-list-adapter";
import { createVirtualListTestSuite } from "./shared-suite";

createVirtualListTestSuite({
  adapter: liveVirtualListAdapter,
  skip: [
    "unified-bottom-threshold",
    "scroll-to-top-on-finish-opt-in",
    "scaled-mapping-extreme-scale",
    "per-sample-persistence-key",
  ],
});

createVirtualListTestSuite({
  adapter: virtualListAdapter,
  skip: [],
});
