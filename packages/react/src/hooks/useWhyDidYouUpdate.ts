import { useEffect, useRef } from "react";

/**
 * Stable empty object reference to avoid unnecessary re-renders.
 * Use as a default value when a nullable object prop needs a fallback.
 */
export const STABLE_EMPTY_OBJECT: Record<string, never> = {};

/**
 * Debugging aid: logs which props changed between renders. It has no callers
 * on purpose; drop it into a component while chasing re-renders.
 */
export const useWhyDidYouUpdate = (
  componentName: string,
  props: object
): void => {
  const previousProps = useRef(props);

  useEffect(() => {
    if (previousProps.current !== props) {
      const before = new Map<string, unknown>(
        Object.entries(previousProps.current)
      );
      const changedProps: Record<string, { before: unknown; after: unknown }> =
        {};
      for (const [key, after] of Object.entries(props)) {
        if (before.get(key) !== after) {
          changedProps[key] = { before: before.get(key), after };
        }
      }

      if (Object.keys(changedProps).length > 0) {
        console.log(`[${componentName}] props changed:`, changedProps);
      } else {
        console.log(`[${componentName}] no props changed`);
      }
    }

    previousProps.current = props;
  }, [props, componentName]);
};
