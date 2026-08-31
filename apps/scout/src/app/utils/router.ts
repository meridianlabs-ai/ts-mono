import { useEffect, useMemo } from "react";
import { useParams } from "react-router";

import { decodeBase64Url } from "@tsmono/util";

import { useStore } from "../../state/store";

export const useTranscriptDirParams = (): string | undefined => {
  const params = useParams<{ transcriptsDir?: string }>();
  const setUserTranscriptsDir = useStore(
    (state) => state.setUserTranscriptsDir
  );

  const decodedTranscriptDir = useMemo(() => {
    if (params.transcriptsDir) {
      return decodeBase64Url(params.transcriptsDir);
    }
    return undefined;
  }, [params.transcriptsDir]);

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (decodedTranscriptDir) {
      setUserTranscriptsDir(decodedTranscriptDir);
    }
  }, [decodedTranscriptDir, setUserTranscriptsDir]);

  return decodedTranscriptDir;
};
