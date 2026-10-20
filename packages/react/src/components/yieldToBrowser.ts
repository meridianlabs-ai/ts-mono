/**
 * Resolves in a new task, letting the browser handle input and paint first.
 * A message-channel task, unlike a nested setTimeout(0), isn't clamped to 4ms.
 */
export const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
