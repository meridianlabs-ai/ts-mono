import type { ContentAudio, ContentVideo } from "@tsmono/inspect-common/types";
import {
  base64DataUriMimeType,
  isRenderableImageSource,
  normalizedImageMimeType,
  rasterImageMimeTypes,
} from "@tsmono/util";

export { isRenderableImageSource };

const primaryAudioMimeTypes: Record<ContentAudio["format"], string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

const audioMimeTypes: Record<ContentAudio["format"], Set<string>> = {
  mp3: new Set(["audio/mp3", "audio/mpeg"]),
  wav: new Set(["audio/vnd.wave", "audio/wav", "audio/wave", "audio/x-wav"]),
};

const primaryVideoMimeTypes: Record<ContentVideo["format"], string> = {
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
};

const videoMimeTypes: Record<ContentVideo["format"], Set<string>> = {
  mov: new Set(["video/quicktime"]),
  mp4: new Set(["video/mp4"]),
  mpeg: new Set(["video/mpeg"]),
};

export const isRenderableAudioSource = (
  source: string,
  format: ContentAudio["format"]
): boolean => {
  const mimeType = base64DataUriMimeType(source);
  return mimeType !== undefined && audioMimeTypes[format].has(mimeType);
};

export const isRenderableVideoSource = (
  source: string,
  format: ContentVideo["format"]
): boolean => {
  const mimeType = base64DataUriMimeType(source);
  return mimeType !== undefined && videoMimeTypes[format].has(mimeType);
};

export const audioMimeTypeForFormat = (
  format: ContentAudio["format"]
): string => primaryAudioMimeTypes[format];

export const videoMimeTypeForFormat = (
  format: ContentVideo["format"]
): string => primaryVideoMimeTypes[format];

export const isRenderableImageDocument = (
  source: string,
  declaredMimeType: string
): boolean => {
  const sourceMimeType = base64DataUriMimeType(source);
  if (sourceMimeType === undefined) {
    return false;
  }

  const normalizedSource = normalizedImageMimeType(sourceMimeType);
  const normalizedDeclared = normalizedImageMimeType(declaredMimeType);
  return (
    rasterImageMimeTypes.has(normalizedSource) &&
    normalizedSource === normalizedDeclared
  );
};
