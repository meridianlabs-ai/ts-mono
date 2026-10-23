import { FC } from "react";

import { NonIdealState } from "@tsmono/react/components";

import { InputReferenceError } from "../../../api/api";
import { useApi } from "../../../state/store";

interface InputReferenceNoticeProps {
  transcriptId?: string;
  inputError?: InputReferenceError;
}

export const InputReferenceNotice: FC<InputReferenceNoticeProps> = ({
  transcriptId,
  inputError,
}) => {
  const api = useApi();
  const url = transcriptId ? api.inputReferenceUrl?.(transcriptId) : undefined;
  return (
    <NonIdealState
      title="Input stored by reference"
      description={
        inputError?.message ?? "This server did not resolve the input."
      }
      action={
        url ? (
          <a href={url} target="_blank" rel="noreferrer">
            Open sample
          </a>
        ) : undefined
      }
    />
  );
};
