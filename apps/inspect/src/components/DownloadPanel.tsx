import { FC } from "react";

import { DownloadButton } from "../components/DownloadButton";

import styles from "./DownloadPanel.module.css";

interface DownloadPanelProps {
  message: string;
  buttonLabel: string;
  fileName: string;
  fileContents: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>;
}

export const DownloadPanel: FC<DownloadPanelProps> = ({
  message,
  buttonLabel,
  fileName,
  fileContents,
}) => {
  return (
    <div>
      <div className={styles.downloadPanel}>
        <div className={styles.downloadPanelMessage}>{message}</div>
        <DownloadButton
          label={buttonLabel}
          fileName={fileName}
          fileContents={fileContents}
        />
      </div>
    </div>
  );
};
