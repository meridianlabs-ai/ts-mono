import { FC } from "react";

import { getApi } from "../app_config";

import "./DownloadButton.css";

interface DownloadButtonProps {
  label: string;
  fileName: string;
  fileContents: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>;
}

export const DownloadButton: FC<DownloadButtonProps> = ({
  label,
  fileName,
  fileContents,
}) => {
  const api = getApi();
  return (
    <button
      className={"btn btn-outline-primary download-button"}
      onClick={() => {
        void api.download_file(fileName, fileContents);
      }}
    >
      {label}
    </button>
  );
};
