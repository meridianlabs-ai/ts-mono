/**
 * Delays the execution of code for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a throttled version of a function that only invokes the original function
 * at most once per every `wait` milliseconds. The throttled function will run as much
 * as it can, without ever going more than once per `wait` duration.
 */
export function throttle<A extends unknown[], R>(
  func: (...args: A) => R,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): (...args: A) => R {
  let args: A | null;
  let result: R;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let previous = 0;

  const later = (): void => {
    previous = options.leading === false ? 0 : Date.now();
    timeout = null;
    // `throttled` records args before it ever arms this timer, and the leading
    // edge clears the timer before nulling them — so null here means there is
    // no pending call to make, not a call to make with no arguments.
    if (args !== null) {
      result = func(...args);
    }
    // TODO: eslint thinks that the conditional is unnecessary, but it seems that
    // the call to func could have a side effect of mutating timeout if it makes
    // a call to throttled below

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!timeout) {
      args = null;
    }
  };

  const throttled = (...callArgs: A): R => {
    const now = Date.now();
    if (!previous && options.leading === false) {
      previous = now;
    }
    const remaining = wait - (now - previous);

    args = callArgs;

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func(...args);
      if (!timeout) {
        args = null;
      }
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }

    return result;
  };

  return throttled;
}

/**
 * Creates a debounced version of a function that delays invoking the function
 * until after `wait` milliseconds have passed since the last time it was invoked.
 */

export function debounce<A extends unknown[], R>(
  func: (...args: A) => R,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): (...args: A) => R {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let args: A;
  let result: R;
  let lastCallTime: number | null = null;

  const later = (): void => {
    const last = Date.now() - (lastCallTime || 0);

    if (last < wait && last >= 0) {
      timeout = setTimeout(later, wait - last);
    } else {
      timeout = null;
      if (!options.leading) {
        result = func(...args);
        // TODO: eslint thinks that the conditional is unnecessary, but it seems
        // that the call to func could have a side effect of mutating timeout if
        // it makes a call to debounced below

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (!timeout) {
          args = null!;
        }
      }
    }
  };

  const debounced = (...callArgs: A): R => {
    args = callArgs;
    lastCallTime = Date.now();

    const callNow = options.leading && !timeout;

    if (!timeout) {
      timeout = setTimeout(later, wait);
    }

    if (callNow) {
      result = func(...args);

      args = null!;
    }

    return result;
  };

  return debounced;
}
