import { render } from "@testing-library/react";
import { act, createRef } from "react";
import type { VirtuosoHandle } from "react-virtuoso";

import { LiveVirtualList } from "../../../components/LiveVirtualList";
import type { HarnessAdapter, HarnessHandle } from "../shared-suite";

export const liveVirtualListAdapter: HarnessAdapter<unknown> = {
  name: "LiveVirtualList",
  render(opts) {
    const virtuosoHandle = createRef<VirtuosoHandle>();

    const { unmount, container } = render(
      <div ref={opts.scrollRef} style={{ height: 400, overflow: "auto" }}>
        <LiveVirtualList
          id={opts.persistenceKey}
          listHandle={virtuosoHandle}
          scrollRef={opts.scrollRef}
          data={opts.data}
          renderRow={opts.renderRow as never}
          live={opts.live}
          initialTopMostItemIndex={opts.initialIndex}
        />
      </div>
    );

    act(() => {
      (opts.handleRef as { current: HarnessHandle | null }).current = {
        scrollToIndex: (o) => virtuosoHandle.current?.scrollToIndex(o),
        scrollTo: (o) => virtuosoHandle.current?.scrollTo(o),
      };
    });

    return { unmount, container };
  },
};
