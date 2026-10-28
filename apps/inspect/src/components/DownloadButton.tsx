import { clsx } from "clsx";
import { FC } from "react";

import { getApi } from "../app_config";

import styles from "./DownloadButton.module.css";

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
      type="button"
      className={clsx("btn", "btn-outline-primary", styles.downloadButton)}
      onClick={() => {
        api.download_file(fileName, fileContents).catch((error: unknown) => {
          console.error("Failed to download:", error);
        });
      }}
    >
      {label}
    </button>
  );
};
