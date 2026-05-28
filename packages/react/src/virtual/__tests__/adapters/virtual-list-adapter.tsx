import { render } from "@testing-library/react";
import { act, createRef } from "react";

import type { VirtualListHandle } from "../../types";
import { VirtualList } from "../../VirtualList";
import type { HarnessAdapter, HarnessHandle } from "../shared-suite";

export const virtualListAdapter: HarnessAdapter<unknown> = {
  name: "VirtualList",
  render(opts) {
    const handle = createRef<VirtualListHandle>();

    const { unmount, container } = render(
      <div ref={opts.scrollRef} style={{ height: 400, overflow: "auto" }}>
        <VirtualList
          ref={handle}
          persistenceKey={opts.persistenceKey}
          scrollRef={opts.scrollRef}
          data={opts.data}
          renderRow={opts.renderRow as never}
          live={opts.live}
          initialIndex={opts.initialIndex}
          scrollToTopOnFinish={opts.scrollToTopOnFinish}
        />
      </div>
    );

    act(() => {
      (opts.handleRef as { current: HarnessHandle | null }).current = {
        scrollToIndex: (o) => handle.current?.scrollToIndex(o),
        scrollTo: (o) => handle.current?.scrollTo(o),
      };
    });

    return { unmount, container };
  },
};
