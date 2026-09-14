import { useParams } from "react-router";

import { useMirrorToStore } from "@tsmono/react/hooks";
import { decodeBase64Url } from "@tsmono/util";

import { useStore } from "../state/store";

/**
 * The `:transcriptsDir` route param, decoded. The last directory seen is
 * mirrored into the store so it stays the user's directory after navigating
 * to a route without the param (see `useTranscriptsDir`).
 */
export const useTranscriptDirParams = (): string | undefined => {
  const params = useParams<{ transcriptsDir?: string }>();
  const setUserTranscriptsDir = useStore(
    (state) => state.setUserTranscriptsDir
  );

  const decodedTranscriptDir = params.transcriptsDir
    ? decodeBase64Url(params.transcriptsDir)
    : undefined;

  useMirrorToStore(decodedTranscriptDir, setUserTranscriptsDir);

  return decodedTranscriptDir;
};
