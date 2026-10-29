import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { FC } from "react";

import { NonIdealState, ToolButton } from "@tsmono/react/components";

import { InputReferenceError } from "../../../api/api";
import { useApi } from "../../../state/store";
import { unresolvedScanDataframeDetails } from "../../server/queries";

interface InputReferenceNoticeProps {
  transcriptId?: string;
  inputError?: InputReferenceError;
}

export const InputReferenceNotice: FC<InputReferenceNoticeProps> = ({
  transcriptId,
  inputError,
}) => {
  const api = useApi();
  const queryClient = useQueryClient();
  const retrying = useIsFetching(unresolvedScanDataframeDetails) > 0;
  const url = transcriptId ? api.inputReferenceUrl?.(transcriptId) : undefined;
  // Only a source outage is transient; the other reasons recur on a refetch.
  const canRetry = inputError?.reason === "unavailable";
  return (
    <NonIdealState
      title="Input stored by reference"
      description={
        inputError?.message ?? "This server did not resolve the input."
      }
      action={
        canRetry || url ? (
          <>
            {canRetry && (
              <ToolButton
                label={retrying ? "Retrying…" : "Retry"}
                disabled={retrying}
                onClick={() => {
                  queryClient
                    .refetchQueries(unresolvedScanDataframeDetails)
                    .catch(console.error);
                }}
              />
            )}{" "}
            {url && (
              <a href={url} target="_blank" rel="noreferrer">
                Open sample
              </a>
            )}
          </>
        ) : undefined
      }
    />
  );
};
