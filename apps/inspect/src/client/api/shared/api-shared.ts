/**
 * Downloads the provided content as a file using the browser's DOM API
 */
export function download_file(
  filename: string,
  filecontents: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>
): Promise<void> {
  // An executor so a malformed data URL rejects rather than throws.
  return new Promise((resolve) => {
    const blob =
      typeof filecontents === "string" && filecontents.startsWith("data:")
        ? dataUrlBlob(filecontents)
        : new Blob([filecontents], { type: "text/plain" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    resolve();
  });
}

// Decoded here rather than with fetch(): the viewer's CSP limits connect-src
// to 'self', which does not cover data: URLs.
const dataUrlBlob = (url: string): Blob => {
  const comma = url.indexOf(",");
  if (comma < 0) throw new TypeError("Malformed data URL: no comma");
  const [mimeType = "", ...parameters] = url
    .slice("data:".length, comma)
    .split(";");
  const payload = url.slice(comma + 1);
  const bytes = parameters.some(
    (parameter) => parameter.trim().toLowerCase() === "base64"
  )
    ? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(payload));
  return new Blob([bytes], { type: mimeType.trim() || "text/plain" });
};
