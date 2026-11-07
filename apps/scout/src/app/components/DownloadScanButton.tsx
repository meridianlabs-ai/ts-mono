import clsx from "clsx";
import { JSX, useState } from "react";

import { Icon } from "@tsmono/react/icons";

import styles from "./DownloadScanButton.module.css";

type DownloadState = "idle" | "downloading" | "success" | "error";

interface DownloadScanButtonProps {
  scansDir: string;
  scanPath: string;
  download: (scansDir: string, scanPath: string) => Promise<Blob>;
  className?: string;
}

export const DownloadScanButton = ({
  scansDir,
  scanPath,
  download,
  className = "",
}: DownloadScanButtonProps): JSX.Element => {
  const [state, setState] = useState<DownloadState>("idle");

  const finish = (result: "success" | "error") => {
    setState(result);
    // Brief visual feedback before resetting to idle
    setTimeout(() => setState("idle"), 1250);
  };

  const handleClick = (): void => {
    setState("downloading");
    download(scansDir, scanPath)
      .then((blob) => {
        triggerBrowserDownload(blob, `${scanPath}.zip`);
        finish("success");
      })
      .catch(() => finish("error"));
  };

  const icon =
    state === "downloading"
      ? "refresh"
      : state === "success"
        ? "confirm"
        : state === "error"
          ? "error"
          : "download";

  return (
    <button
      type="button"
      className={clsx(
        "download-scan-button",
        styles.downloadButton,
        state === "downloading" && styles.spinning,
        className
      )}
      onClick={handleClick}
      aria-label="Download scan results"
      disabled={state !== "idle"}
      title="Download Scan Results"
    >
      <Icon
        name={icon}
        className={state === "success" ? "primary" : undefined}
      />
    </button>
  );
};

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
