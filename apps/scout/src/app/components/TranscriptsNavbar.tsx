import { FC, useContext, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { AppModeContext } from "../../App";
import { ApplicationIcons } from "../../icons";
import { transcriptsRoute } from "../../router/url";
import { useStore } from "../../state/store";

import { EditablePath } from "./EditablePath";
import { Navbar } from "./Navbar";
import { NavButton } from "./NavButtons";

interface TranscriptsNavbarProps {
  transcriptsDir?: string | null;
  transcriptsDirSource?: "route" | "user" | "project" | "cli" | "unknown";
  filter?: string;
  setTranscriptsDir: (path: string) => void;
  bordered?: boolean;
  /** Override the Back button target (default: the transcripts listing). The
   *  focus page passes its exit-to-transcript URL so Back returns to the
   *  transcript it was opened from, not the listing (mirrors inspect). */
  backUrl?: string;
  children?: React.ReactNode;
}

export const TranscriptsNavbar: FC<TranscriptsNavbarProps> = ({
  transcriptsDir,
  transcriptsDirSource,
  filter,
  setTranscriptsDir,
  bordered = true,
  backUrl,
  children,
}) => {
  const appMode = useContext(AppModeContext);
  const showNavButtons = appMode !== "workbench";
  const singleFileMode = useStore((state) => state.singleFileMode);
  const [searchParams] = useSearchParams();

  const params = useParams<{ transcriptId: string }>();
  const transcriptId = params.transcriptId;

  // Back defaults to the transcripts listing; a caller (the focus page) may
  // override it to return to the transcript it was opened from instead.
  const resolvedBackUrl =
    backUrl ?? (!singleFileMode ? transcriptsRoute(searchParams) : undefined);

  const navButtons: NavButton[] = useMemo(() => {
    const buttons: NavButton[] = [];

    if (resolvedBackUrl) {
      buttons.push({
        title: "Back",
        icon: ApplicationIcons.navbar.back,
        route: resolvedBackUrl,
        enabled: !!transcriptId,
      });
    }

    if (!singleFileMode) {
      buttons.push({
        title: "Home",
        icon: ApplicationIcons.navbar.home,
        route: transcriptsRoute(),
        enabled: !!transcriptId,
      });
    }

    return buttons;
    // TODO: lint react-hooks/exhaustive-deps Fix this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedBackUrl, singleFileMode]);

  const editable = false;
  const filterText =
    filter && !filter?.startsWith("(")
      ? `(${filter})`
      : filter
        ? filter
        : undefined;

  return (
    <Navbar
      bordered={bordered}
      leftButtons={showNavButtons ? navButtons : undefined}
      left={
        <EditablePath
          path={transcriptsDir}
          secondaryText={filterText}
          label="Transcripts"
          icon={
            transcriptsDirSource === "cli"
              ? ApplicationIcons.terminal
              : undefined
          }
          title={
            transcriptsDirSource === "cli"
              ? "Using transcripts directory from command line."
              : undefined
          }
          onPathChanged={setTranscriptsDir}
          placeholder={
            editable
              ? "Select Transcripts Folder"
              : "No transcripts directory configured."
          }
          className="text-size-smallest"
          editable={editable}
        />
      }
      right={children}
    />
  );
};
