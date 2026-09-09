import { useEffect, type RefObject } from "react";

import { useLatestRef } from "./useLatestRef";

type ListenerOptions = Pick<
  AddEventListenerOptions,
  "capture" | "passive" | "once"
>;

/**
 * Subscribes `listener` to a DOM event for the component's lifetime, with
 * automatic cleanup. The named replacement for the raw
 * `useEffect(addEventListener/removeEventListener)` pair.
 *
 * `listener` always sees the latest render's closure — it is not a
 * dependency, so passing an inline arrow never re-subscribes. Element
 * targets may be passed as a ref; a ref whose element mounts after the
 * subscribing component's own commit is not picked up until deps change.
 */
export function useEventListener<K extends keyof WindowEventMap>(
  target: Window | null | undefined,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: ListenerOptions
): void;
export function useEventListener<K extends keyof DocumentEventMap>(
  target: Document | null | undefined,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: ListenerOptions
): void;
export function useEventListener<K extends keyof HTMLElementEventMap>(
  target: RefObject<HTMLElement | null> | HTMLElement | null | undefined,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: ListenerOptions
): void;
export function useEventListener(
  target:
    | Window
    | Document
    | HTMLElement
    | RefObject<HTMLElement | null>
    | null
    | undefined,
  type: string,
  listener: (event: Event) => void,
  options?: ListenerOptions
): void {
  const listenerRef = useLatestRef(listener);
  const { capture, passive, once } = options ?? {};
  useEffect(() => {
    const element = target && "current" in target ? target.current : target;
    if (!element) return;
    const handler = (event: Event) => listenerRef.current(event);
    element.addEventListener(type, handler, { capture, passive, once });
    return () => element.removeEventListener(type, handler, { capture });
  }, [target, type, capture, passive, once, listenerRef]);
}
