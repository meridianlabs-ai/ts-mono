import { useLogDir } from "../app_config";
import { LogHeader } from "../client/api/types";
import { LogDataState, useLogDetail } from "../log_data";

import { useStore } from "./store";

/** Selection binding: the selected log's details — the fetch trigger and
 *  loading/error surface (see `useLogDetail`). Active demand: this is the ONE
 *  consumer declaring "someone is looking at this log" — see
 *  `useLogDetail`'s `demand` option. */
export const useSelectedLogDetail = (): LogDataState<LogHeader> =>
  useLogDetail(
    useLogDir(),
    useStore((state) => state.logs.selectedLogFile),
    { demand: "active" }
  );

/** Whether the selected log's details are loading. `LogDataState.loading` is
 *  already false when no file is selected. */
export const useSelectedLogLoading = (): boolean =>
  useSelectedLogDetail().loading;
