import type { AsciinemaPlayerHandle } from "@tsmono/react/components";

// Players are re-seeked at most this often while the clock runs or a scrub
// drags; each seek redraws a whole terminal.
const kSeekIntervalMs = 70;
// Skip re-seeking a player that is already this close (seconds).
const kSeekTolerance = 0.05;
// Scrolling further than this many lines above the newest output pins the
// body where the user put it.
const kPinLines = 2;
// A scroll gesture (wheel, touch, scrollbar drag, and the momentum after
// them) lasts until scrolling has been quiet this long.
const kGestureIdleMs = 150;
const kGestureEvents = ["wheel", "touchmove", "pointerdown"] as const;

/** A session's player position (seconds into its recording) at the shared
 *  clock's current time; undefined for an unknown session. */
export type LocateSession = (key: string) => number | undefined;

interface Scroller {
  element: HTMLElement;
  pinned: boolean;
  detaching: boolean;
  /** The scrollTop we last set, so our own scrolls aren't read as the
   *  user's. */
  setTop: number;
  /** Ends the user's scroll gesture; set while one is in progress, when
   *  following waits so it doesn't fight the gesture. */
  gesture: number | undefined;
  dispose: () => void;
}

/**
 * Keeps the shared view's players at the master clock's time. The players
 * never play on their own: each is seeked (throttled) to its session's local
 * time. Each row body is a scroll container that follows the newest output
 * until the user scrolls up past a couple of lines, which pins it until they
 * return to the bottom.
 *
 * A player's screen is taller than its output (see screenRows), so the body's
 * clip element (`[data-terminal-clip]`) is cut just below the last non-empty
 * line: the scroll range ends at the output. The clip and the follow are
 * updated from a mutation observer on the player's lines, which runs after
 * the player redraws and before the browser paints, so new output and the
 * scroll position land in the same frame.
 */
export class PlayerSync {
  private readonly players = new Map<string, AsciinemaPlayerHandle>();
  private readonly scrollers = new Map<string, Scroller>();
  private readonly seekedTo = new Map<string, number>();
  private lastSync = 0;
  private trailing: number | undefined;
  private lineHeight: number;

  constructor(
    lineHeight: number,
    private readonly onLineHeight: (lineHeight: number) => void,
    private readonly onPinned: (key: string, pinned: boolean) => void
  ) {
    this.lineHeight = lineHeight;
  }

  /** Registers (or, with null, forgets) a session's player and seeks it. */
  setPlayer(
    key: string,
    player: AsciinemaPlayerHandle | null,
    locate: LocateSession
  ): void {
    this.seekedTo.delete(key);
    if (player) {
      this.players.set(key, player);
      this.sync(locate);
    } else {
      this.players.delete(key);
    }
  }

  /** Registers (or forgets) the scroll container holding a session's
   *  player. A ref callback that changes identity detaches and reattaches
   *  the same element within one commit, so detaching waits a microtask and
   *  a reattach keeps the scroller's state (e.g. pinned). */
  setScroller(key: string, element: HTMLElement | null): void {
    const previous = this.scrollers.get(key);
    if (!element) {
      if (!previous) return;
      previous.detaching = true;
      queueMicrotask(() => {
        if (this.scrollers.get(key) === previous && previous.detaching) {
          this.removeScroller(key, previous);
        }
      });
      return;
    }
    if (previous) {
      if (previous.element === element) {
        previous.detaching = false;
        return;
      }
      this.removeScroller(key, previous);
    }

    const onScroll = () => this.onUserScroll(key);
    const onGesture = () => this.extendGesture(key);
    const layout = () => this.layout(key);
    const resizes = new ResizeObserver(layout);
    const mutations = new MutationObserver(layout);
    element.addEventListener("scroll", onScroll, { passive: true });
    for (const type of kGestureEvents) {
      element.addEventListener(type, onGesture, { passive: true });
    }
    resizes.observe(element);
    mutations.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.scrollers.set(key, {
      element,
      pinned: false,
      detaching: false,
      setTop: element.scrollTop,
      gesture: undefined,
      dispose: () => {
        window.clearTimeout(this.scrollers.get(key)?.gesture);
        element.removeEventListener("scroll", onScroll);
        for (const type of kGestureEvents) {
          element.removeEventListener(type, onGesture);
        }
        resizes.disconnect();
        mutations.disconnect();
      },
    });
  }

  private removeScroller(key: string, scroller: Scroller): void {
    scroller.dispose();
    this.scrollers.delete(key);
    if (scroller.pinned) this.onPinned(key, false);
  }

  /** Unpins a session's body and returns it to the newest output. */
  jumpToLatest(key: string): void {
    const scroller = this.scrollers.get(key);
    if (!scroller) return;
    window.clearTimeout(scroller.gesture);
    scroller.gesture = undefined;
    this.setPinned(key, scroller, false);
    this.follow(key);
  }

  /** Seeks every player to the clock, at most once per seek interval, with a
   *  trailing seek so the last position of a drag always lands. */
  request(locate: LocateSession): void {
    window.clearTimeout(this.trailing);
    const wait = kSeekIntervalMs - (performance.now() - this.lastSync);
    if (wait <= 0) {
      this.sync(locate);
    } else {
      this.trailing = window.setTimeout(() => this.sync(locate), wait);
    }
  }

  dispose(): void {
    window.clearTimeout(this.trailing);
    for (const scroller of this.scrollers.values()) scroller.dispose();
    this.scrollers.clear();
  }

  private sync(locate: LocateSession): void {
    this.lastSync = performance.now();
    for (const [key, player] of this.players) {
      const local = locate(key);
      if (local === undefined) continue;
      const previous = this.seekedTo.get(key);
      if (previous !== undefined && Math.abs(previous - local) < kSeekTolerance)
        continue;
      this.seekedTo.set(key, local);
      player.seek(local).catch(() => undefined);
    }
  }

  // Clips the body to its output and, unless pinned, scrolls to the bottom.
  private layout(key: string): void {
    const scroller = this.scrollers.get(key);
    if (!scroller) return;
    this.clip(scroller.element);
    this.follow(key);
  }

  private follow(key: string): void {
    const scroller = this.scrollers.get(key);
    if (!scroller || scroller.pinned || scroller.gesture !== undefined) return;
    const { element } = scroller;
    element.scrollTop = element.scrollHeight - element.clientHeight;
    scroller.setTop = element.scrollTop;
  }

  private onUserScroll(key: string): void {
    const scroller = this.scrollers.get(key);
    if (!scroller) return;
    const { element } = scroller;
    const top = element.scrollTop;
    if (Math.abs(top - scroller.setTop) < 1) return;
    if (scroller.gesture !== undefined) this.extendGesture(key);
    const below = element.scrollHeight - element.clientHeight - top;
    this.setPinned(key, scroller, below > kPinLines * this.lineHeight);
  }

  // Starts or extends the user's scroll gesture; when it ends, a body left
  // near the bottom follows again.
  private extendGesture(key: string): void {
    const scroller = this.scrollers.get(key);
    if (!scroller) return;
    window.clearTimeout(scroller.gesture);
    scroller.gesture = window.setTimeout(() => {
      scroller.gesture = undefined;
      this.layout(key);
    }, kGestureIdleMs);
  }

  private setPinned(key: string, scroller: Scroller, pinned: boolean): void {
    if (scroller.pinned === pinned) return;
    scroller.pinned = pinned;
    this.onPinned(key, pinned);
  }

  // Sets the clip's height to end just below the last non-empty line; also
  // picks up the line height the player's width-fit produced.
  private clip(element: HTMLElement): void {
    const clip = element.querySelector<HTMLElement>("[data-terminal-clip]");
    const lines = element.querySelectorAll(".ap-line");
    const first = lines[0];
    if (!clip || !first) return;
    // Measured from the lines themselves: the terminal's border sits above
    // the first line, and a line's own box can be shorter than its pitch.
    const firstTop = first.getBoundingClientRect().top;
    const lastLine = lines[lines.length - 1];
    if (lastLine && lines.length > 1) {
      const pitch =
        (lastLine.getBoundingClientRect().top - firstTop) / (lines.length - 1);
      if (pitch > 0 && Math.abs(pitch - this.lineHeight) > 0.25) {
        this.lineHeight = pitch;
        this.onLineHeight(pitch);
      }
    }
    let last = lines.length - 1;
    while (last > 0 && !lines[last]?.textContent.trim()) last--;
    const top = firstTop - clip.getBoundingClientRect().top;
    clip.style.height = `${Math.ceil(top + (last + 1) * this.lineHeight)}px`;
  }
}
