/**
 * Fetches a range of bytes from a remote resource and returns it as a `Uint8Array`.
 */
export const fetchRange = async (
  url: string,
  start: number,
  end: number,
  init: RequestInit = {}
): Promise<Uint8Array> => {
  const headers = new Headers(init.headers);
  headers.set("Range", `bytes=${start}-${end}`);
  const response = await fetch(url, {
    ...init,
    method: "GET",
    headers,
  });
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};
