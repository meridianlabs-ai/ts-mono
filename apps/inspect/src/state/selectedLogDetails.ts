import { AsyncData } from "@tsmono/util";

import { useLogDir } from "../app_config";
import { LogHeader } from "../client/api/types";
import { useLog } from "../log_data";

import { useStore } from "./store";

/** Selection binding: the selected log's details — the fetch trigger and
 *  loading/error surface (see `useLog`). Active demand: this is the ONE
 *  consumer declaring "someone is looking at this log" — see
 *  `useLog`'s `demand` option. */
export const useSelectedLogDetail = (): AsyncData<LogHeader | undefined> =>
  useLog(
    useLogDir(),
    useStore((state) => state.logs.selectedLogFile),
    { demand: "active" }
  );

/** Whether the selected log's details are loading. Already false when no
 *  file is selected (`useLog` idles as settled-undefined). */
export const useSelectedLogLoading = (): boolean =>
  useSelectedLogDetail().loading;
