import { FC } from "react";

import { useApi } from "../state/store";

import "./DownloadButton.css";

export interface DownloadButtonProps {
  label: string;
  fileName: string;
  fileContents: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>;
}

export const DownloadButton: FC<DownloadButtonProps> = ({
  label,
  fileName,
  fileContents,
}) => {
  const api = useApi();
  return (
    <button
      className={"btn btn-outline-primary download-button"}
      onClick={async () => {
        await api.download_file(fileName, fileContents);
      }}
    >
      {label}
    </button>
  );
};
