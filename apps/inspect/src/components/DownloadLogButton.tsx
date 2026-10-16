import clsx from "clsx";
import { JSX, useState } from "react";

import { Icon, IconName } from "@tsmono/react/icons";

import { getApi } from "../app_config";

import styles from "./DownloadLogButton.module.css";

type DownloadState = "idle" | "downloading" | "success" | "error";

interface DownloadLogButtonProps {
  log_file: string;
  className?: string;
  ariaLabel?: string;
}

export const DownloadLogButton = ({
  log_file,
  className = "",
  ariaLabel = "Download log as EVAL",
}: DownloadLogButtonProps): JSX.Element => {
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const api = getApi();

  const handleClick = (): void => {
    if (!api.download_log) return;

    setDownloadState("downloading");

    api
      .download_log(log_file)
      .then(() => setDownloadState("success"))
      .catch((error: unknown) => {
        console.error("Failed to download log:", error);
        setDownloadState("error");
      })
      .finally(() => {
        setTimeout(() => {
          setDownloadState("idle");
        }, 1250);
      });
  };

  const getIcon = (): IconName => {
    switch (downloadState) {
      case "downloading":
        return "loading";
      case "success":
        return "confirm";
      case "error":
        return "error";
      default:
        return "download";
    }
  };

  const iconClassName =
    downloadState === "success"
      ? "primary"
      : downloadState === "error"
        ? "text-danger"
        : undefined;

  return (
    <button
      type="button"
      className={clsx(
        "download-log-button",
        styles.downloadLogButton,
        className
      )}
      onClick={handleClick}
      aria-label={ariaLabel}
      disabled={downloadState !== "idle"}
    >
      <Icon name={getIcon()} className={iconClassName} />
    </button>
  );
};
