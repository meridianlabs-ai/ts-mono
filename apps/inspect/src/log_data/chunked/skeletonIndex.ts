/**
 * Query layer over a sample skeleton: span-by-begin-ordinal, ancestor
 * stacks, and filter visibility — all answered from span extents and
 * counters with zero event reads (sticky headers and depth seeding for the
 * decode walk).
 */
import { at } from "./format";
import type { SampleSkeleton, SkeletonSpan } from "./types";

export class SkeletonIndex {
  readonly spans: SkeletonSpan[];
  readonly childrenOf: number[][];
  readonly roots: number[];
  private byBegin = new Map<number, number>();

  constructor(readonly skeleton: SampleSkeleton) {
    this.spans = skeleton.spans;
    this.childrenOf = this.spans.map(() => []);
    this.roots = [];
    this.spans.forEach((span, i) => {
      this.byBegin.set(span.begin, i);
      if (span.parent === undefined) {
        this.roots.push(i);
      } else {
        at(this.childrenOf, span.parent).push(i);
      }
    });
  }

  /** Span whose begin event sits at `ordinal` (undefined: dissolved span). */
  spanAtBegin(ordinal: number): number | undefined {
    return this.byBegin.get(ordinal);
  }

  /**
   * Structural ancestor stack (outermost first) containing `ordinal` —
   * answered entirely from extents; the span_begin events need never be
   * fetched. Interleaved-span extent overlap: first containing child wins
   * (tolerated per spec; correctness comes from span_id on fetched events).
   */
  spanStackAt(ordinal: number): number[] {
    const stack: number[] = [];
    let candidates = this.roots;
    for (;;) {
      const hit = candidates.find((i) => {
        const [lo, hi] = at(this.spans, i).extent;
        return lo <= ordinal && ordinal <= hi;
      });
      if (hit === undefined) {
        return stack;
      }
      stack.push(hit);
      candidates = at(this.childrenOf, hit);
    }
  }

  depthAt(ordinal: number): number {
    return this.spanStackAt(ordinal).length;
  }

  /** Does an expanded span have anything to show under the current filter? */
  hasVisibleContents(
    spanIdx: number,
    visibleTypes: (type: string) => boolean
  ): boolean {
    const span = at(this.spans, spanIdx);
    if (span.models > 0 && visibleTypes("model")) {
      return true;
    }
    if (
      Object.entries(span.children).some(
        ([type, count]) => count > 0 && visibleTypes(type)
      )
    ) {
      return true;
    }
    return at(this.childrenOf, spanIdx).length > 0;
  }
}
