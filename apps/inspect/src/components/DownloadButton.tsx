import { FC } from "react";

import { Button } from "@tsmono/react/components";

import { useApi } from "../state/store";

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
  const api = useApi();
  return (
    <Button
      variant="outline-primary"
      className={"download-button"}
      onClick={async () => {
        await api.download_file(fileName, fileContents);
      }}
    >
      {label}
    </Button>
  );
};
